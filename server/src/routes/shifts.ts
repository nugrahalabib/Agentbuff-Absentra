import { Router, type Request } from 'express'
import { z } from 'zod'
import { db } from '../lib/db.js'
import { id } from '../lib/ids.js'
import { mapShiftTemplate, mapAssignment } from '../lib/map.js'
import { requireCompany, requireCap } from '../lib/context.js'
import { can } from '../domain/rbac.js'
import { audit } from '../lib/audit.js'
import { isoDate, rejectBadRange } from '../lib/validate.js'
import { addDaysIso, daysBetween, dayOfWeek } from '../lib/tenantTime.js'
import { CONFLICT_MESSAGE, assignmentConflict, minRestHours, type ShiftConflictReason } from '../lib/shiftRules.js'

export const shiftsRouter = Router()

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Format jam HH:MM')

// ---- Shift templates ----
shiftsRouter.get('/shift-templates', requireCompany, (req, res) => {
  const rows = db.prepare('SELECT * FROM shift_template WHERE company_id = ? ORDER BY start_time').all(req.ctx!.companyId) as any[]
  res.json(rows.map(mapShiftTemplate))
})

shiftsRouter.post('/shift-templates', requireCompany, requireCap('shift_template.manage'), (req, res) => {
  const body = z.object({
    name: z.string().trim().min(1).max(80),
    startTime: HHMM,
    endTime: HHMM,
    crossesMidnight: z.boolean().default(false),
    breakMinutes: z.number().int().nonnegative().max(1440).default(60),
    lateToleranceMinutes: z.number().int().nonnegative().max(1440).default(10),
    geofenceId: z.string().optional(),
  }).parse(req.body)
  const cid = req.ctx!.companyId!
  if (body.geofenceId && !db.prepare('SELECT id FROM geofence WHERE id=? AND company_id=?').get(body.geofenceId, cid)) {
    return res.status(400).json({ error: 'invalid_geofence' })
  }
  const sid = id('sht')
  db.prepare(`INSERT INTO shift_template (id, company_id, name, start_time, end_time, crosses_midnight, break_minutes, late_tolerance_minutes, geofence_id)
              VALUES (?,?,?,?,?,?,?,?,?)`).run(
    sid, cid, body.name, body.startTime, body.endTime, body.crossesMidnight ? 1 : 0, body.breakMinutes, body.lateToleranceMinutes, body.geofenceId ?? null,
  )
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: 'shift_template.create', target: sid })
  res.json(mapShiftTemplate(db.prepare('SELECT * FROM shift_template WHERE id = ?').get(sid)))
})

shiftsRouter.patch('/shift-templates/:id', requireCompany, requireCap('shift_template.manage'), (req, res) => {
  const body = z.object({
    name: z.string().trim().min(1).max(80).optional(), startTime: HHMM.optional(), endTime: HHMM.optional(),
    crossesMidnight: z.boolean().optional(), breakMinutes: z.number().int().nonnegative().max(1440).optional(), lateToleranceMinutes: z.number().int().nonnegative().max(1440).optional(),
  }).parse(req.body)
  const cid = req.ctx!.companyId!
  const cur = db.prepare('SELECT * FROM shift_template WHERE id=? AND company_id=?').get(req.params.id, cid) as any
  if (!cur) return res.status(404).json({ error: 'not_found' })
  db.prepare('UPDATE shift_template SET name=?, start_time=?, end_time=?, crosses_midnight=?, break_minutes=?, late_tolerance_minutes=? WHERE id=? AND company_id=?').run(
    body.name ?? cur.name, body.startTime ?? cur.start_time, body.endTime ?? cur.end_time,
    body.crossesMidnight != null ? (body.crossesMidnight ? 1 : 0) : cur.crosses_midnight,
    body.breakMinutes ?? cur.break_minutes, body.lateToleranceMinutes ?? cur.late_tolerance_minutes, cur.id, cid,
  )
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: 'shift_template.update', target: cur.id })
  res.json(mapShiftTemplate(db.prepare('SELECT * FROM shift_template WHERE id = ?').get(cur.id)))
})

