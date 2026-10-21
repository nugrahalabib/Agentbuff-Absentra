import { Router, type Request } from 'express'
import { z } from 'zod'
import { db, now } from '../lib/db.js'
import { id } from '../lib/ids.js'
import { mapLeave, mapOvertime } from '../lib/map.js'
import { requireCompany, requireCap } from '../lib/context.js'
import { can, type Capability } from '../domain/rbac.js'
import { audit } from '../lib/audit.js'
import { isoDate, rejectBadRange } from '../lib/validate.js'
import { daysBetween, dayOfWeek } from '../lib/tenantTime.js'
import { decideOvertime, supersedeDrafts } from '../lib/overtime.js'

export const requestsRouter = Router()

function empRow(cid: string, eid: string) {
  return db.prepare('SELECT id, name, branch_id, leave_balance_annual FROM employee_profile WHERE id=? AND company_id=?').get(eid, cid) as any
}
function empName(cid: string, eid: string) { return empRow(cid, eid)?.name ?? '—' }

/**
 * Who a request is filed for. `employeeId` in the body is honoured only for an
 * approver acting inside their scope on an employee of this company; for
 * anyone else it is ignored and the request is filed for the caller.
 */
function resolveSubject(req: Request, bodyEmployeeId: string | undefined, approveCap: Capability): { employeeId: string } | { status: number; body: unknown } {
  const cid = req.ctx!.companyId!
  const own = req.ctx!.employeeId
  if (bodyEmployeeId && bodyEmployeeId !== own && can(req.ctx!.actor!, approveCap)) {
    const target = empRow(cid, bodyEmployeeId)
    if (!target) return { status: 404, body: { error: 'employee_not_found' } }
    if (!can(req.ctx!.actor!, approveCap, { branchId: target.branch_id })) return { status: 403, body: { error: 'out_of_scope' } }
    return { employeeId: target.id }
  }
  if (!own) return { status: 400, body: { error: 'no_employee' } }
  return { employeeId: own }
}

/** List visibility: employees see only their own; approvers only their branches. */
function visibleRows(req: Request, rows: any[], approveCap: Capability): any[] {
  const cid = req.ctx!.companyId!
  const actor = req.ctx!.actor!
  const mine = req.query.mine === '1' || actor.membership.role === 'employee' || !can(actor, approveCap)
  if (mine) return rows.filter((r) => r.employee_id === req.ctx!.employeeId)
  return rows.filter((r) => {
    const e = empRow(cid, r.employee_id)
    return !!e && can(actor, approveCap, { branchId: e.branch_id })
  })
}

// ---- Leaves ----
requestsRouter.get('/leaves', requireCompany, (req, res) => {
  const cid = req.ctx!.companyId!
  const rows = db.prepare('SELECT * FROM leave_request WHERE company_id=? ORDER BY created_at DESC').all(cid) as any[]
  res.json(visibleRows(req, rows, 'leave.approve').map((r) => ({ ...mapLeave(r), name: empName(cid, r.employee_id) })))
})

/** Working days (per the company's work week) of [start..end] that fall in `year`. */
function workingDaysInYear(start: string, end: string, year: string, workweek: string): number {
  return daysBetween(start, end).filter((d) => {
    if (!d.startsWith(year)) return false
    const w = dayOfWeek(d)
    return workweek === 'five_day' ? w !== 0 && w !== 6 : w !== 0
  }).length
}

