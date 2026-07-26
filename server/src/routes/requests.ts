import { Router } from 'express'
import { z } from 'zod'
import { db, now } from '../lib/db.js'
import { id } from '../lib/ids.js'
import { mapLeave, mapOvertime } from '../lib/map.js'
import { requireCompany, requireCap } from '../lib/context.js'
import { audit } from '../lib/audit.js'

export const requestsRouter = Router()

function scopeBranches(req: any): string[] | null {
  const s = req.ctx.actor.membership.scopeBranchIds
  return s.length ? s : null
}
function empName(id: string) { return (db.prepare('SELECT name FROM employee_profile WHERE id=?').get(id) as any)?.name ?? '—' }
function empBranch(id: string) { return (db.prepare('SELECT branch_id FROM employee_profile WHERE id=?').get(id) as any)?.branch_id }

// ---- Leaves ----
requestsRouter.get('/leaves', requireCompany, (req, res) => {
  const cid = req.ctx!.companyId!
  const mine = req.query.mine === '1'
  const rows = db.prepare('SELECT * FROM leave_request WHERE company_id=? ORDER BY created_at DESC').all(cid) as any[]
  const filtered = mine ? rows.filter((r) => r.employee_id === req.ctx!.employeeId) : rows
  res.json(filtered.map((r) => ({ ...mapLeave(r), name: empName(r.employee_id) })))
})

function daysInclusive(a: string, b: string): number {
  const [sy, sm, sd] = a.split('-').map(Number); const [ey, em, ed] = b.split('-').map(Number)
  return Math.floor((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 864e5) + 1
}

requestsRouter.post('/leaves', requireCompany, requireCap('leave.request'), (req, res) => {
  const body = z.object({
    type: z.enum(['tahunan', 'sakit', 'izin', 'tanpa_bayar']),
    dateStart: z.string(), dateEnd: z.string(), reason: z.string().optional(),
    attachmentName: z.string().optional(),
    employeeId: z.string().optional(),
  }).parse(req.body)
  const cid = req.ctx!.companyId!
  const employeeId = body.employeeId ?? req.ctx!.employeeId
  if (!employeeId) return res.status(400).json({ error: 'no_employee' })
  if (body.dateEnd < body.dateStart) return res.status(400).json({ error: 'invalid_range' })
  // Reject overlap with an existing pending/approved leave (TC-131).
  const clash = (db.prepare(`SELECT date_start, date_end FROM leave_request WHERE company_id=? AND employee_id=? AND status IN ('pending','approved')`).all(cid, employeeId) as any[])
    .some((l) => body.dateStart <= l.date_end && l.date_start <= body.dateEnd)
  if (clash) return res.status(409).json({ error: 'leave_overlap' })
  // Annual leave balance check (TC-130).
  if (body.type === 'tahunan') {
    const emp = db.prepare('SELECT leave_balance_annual FROM employee_profile WHERE id=?').get(employeeId) as any
    const used = (db.prepare(`SELECT date_start, date_end FROM leave_request WHERE company_id=? AND employee_id=? AND type='tahunan' AND status IN ('pending','approved')`).all(cid, employeeId) as any[])
      .reduce((s, l) => s + daysInclusive(l.date_start, l.date_end), 0)
    if (used + daysInclusive(body.dateStart, body.dateEnd) > (emp?.leave_balance_annual ?? 12)) return res.status(409).json({ error: 'insufficient_balance' })
  }
  const lid = id('lv')
  db.prepare(`INSERT INTO leave_request (id, company_id, employee_id, type, date_start, date_end, reason, attachment_name, status, created_at) VALUES (?,?,?,?,?,?,?,?, 'pending', ?)`).run(
    lid, cid, employeeId, body.type, body.dateStart, body.dateEnd, body.reason ?? null, body.attachmentName ?? null, now(),
  )
  res.json(mapLeave(db.prepare('SELECT * FROM leave_request WHERE id=?').get(lid)))
})

requestsRouter.post('/leaves/:id/decision', requireCompany, requireCap('leave.approve'), (req, res) => {
  const body = z.object({ status: z.enum(['approved', 'rejected']), reason: z.string().optional() }).parse(req.body)
  const cid = req.ctx!.companyId!
  const lv = db.prepare('SELECT * FROM leave_request WHERE id=? AND company_id=?').get(req.params.id, cid) as any
  if (!lv) return res.status(404).json({ error: 'not_found' })
  const scope = scopeBranches(req)
  if (scope && !scope.includes(empBranch(lv.employee_id))) return res.status(403).json({ error: 'out_of_scope' })
  db.prepare('UPDATE leave_request SET status=?, approver_id=?, decided_at=?, decided_reason=? WHERE id=?').run(body.status, req.ctx!.userId, now(), body.reason ?? null, lv.id)
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: `leave.${body.status}`, target: lv.id, metadata: { reason: body.reason } })
  // Warn if approved leave conflicts with a scheduled shift (TC-107).
  let shiftConflict = false
  if (body.status === 'approved') {
    const days = new Set(daysInclusive(lv.date_start, lv.date_end) > 0 ? Array.from({ length: daysInclusive(lv.date_start, lv.date_end) }, (_, i) => { const [y, m, d] = lv.date_start.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1, d)); x.setUTCDate(x.getUTCDate() + i); return x.toISOString().slice(0, 10) }) : [])
    shiftConflict = (db.prepare('SELECT work_date FROM shift_assignment WHERE company_id=? AND employee_id=?').all(cid, lv.employee_id) as any[]).some((a) => days.has(a.work_date))
  }
  res.json({ ...mapLeave(db.prepare('SELECT * FROM leave_request WHERE id=?').get(lv.id)), shiftConflict })
})