const empBranch = (cid: string, eid: string) => (db.prepare('SELECT branch_id FROM employee_profile WHERE id=? AND company_id=?').get(eid, cid) as any)?.branch_id as string | undefined

// ---- Assignments ----
shiftsRouter.get('/shift-assignments', requireCompany, (req, res) => {
  const q = z.object({ employeeId: z.string().optional(), from: isoDate, to: isoDate }).parse(req.query)
  if (rejectBadRange(res, q.from, q.to)) return
  const cid = req.ctx!.companyId!
  const actor = req.ctx!.actor!
  let rows = db.prepare('SELECT * FROM shift_assignment WHERE company_id = ? AND work_date >= ? AND work_date <= ?').all(cid, q.from, q.to) as any[]
  if (actor.membership.role === 'employee') {
    // Employees only ever see their own schedule, whatever employeeId they ask for.
    rows = rows.filter((r) => r.employee_id === req.ctx!.employeeId)
  } else {
    if (q.employeeId) rows = rows.filter((r) => r.employee_id === q.employeeId)
    rows = rows.filter((r) => r.employee_id === req.ctx!.employeeId || can(actor, 'employee.view', { branchId: empBranch(cid, r.employee_id) ?? '∅' }))
  }
  const withTemplate = rows
    .map((r) => ({ assignment: mapAssignment(r), template: mapShiftTemplate(db.prepare('SELECT * FROM shift_template WHERE id = ? AND company_id = ?').get(r.shift_template_id, cid)) }))
    .sort((a, b) => a.assignment.workDate.localeCompare(b.assignment.workDate))
  res.json(withTemplate)
})

/** Personal schedule: own shifts + approved leave overlaid on the calendar (TC-138). */
shiftsRouter.get('/me/schedule', requireCompany, (req, res) => {
  const q = z.object({ from: isoDate, to: isoDate }).parse(req.query)
  if (rejectBadRange(res, q.from, q.to)) return
  const eid = req.ctx!.employeeId
  if (!eid) return res.json({ shifts: [], leaves: [] })
  const cid = req.ctx!.companyId!
  const shifts = (db.prepare('SELECT * FROM shift_assignment WHERE company_id=? AND employee_id=? AND work_date>=? AND work_date<=?').all(cid, eid, q.from, q.to) as any[])
    .map((a) => ({ assignment: mapAssignment(a), template: mapShiftTemplate(db.prepare('SELECT * FROM shift_template WHERE id=? AND company_id=?').get(a.shift_template_id, cid)) }))
  const leaves = (db.prepare(`SELECT * FROM leave_request WHERE company_id=? AND employee_id=? AND status='approved'`).all(cid, eid) as any[])
    .filter((l) => q.from <= l.date_end && l.date_start <= q.to)
    .map((l) => ({ id: l.id, type: l.type, dateStart: l.date_start, dateEnd: l.date_end }))
  res.json({ shifts, leaves })
})

/** Every target employee must exist in this tenant and be within the actor's branch scope. */
function checkEmployees(req: Request, employeeIds: string[]): { status: number; body: unknown } | null {
  const cid = req.ctx!.companyId!
  for (const e of employeeIds) {
    const b = empBranch(cid, e)
    if (!b) return { status: 404, body: { error: 'employee_not_found', employeeId: e } }
    if (!can(req.ctx!.actor!, 'shift_assignment.manage', { branchId: b })) return { status: 403, body: { error: 'out_of_scope', employeeId: e } }
  }
  return null
}

type ConflictDetail = { employeeId: string; date: string; reason: ShiftConflictReason; message: string }

