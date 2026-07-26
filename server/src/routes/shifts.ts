import { Router } from 'express'
import { z } from 'zod'
import { db, now } from '../lib/db.js'
import { id } from '../lib/ids.js'
import { mapShiftTemplate, mapAssignment } from '../lib/map.js'
import { requireCompany, requireCap } from '../lib/context.js'
import { audit } from '../lib/audit.js'

export const shiftsRouter = Router()

function daysBetween(startISO: string, endISO: string): string[] {
  const out: string[] = []
  const [sy, sm, sd] = startISO.split('-').map(Number)
  const [ey, em, ed] = endISO.split('-').map(Number)
  const d = new Date(Date.UTC(sy, sm - 1, sd))
  const end = new Date(Date.UTC(ey, em - 1, ed))
  while (d <= end) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1) }
  return out
}
const dow = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay() }
const timeToMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }

// ---- Shift templates ----
shiftsRouter.get('/shift-templates', requireCompany, (req, res) => {
  const rows = db.prepare('SELECT * FROM shift_template WHERE company_id = ? ORDER BY start_time').all(req.ctx!.companyId) as any[]
  res.json(rows.map(mapShiftTemplate))
})

shiftsRouter.post('/shift-templates', requireCompany, requireCap('shift_template.manage'), (req, res) => {
  const body = z.object({
    name: z.string().min(1),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
    crossesMidnight: z.boolean().default(false),
    breakMinutes: z.number().int().nonnegative().default(60),
    lateToleranceMinutes: z.number().int().nonnegative().default(10),
    geofenceId: z.string().optional(),
  }).parse(req.body)
  const cid = req.ctx!.companyId!
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
    name: z.string().optional(), startTime: z.string().optional(), endTime: z.string().optional(),
    crossesMidnight: z.boolean().optional(), breakMinutes: z.number().optional(), lateToleranceMinutes: z.number().optional(),
  }).parse(req.body)
  const cid = req.ctx!.companyId!
  const cur = db.prepare('SELECT * FROM shift_template WHERE id=? AND company_id=?').get(req.params.id, cid) as any
  if (!cur) return res.status(404).json({ error: 'not_found' })
  db.prepare('UPDATE shift_template SET name=?, start_time=?, end_time=?, crosses_midnight=?, break_minutes=?, late_tolerance_minutes=? WHERE id=?').run(
    body.name ?? cur.name, body.startTime ?? cur.start_time, body.endTime ?? cur.end_time,
    body.crossesMidnight != null ? (body.crossesMidnight ? 1 : 0) : cur.crosses_midnight,
    body.breakMinutes ?? cur.break_minutes, body.lateToleranceMinutes ?? cur.late_tolerance_minutes, cur.id,
  )
  res.json(mapShiftTemplate(db.prepare('SELECT * FROM shift_template WHERE id = ?').get(cur.id)))
})

// ---- Assignments ----
shiftsRouter.get('/shift-assignments', requireCompany, (req, res) => {
  const q = z.object({ employeeId: z.string().optional(), from: z.string(), to: z.string() }).parse(req.query)
  const cid = req.ctx!.companyId!
  const days = new Set(daysBetween(q.from, q.to))
  let rows = db.prepare('SELECT * FROM shift_assignment WHERE company_id = ?').all(cid) as any[]
  rows = rows.filter((r) => days.has(r.work_date) && (!q.employeeId || r.employee_id === q.employeeId))
  const withTemplate = rows
    .map((r) => ({ assignment: mapAssignment(r), template: mapShiftTemplate(db.prepare('SELECT * FROM shift_template WHERE id = ?').get(r.shift_template_id)) }))
    .sort((a, b) => a.assignment.workDate.localeCompare(b.assignment.workDate))
  res.json(withTemplate)
})

/** Personal schedule: own shifts + approved leave overlaid on the calendar (TC-138). */
shiftsRouter.get('/me/schedule', requireCompany, (req, res) => {
  const q = z.object({ from: z.string(), to: z.string() }).parse(req.query)
  const eid = req.ctx!.employeeId
  if (!eid) return res.json({ shifts: [], leaves: [] })
  const cid = req.ctx!.companyId!
  const days = new Set(daysBetween(q.from, q.to))
  const shifts = (db.prepare('SELECT * FROM shift_assignment WHERE company_id=? AND employee_id=?').all(cid, eid) as any[])
    .filter((a) => days.has(a.work_date))
    .map((a) => ({ assignment: mapAssignment(a), template: mapShiftTemplate(db.prepare('SELECT * FROM shift_template WHERE id=?').get(a.shift_template_id)) }))
  const leaves = (db.prepare(`SELECT * FROM leave_request WHERE company_id=? AND employee_id=? AND status='approved'`).all(cid, eid) as any[])
    .filter((l) => q.from <= l.date_end && l.date_start <= q.to)
    .map((l) => ({ id: l.id, type: l.type, dateStart: l.date_start, dateEnd: l.date_end }))
  res.json({ shifts, leaves })
})