requestsRouter.post('/leaves', requireCompany, requireCap('leave.request'), (req, res) => {
  const body = z.object({
    type: z.enum(['tahunan', 'sakit', 'izin', 'tanpa_bayar']),
    dateStart: isoDate, dateEnd: isoDate, reason: z.string().max(1000).optional(),
    attachmentName: z.string().max(255).optional(),
    employeeId: z.string().optional(),
  }).parse(req.body)
  const cid = req.ctx!.companyId!
  const who = resolveSubject(req, body.employeeId, 'leave.approve')
  if ('status' in who) return res.status(who.status).json(who.body)
  const employeeId = who.employeeId
  if (rejectBadRange(res, body.dateStart, body.dateEnd)) return
  // Reject overlap with an existing pending/approved leave (TC-131).
  const clash = (db.prepare(`SELECT date_start, date_end FROM leave_request WHERE company_id=? AND employee_id=? AND status IN ('pending','approved')`).all(cid, employeeId) as any[])
    .some((l) => body.dateStart <= l.date_end && l.date_start <= body.dateEnd)
  if (clash) return res.status(409).json({ error: 'leave_overlap', message: 'Tanggal bentrok dengan pengajuan cuti lain.' })
  // Annual leave balance (TC-130): only 'tahunan' consumes it, counted in WORKING
  // days of the company's work week, per calendar year (izin/sakit/tanpa_bayar never do).
  if (body.type === 'tahunan') {
    const balance = empRow(cid, employeeId)?.leave_balance_annual ?? 12
    const workweek = (db.prepare('SELECT workweek_type FROM company WHERE id=?').get(cid) as any)?.workweek_type ?? 'six_day'
    const prior = db.prepare(`SELECT date_start, date_end FROM leave_request WHERE company_id=? AND employee_id=? AND type='tahunan' AND status IN ('pending','approved')`).all(cid, employeeId) as any[]
    const years = [...new Set(daysBetween(body.dateStart, body.dateEnd).map((d) => d.slice(0, 4)))]
    for (const y of years) {
      const used = prior.reduce((s, l) => s + workingDaysInYear(l.date_start, l.date_end, y, workweek), 0)
      if (used + workingDaysInYear(body.dateStart, body.dateEnd, y, workweek) > balance) {
        return res.status(409).json({ error: 'insufficient_balance', message: `Sisa cuti tahunan ${y} tidak mencukupi.` })
      }
    }
  }
  const lid = id('lv')
  db.prepare(`INSERT INTO leave_request (id, company_id, employee_id, type, date_start, date_end, reason, attachment_name, status, created_at) VALUES (?,?,?,?,?,?,?,?, 'pending', ?)`).run(
    lid, cid, employeeId, body.type, body.dateStart, body.dateEnd, body.reason ?? null, body.attachmentName ?? null, now(),
  )
  res.json(mapLeave(db.prepare('SELECT * FROM leave_request WHERE id=?').get(lid)))
})

/** Approvers act within scope and never on their own request (owner excepted). */
function decisionGuard(req: Request, employeeId: string, cap: Capability): { status: number; body: unknown } | null {
  const cid = req.ctx!.companyId!
  const e = empRow(cid, employeeId)
  if (!e || !can(req.ctx!.actor!, cap, { branchId: e.branch_id })) return { status: 403, body: { error: 'out_of_scope' } }
  if (req.ctx!.actor!.membership.role !== 'owner' && employeeId === req.ctx!.employeeId) {
    return { status: 403, body: { error: 'cannot_decide_own_request', message: 'Pengajuan Anda sendiri harus diputuskan atasan.' } }
  }
  return null
}

requestsRouter.post('/leaves/:id/decision', requireCompany, requireCap('leave.approve'), (req, res) => {
  const body = z.object({ status: z.enum(['approved', 'rejected']), reason: z.string().max(1000).optional() }).parse(req.body)
  const cid = req.ctx!.companyId!
  const lv = db.prepare('SELECT * FROM leave_request WHERE id=? AND company_id=?').get(req.params.id, cid) as any
  if (!lv) return res.status(404).json({ error: 'not_found' })
  const guard = decisionGuard(req, lv.employee_id, 'leave.approve')
  if (guard) return res.status(guard.status).json(guard.body)
  db.prepare('UPDATE leave_request SET status=?, approver_id=?, decided_at=?, decided_reason=? WHERE id=? AND company_id=?').run(body.status, req.ctx!.userId, now(), body.reason ?? null, lv.id, cid)
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: `leave.${body.status}`, target: lv.id, metadata: { reason: body.reason } })
  // Warn if approved leave conflicts with a scheduled shift (TC-107).
  let shiftConflict = false
  if (body.status === 'approved') {
    shiftConflict = !!db.prepare('SELECT id FROM shift_assignment WHERE company_id=? AND employee_id=? AND work_date>=? AND work_date<=? LIMIT 1').get(cid, lv.employee_id, lv.date_start, lv.date_end)
  }
  res.json({ ...mapLeave(db.prepare('SELECT * FROM leave_request WHERE id=?').get(lv.id)), shiftConflict })
})