/** Bulk-assign a template to employees across a date range (PRD §6.7 bulk apply). */
shiftsRouter.post('/shift-assignments', requireCompany, requireCap('shift_assignment.manage'), (req, res) => {
  const body = z.object({
    employeeIds: z.array(z.string()).min(1).max(500),
    shiftTemplateId: z.string(),
    dateStart: isoDate,
    dateEnd: isoDate.optional(),
    skipSundays: z.boolean().default(false),
  }).parse(req.body)
  const cid = req.ctx!.companyId!
  const dateEnd = body.dateEnd ?? body.dateStart
  if (rejectBadRange(res, body.dateStart, dateEnd)) return
  const bad = checkEmployees(req, [...new Set(body.employeeIds)])
  if (bad) return res.status(bad.status).json(bad.body)
  const dates = daysBetween(body.dateStart, dateEnd).filter((d) => !(body.skipSundays && dayOfWeek(d) === 0))
  const tpl = db.prepare('SELECT * FROM shift_template WHERE id=? AND company_id=?').get(body.shiftTemplateId, cid) as any
  if (!tpl) return res.status(404).json({ error: 'template_not_found' })
  const minRest = minRestHours(cid)

  const insert = db.prepare(`INSERT OR IGNORE INTO shift_assignment (id, company_id, employee_id, shift_template_id, work_date, status) VALUES (?,?,?,?,?, 'scheduled')`)
  let count = 0
  const conflictDetails: ConflictDetail[] = []
  const tx = db.transaction(() => {
    for (const e of new Set(body.employeeIds)) for (const d of dates) {
      // Overlap (TC-095) and minimum rest between consecutive shifts (TC-096).
      const reason = assignmentConflict(cid, e, tpl, d, minRest)
      if (reason) { conflictDetails.push({ employeeId: e, date: d, reason, message: CONFLICT_MESSAGE[reason] }); continue }
      if (insert.run(id('sa'), cid, e, body.shiftTemplateId, d).changes > 0) count++
    }
  })
  tx()
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: 'shift_assignment.bulk', metadata: { employees: body.employeeIds.length, dates: dates.length, conflicts: conflictDetails.length } })
  res.json({ created: count, conflicts: conflictDetails.length, conflictDetails })
})

/** Rotation pattern (PRD §6.7): cycle a list of templates (null = libur) across days. */
shiftsRouter.post('/shift-assignments/rotation', requireCompany, requireCap('shift_assignment.manage'), (req, res) => {
  const body = z.object({
    employeeIds: z.array(z.string()).min(1).max(500),
    pattern: z.array(z.string().nullable()).min(1).max(60), // template ids; null = day off
    dateStart: isoDate,
    days: z.number().int().positive().max(90),
  }).parse(req.body)
  const cid = req.ctx!.companyId!
  const bad = checkEmployees(req, [...new Set(body.employeeIds)])
  if (bad) return res.status(bad.status).json(bad.body)
  const templates = new Map<string, any>()
  for (const tid of body.pattern) {
    if (!tid || templates.has(tid)) continue
    const t = db.prepare('SELECT * FROM shift_template WHERE id=? AND company_id=?').get(tid, cid)
    if (!t) return res.status(404).json({ error: 'template_not_found', templateId: tid })
    templates.set(tid, t)
  }
  const minRest = minRestHours(cid)
  const insert = db.prepare(`INSERT OR IGNORE INTO shift_assignment (id, company_id, employee_id, shift_template_id, work_date, status) VALUES (?,?,?,?,?, 'scheduled')`)
  let created = 0
  const conflictDetails: ConflictDetail[] = []
  const tx = db.transaction(() => {
    for (const e of new Set(body.employeeIds)) {
      for (let i = 0; i < body.days; i++) {
        const tplId = body.pattern[i % body.pattern.length]
        if (!tplId) continue // libur
        const date = addDaysIso(body.dateStart, i)
        const reason = assignmentConflict(cid, e, templates.get(tplId), date, minRest)
        if (reason) { conflictDetails.push({ employeeId: e, date, reason, message: CONFLICT_MESSAGE[reason] }); continue }
        if (insert.run(id('sa'), cid, e, tplId, date).changes > 0) created++
      }
    }
  })
  tx()
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: 'shift_assignment.rotation', metadata: { employees: body.employeeIds.length, days: body.days, conflicts: conflictDetails.length } })
  res.json({ created, conflicts: conflictDetails.length, conflictDetails })
})