/** Bulk-assign a template to employees across a date range (PRD §6.7 bulk apply). */
shiftsRouter.post('/shift-assignments', requireCompany, requireCap('shift_assignment.manage'), (req, res) => {
  const body = z.object({
    employeeIds: z.array(z.string()).min(1),
    shiftTemplateId: z.string(),
    dateStart: z.string(),
    dateEnd: z.string().optional(),
    skipSundays: z.boolean().default(true),
  }).parse(req.body)
  const cid = req.ctx!.companyId!
  const dates = daysBetween(body.dateStart, body.dateEnd ?? body.dateStart).filter((d) => !(body.skipSundays && dow(d) === 0))
  const tpl = db.prepare('SELECT * FROM shift_template WHERE id=? AND company_id=?').get(body.shiftTemplateId, cid) as any
  if (!tpl) return res.status(404).json({ error: 'template_not_found' })
  const span = (t: any): [number, number] => { const s = timeToMin(t.start_time); const e = timeToMin(t.end_time); return [s, t.crosses_midnight || e <= s ? e + 1440 : e] }
  const [ns, ne] = span(tpl)

  const minRest = (db.prepare('SELECT min_rest_hours FROM policy WHERE company_id=?').get(cid) as any)?.min_rest_hours ?? 0
  const prevDay = (iso: string) => { const [y, m, dd] = iso.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1, dd)); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10) }

  const insert = db.prepare(`INSERT OR IGNORE INTO shift_assignment (id, company_id, employee_id, shift_template_id, work_date, status) VALUES (?,?,?,?,?, 'scheduled')`)
  let count = 0, conflicts = 0
  const tx = db.transaction(() => {
    for (const e of body.employeeIds) for (const d of dates) {
      // Reject overlapping assignments for the same employee/day (TC-095).
      const existing = db.prepare('SELECT shift_template_id FROM shift_assignment WHERE company_id=? AND employee_id=? AND work_date=?').all(cid, e, d) as any[]
      const overlap = existing.some((row) => {
        if (row.shift_template_id === tpl.id) return false
        const ot = db.prepare('SELECT * FROM shift_template WHERE id=?').get(row.shift_template_id) as any
        if (!ot) return false
        const [os, oe] = span(ot)
        return ns < oe && os < ne
      })
      if (overlap) { conflicts++; continue }
      // Reject if rest gap from the previous day's shift is below the policy minimum (TC-096).
      if (minRest > 0) {
        const prev = db.prepare('SELECT shift_template_id FROM shift_assignment WHERE company_id=? AND employee_id=? AND work_date=?').all(cid, e, prevDay(d)) as any[]
        const tooClose = prev.some((row) => {
          const ot = db.prepare('SELECT * FROM shift_template WHERE id=?').get(row.shift_template_id) as any
          if (!ot) return false
          const [, prevEnd] = span(ot) // minutes from previous day's midnight
          const gapHours = (1440 + ns - prevEnd) / 60
          return gapHours < minRest
        })
        if (tooClose) { conflicts++; continue }
      }
      const r = insert.run(id('sa'), cid, e, body.shiftTemplateId, d)
      if (r.changes > 0) count++
    }
  })
  tx()
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: 'shift_assignment.bulk', metadata: { employees: body.employeeIds.length, dates: dates.length, conflicts } })
  res.json({ created: count, conflicts })
})

/** Rotation pattern (PRD §6.7): cycle a list of templates (null = libur) across days. */
shiftsRouter.post('/shift-assignments/rotation', requireCompany, requireCap('shift_assignment.manage'), (req, res) => {
  const body = z.object({
    employeeIds: z.array(z.string()).min(1),
    pattern: z.array(z.string().nullable()).min(1), // template ids; null = day off
    dateStart: z.string(),
    days: z.number().int().positive().max(90),
  }).parse(req.body)
  const cid = req.ctx!.companyId!
  const insert = db.prepare(`INSERT OR IGNORE INTO shift_assignment (id, company_id, employee_id, shift_template_id, work_date, status) VALUES (?,?,?,?,?, 'scheduled')`)
  let created = 0
  const tx = db.transaction(() => {
    for (const e of body.employeeIds) {
      for (let i = 0; i < body.days; i++) {
        const tplId = body.pattern[i % body.pattern.length]
        if (!tplId) continue // libur
        const [y, m, dd] = body.dateStart.split('-').map(Number)
        const x = new Date(Date.UTC(y, m - 1, dd)); x.setUTCDate(x.getUTCDate() + i)
        const r = insert.run(id('sa'), cid, e, tplId, x.toISOString().slice(0, 10))
        if (r.changes > 0) created++
      }
    }
  })
  tx()
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: 'shift_assignment.rotation', metadata: { employees: body.employeeIds.length, days: body.days } })
  res.json({ created })
})