// ---- Overtime ----
requestsRouter.get('/overtimes', requireCompany, (req, res) => {
  const cid = req.ctx!.companyId!
  const rows = db.prepare('SELECT * FROM overtime_request WHERE company_id=? ORDER BY created_at DESC').all(cid) as any[]
  res.json(visibleRows(req, rows, 'overtime.approve').map((r) => ({ ...mapOvertime(r), name: empName(cid, r.employee_id) })))
})

requestsRouter.post('/overtimes', requireCompany, requireCap('overtime.request'), (req, res) => {
  const body = z.object({
    workDate: isoDate, hours: z.number().positive().max(11),
    dayType: z.enum(['workday', 'weekly_rest', 'public_holiday', 'shortest_day']),
    employeeId: z.string().optional(),
  }).parse(req.body)
  const cid = req.ctx!.companyId!
  const who = resolveSubject(req, body.employeeId, 'overtime.approve')
  if ('status' in who) return res.status(who.status).json(who.body)
  const employeeId = who.employeeId
  const oid = id('ot')
  const tx = db.transaction(() => {
    // A manual request supersedes the auto-created draft for the same date (no double pay).
    supersedeDrafts(cid, employeeId, body.workDate)
    db.prepare(`INSERT INTO overtime_request (id, company_id, employee_id, work_date, hours, day_type, status, is_draft, created_at) VALUES (?,?,?,?,?,?, 'pending', 0, ?)`).run(
      oid, cid, employeeId, body.workDate, body.hours, body.dayType, now(),
    )
  })
  tx()
  res.json(mapOvertime(db.prepare('SELECT * FROM overtime_request WHERE id=?').get(oid)))
})

requestsRouter.post('/overtimes/:id/decision', requireCompany, requireCap('overtime.approve'), (req, res) => {
  const body = z.object({ status: z.enum(['approved', 'rejected']), reason: z.string().max(1000).optional() }).parse(req.body)
  const cid = req.ctx!.companyId!
  const ot = db.prepare('SELECT * FROM overtime_request WHERE id=? AND company_id=?').get(req.params.id, cid) as any
  if (!ot) return res.status(404).json({ error: 'not_found' })
  const guard = decisionGuard(req, ot.employee_id, 'overtime.approve')
  if (guard) return res.status(guard.status).json(guard.body)
  const r = decideOvertime(cid, ot, body.status, req.ctx!.userId, body.reason ?? null)
  if (!r.ok) return res.status(r.status).json({ error: r.error, message: r.message })
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: `overtime.${body.status}`, target: ot.id })
  res.json(mapOvertime(db.prepare('SELECT * FROM overtime_request WHERE id=?').get(ot.id)))
})

// ---- Pending approvals (combined) ----
requestsRouter.get('/approvals/pending', requireCompany, requireCap('leave.approve'), (req, res) => {
  const cid = req.ctx!.companyId!
  const actor = req.ctx!.actor!
  const ok = (eid: string, cap: Capability) => { const e = empRow(cid, eid); return !!e && can(actor, cap, { branchId: e.branch_id }) }
  const leaves = (db.prepare(`SELECT * FROM leave_request WHERE company_id=? AND status='pending'`).all(cid) as any[]).filter((l) => ok(l.employee_id, 'leave.approve')).map((l) => ({ ...mapLeave(l), name: empName(cid, l.employee_id) }))
  const overtimes = (db.prepare(`SELECT * FROM overtime_request WHERE company_id=? AND status='pending'`).all(cid) as any[]).filter((o) => ok(o.employee_id, 'overtime.approve')).map((o) => ({ ...mapOvertime(o), name: empName(cid, o.employee_id) }))
  res.json({ leaves, overtimes })
})