// ---- Overtime ----
requestsRouter.get('/overtimes', requireCompany, (req, res) => {
  const cid = req.ctx!.companyId!
  const mine = req.query.mine === '1'
  const rows = db.prepare('SELECT * FROM overtime_request WHERE company_id=? ORDER BY created_at DESC').all(cid) as any[]
  const filtered = mine ? rows.filter((r) => r.employee_id === req.ctx!.employeeId) : rows
  res.json(filtered.map((r) => ({ ...mapOvertime(r), name: empName(r.employee_id) })))
})

requestsRouter.post('/overtimes', requireCompany, requireCap('overtime.request'), (req, res) => {
  const body = z.object({
    workDate: z.string(), hours: z.number().positive().max(11),
    dayType: z.enum(['workday', 'weekly_rest', 'public_holiday', 'shortest_day']),
    employeeId: z.string().optional(),
  }).parse(req.body)
  const cid = req.ctx!.companyId!
  const employeeId = body.employeeId ?? req.ctx!.employeeId
  if (!employeeId) return res.status(400).json({ error: 'no_employee' })
  const oid = id('ot')
  db.prepare(`INSERT INTO overtime_request (id, company_id, employee_id, work_date, hours, day_type, status, created_at) VALUES (?,?,?,?,?,?, 'pending', ?)`).run(
    oid, cid, employeeId, body.workDate, body.hours, body.dayType, now(),
  )
  res.json(mapOvertime(db.prepare('SELECT * FROM overtime_request WHERE id=?').get(oid)))
})

requestsRouter.post('/overtimes/:id/decision', requireCompany, requireCap('overtime.approve'), (req, res) => {
  const body = z.object({ status: z.enum(['approved', 'rejected']), reason: z.string().optional() }).parse(req.body)
  const cid = req.ctx!.companyId!
  const ot = db.prepare('SELECT * FROM overtime_request WHERE id=? AND company_id=?').get(req.params.id, cid) as any
  if (!ot) return res.status(404).json({ error: 'not_found' })
  const scope = scopeBranches(req)
  if (scope && !scope.includes(empBranch(ot.employee_id))) return res.status(403).json({ error: 'out_of_scope' })
  db.prepare('UPDATE overtime_request SET status=?, approver_id=?, decided_at=?, decided_reason=? WHERE id=?').run(body.status, req.ctx!.userId, now(), body.reason ?? null, ot.id)
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: `overtime.${body.status}`, target: ot.id })
  res.json(mapOvertime(db.prepare('SELECT * FROM overtime_request WHERE id=?').get(ot.id)))
})

// ---- Pending approvals (combined) ----
requestsRouter.get('/approvals/pending', requireCompany, requireCap('leave.approve'), (req, res) => {
  const cid = req.ctx!.companyId!
  const scope = scopeBranches(req)
  const ok = (eid: string) => !scope || scope.includes(empBranch(eid))
  const leaves = (db.prepare(`SELECT * FROM leave_request WHERE company_id=? AND status='pending'`).all(cid) as any[]).filter((l) => ok(l.employee_id)).map((l) => ({ ...mapLeave(l), name: empName(l.employee_id) }))
  const overtimes = (db.prepare(`SELECT * FROM overtime_request WHERE company_id=? AND status='pending'`).all(cid) as any[]).filter((o) => ok(o.employee_id)).map((o) => ({ ...mapOvertime(o), name: empName(o.employee_id) }))
  res.json({ leaves, overtimes })
})
