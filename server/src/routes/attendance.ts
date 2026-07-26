import { Router } from 'express'
import { z } from 'zod'
import { db, now } from '../lib/db.js'
import { id } from '../lib/ids.js'
import { mapAttendance, mapBranch, mapGeofence, mapShiftTemplate, mapAssignment, mapPolicy } from '../lib/map.js'
import { requireCompany, requireCap } from '../lib/context.js'
import { evaluateGeofence } from '../domain/geofence.js'
import { computeTrustScore, trustDecision, type TrustSignals } from '../domain/trust.js'
import { resolveAttendanceStatus } from '../domain/clockInMachine.js'
import { audit } from '../lib/audit.js'

export const attendanceRouter = Router()

function todayInTz(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz }).format(new Date())
}
function minutesNowInTz(tz: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).formatToParts(new Date())
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return h * 60 + m
}
const timeToMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
function haversineKm(lat1: number, lo1: number, lat2: number, lo2: number): number {
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1), dLo = toRad(lo2 - lo1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLo / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

function companyTz(companyId: string): string {
  const c = db.prepare('SELECT timezone FROM company WHERE id = ?').get(companyId) as any
  return c?.timezone ?? 'Asia/Jakarta'
}

function myEmployeeId(req: any): string | null {
  return req.ctx.employeeId ?? null
}

attendanceRouter.get('/attendance/today-context', requireCompany, (req, res) => {
  const cid = req.ctx!.companyId!
  const employeeId = myEmployeeId(req)
  if (!employeeId) return res.json({ kind: 'none', assignment: null, template: null, branch: null, geofence: null, record: null })
  const today = todayInTz(companyTz(cid))
  const aRow = db.prepare('SELECT * FROM shift_assignment WHERE company_id=? AND employee_id=? AND work_date=?').get(cid, employeeId, today) as any
  if (!aRow) return res.json({ kind: 'none', assignment: null, template: null, branch: null, geofence: null, record: null })
  const template = db.prepare('SELECT * FROM shift_template WHERE id=?').get(aRow.shift_template_id) as any
  const emp = db.prepare('SELECT * FROM employee_profile WHERE id=?').get(employeeId) as any
  const branch = db.prepare('SELECT * FROM branch WHERE id=?').get(emp.branch_id) as any
  const geofence = db.prepare('SELECT * FROM geofence WHERE company_id=? AND branch_id=?').get(cid, emp.branch_id) as any
  const record = db.prepare('SELECT * FROM attendance_record WHERE company_id=? AND employee_id=? AND work_date=?').get(cid, employeeId, today) as any
  const kind = record ? (record.clock_out_at ? 'none' : 'out') : 'in'
  res.json({
    kind,
    assignment: mapAssignment(aRow),
    template: template ? mapShiftTemplate(template) : null,
    branch: branch ? mapBranch(branch) : null,
    geofence: geofence ? mapGeofence(geofence) : null,
    record: record ? mapAttendance(record) : null,
  })
})

attendanceRouter.post('/attendance/clock', requireCompany, (req, res) => {
  const body = z.object({
    kind: z.enum(['in', 'out']),
    lat: z.number(), long: z.number(), gpsAccuracyM: z.number(),
    livenessPassed: z.boolean().nullable(),
    cameraAvailable: z.boolean(),
    photoData: z.string().optional(),
    idempotencyKey: z.string().min(8),
    eventTimeClient: z.string().optional(),
    submittedOffline: z.boolean().optional(),
  }).parse(req.body)
  const cid = req.ctx!.companyId!
  const employeeId = myEmployeeId(req)
  if (!employeeId) return res.status(400).json({ error: 'no_employee_profile' })

  // Idempotency (PRD §6.9 dobel submit)
  const dup = db.prepare('SELECT id FROM attendance_event WHERE idempotency_key = ?').get(body.idempotencyKey)
  if (dup) {
    const rec = db.prepare('SELECT * FROM attendance_record WHERE company_id=? AND employee_id=? AND work_date=?').get(cid, employeeId, todayInTz(companyTz(cid))) as any
    return res.json({ record: rec ? mapAttendance(rec) : null, trustScore: rec?.trust_score ?? 100, decision: 'accepted', reasons: [], duplicate: true })
  }

  const tz = companyTz(cid)
  const today = todayInTz(tz)
  const emp = db.prepare('SELECT * FROM employee_profile WHERE id=?').get(employeeId) as any
  const aRow = db.prepare('SELECT * FROM shift_assignment WHERE company_id=? AND employee_id=? AND work_date=?').get(cid, employeeId, today) as any
  const template = aRow ? db.prepare('SELECT * FROM shift_template WHERE id=?').get(aRow.shift_template_id) as any : null
  const geofence = db.prepare('SELECT * FROM geofence WHERE company_id=? AND branch_id=?').get(cid, emp.branch_id) as any
  const policy = mapPolicy(db.prepare('SELECT * FROM policy WHERE company_id=?').get(cid))

  const geoEval = geofence
    ? evaluateGeofence({ lat: body.lat, long: body.long }, mapGeofence(geofence))
    : { result: 'inside' as const, distanceM: null }

  // Impossible-travel: compare with the employee's last event (PRD §7.3.4 / TC-122).
  let impossibleTravel = false
  const last = db.prepare('SELECT lat, long, event_time_server FROM attendance_event WHERE company_id=? AND attendance_record_id IN (SELECT id FROM attendance_record WHERE company_id=? AND employee_id=?) AND lat IS NOT NULL ORDER BY event_time_server DESC LIMIT 1').get(cid, cid, employeeId) as any
  if (last) {
    const distKm = haversineKm(last.lat, last.long, body.lat, body.long)
    const hours = Math.max((Date.now() - new Date(last.event_time_server).getTime()) / 3.6e6, 1 / 3600)
    if (distKm / hours > 200) impossibleTravel = true // >200 km/h is implausible
  }

  const signals: TrustSignals = {
    geofenceResult: geoEval.result,
    gpsAccuracyM: body.gpsAccuracyM,
    ipGeoConsistent: geoEval.result !== 'outside',
    impossibleTravel,
    deviceConsistent: true,
    livenessPassed: body.cameraAvailable ? body.livenessPassed : null,
    withinShiftWindow: true,
  }
  const trust = computeTrustScore(signals)
  const decision = trustDecision(trust.score, policy.trustThresholds, policy.strictGeofence)
  if (decision === 'rejected') {
    return res.status(422).json({ error: 'rejected_strict_geofence', trustScore: trust.score, reasons: trust.reasons })
  }

  const nowMin = minutesNowInTz(tz)
  const startMin = template ? timeToMin(template.start_time) : nowMin
  const tol = template?.late_tolerance_minutes ?? 0
  const { status, lateMinutes } = body.kind === 'in' ? resolveAttendanceStatus(nowMin, startMin, tol) : { status: 'on_time' as const, lateMinutes: 0 }

  let rec = db.prepare('SELECT * FROM attendance_record WHERE company_id=? AND employee_id=? AND work_date=?').get(cid, employeeId, today) as any
  const tx = db.transaction(() => {
    if (!rec && body.kind === 'in') {
      const rid = id('att')
      db.prepare(`INSERT INTO attendance_record (id, company_id, employee_id, branch_id, work_date, shift_assignment_id, status, late_minutes, trust_score, clock_in_at, created_at)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(rid, cid, employeeId, emp.branch_id, today, aRow?.id ?? null, status, lateMinutes, trust.score, now(), now())
      rec = db.prepare('SELECT * FROM attendance_record WHERE id=?').get(rid)
    } else if (rec && body.kind === 'out') {
      // Mark "pulang cepat" when clocking out before the shift end (non-overnight shifts).
      let leftEarly = 0
      if (template && !template.crosses_midnight && nowMin < timeToMin(template.end_time)) leftEarly = 1
      db.prepare('UPDATE attendance_record SET clock_out_at=?, left_early=?, trust_score=MIN(trust_score, ?) WHERE id=?').run(now(), leftEarly, trust.score, rec.id)
      rec = db.prepare('SELECT * FROM attendance_record WHERE id=?').get(rec.id)
      // Auto-detected overtime → DRAFT for confirmation, not auto-counted (PRD §6.6 / TC-110/125).
      if (template && !template.crosses_midnight && nowMin > timeToMin(template.end_time)) {
        const otHours = Math.round(((nowMin - timeToMin(template.end_time)) / 60) * 100) / 100
        if (otHours >= 0.5) db.prepare(`INSERT INTO overtime_request (id, company_id, employee_id, work_date, hours, day_type, status, is_draft, created_at) VALUES (?,?,?,?,?, 'workday', 'pending', 1, ?)`).run(id('ot'), cid, employeeId, today, otHours, now())
      }
    } else if (!rec && body.kind === 'out') {
      // out without an in — create a record marked accordingly
      const rid = id('att')
      db.prepare(`INSERT INTO attendance_record (id, company_id, employee_id, branch_id, work_date, shift_assignment_id, status, late_minutes, trust_score, clock_out_at, created_at)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(rid, cid, employeeId, emp.branch_id, today, aRow?.id ?? null, 'on_time', 0, trust.score, now(), now())
      rec = db.prepare('SELECT * FROM attendance_record WHERE id=?').get(rid)
    }
    const offline = body.submittedOffline ? 1 : 0
    db.prepare(`INSERT INTO attendance_event (id, company_id, attendance_record_id, type, event_time_client, event_time_server, lat, long, gps_accuracy, ip, photo_data, liveness_passed, geofence_result, submitted_offline, late_submitted, idempotency_key)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id('evt'), cid, rec.id, body.kind === 'in' ? 'clock_in' : 'clock_out', body.eventTimeClient ?? null, now(),
      body.lat, body.long, body.gpsAccuracyM, req.ip ?? null, body.photoData ?? null,
      body.livenessPassed == null ? null : body.livenessPassed ? 1 : 0, geoEval.result, offline, offline, body.idempotencyKey,
    )
  })
  tx()
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: `attendance.${body.kind}`, target: rec.id, metadata: { trust: trust.score, geofence: geoEval.result } })
  res.json({ record: mapAttendance(rec), trustScore: trust.score, decision, reasons: trust.reasons })
})

// ---- Dashboard ----
function inScope(req: any, branchId: string): boolean {
  const scope = req.ctx.actor.membership.scopeBranchIds
  return scope.length === 0 || scope.includes(branchId)
}
/** Employees may only ever see their OWN attendance (tenant/role isolation). */
function selfId(req: any): string | null {
  return req.ctx.actor.membership.role === 'employee' ? (req.ctx.employeeId ?? '∅') : null
}
const divisionOf = (employeeId: string) => (db.prepare('SELECT division_id FROM employee_profile WHERE id=?').get(employeeId) as any)?.division_id
/** Combined visibility: branch scope + employee-self + optional division filter. */
function visibleRec(req: any, r: any, branchId?: string, divisionId?: string): boolean {
  const self = selfId(req)
  if (self && r.employee_id !== self) return false
  if (branchId && r.branch_id !== branchId) return false
  if (divisionId && divisionOf(r.employee_id) !== divisionId) return false
  return inScope(req, r.branch_id)
}

attendanceRouter.get('/dashboard/summary', requireCompany, requireCap('dashboard.view'), (req, res) => {
  const cid = req.ctx!.companyId!
  const branchId = (req.query.branchId as string) || undefined
  const divisionId = (req.query.divisionId as string) || undefined
  const today = todayInTz(companyTz(cid))
  const emps = (db.prepare('SELECT * FROM employee_profile WHERE company_id=?').all(cid) as any[]).filter((e) => (!branchId || e.branch_id === branchId) && (!divisionId || e.division_id === divisionId) && inScope(req, e.branch_id))
  const att = (db.prepare('SELECT * FROM attendance_record WHERE company_id=? AND work_date=?').all(cid, today) as any[]).filter((r) => visibleRec(req, r, branchId, divisionId))
  const assigned = (db.prepare('SELECT * FROM shift_assignment WHERE company_id=? AND work_date=?').all(cid, today) as any[]).filter((a) => {
    const e = db.prepare('SELECT branch_id, division_id FROM employee_profile WHERE id=?').get(a.employee_id) as any
    return e && (!branchId || e.branch_id === branchId) && (!divisionId || e.division_id === divisionId) && inScope(req, e.branch_id)
  })
  const onLeave = (db.prepare(`SELECT * FROM leave_request WHERE company_id=? AND status='approved' AND date_start<=? AND date_end>=?`).all(cid, today, today) as any[]).length
  const overtime = (db.prepare(`SELECT * FROM overtime_request WHERE company_id=? AND work_date=? AND status='approved'`).all(cid, today) as any[]).length
  res.json({
    present: att.length,
    late: att.filter((r) => r.status === 'late').length,
    notYet: Math.max(0, assigned.length - att.length),
    onLeave, overtime, totalEmployees: emps.length,
  })
})

const withTimes = (r: any) => ({
  ...mapAttendance(r),
  name: (db.prepare('SELECT name FROM employee_profile WHERE id=?').get(r.employee_id) as any)?.name ?? '—',
  clockInAt: r.clock_in_at, clockOutAt: r.clock_out_at, leftEarly: !!r.left_early,
})

attendanceRouter.get('/attendance/feed', requireCompany, requireCap('attendance.view'), (req, res) => {
  const cid = req.ctx!.companyId!
  const branchId = (req.query.branchId as string) || undefined
  const divisionId = (req.query.divisionId as string) || undefined
  const today = todayInTz(companyTz(cid))
  let rows = db.prepare('SELECT * FROM attendance_record WHERE company_id=? AND work_date=? ORDER BY created_at DESC').all(cid, today) as any[]
  rows = rows.filter((r) => visibleRec(req, r, branchId, divisionId))
  res.json(rows.map(withTimes))
})

/** Self attendance history for the signed-in employee (UC-31; strictly own data). */
attendanceRouter.get('/me/attendance', requireCompany, (req, res) => {
  const q = z.object({ from: z.string(), to: z.string() }).parse(req.query)
  const eid = req.ctx!.employeeId
  if (!eid) return res.json([])
  const rows = db.prepare('SELECT * FROM attendance_record WHERE company_id=? AND employee_id=? AND work_date>=? AND work_date<=? ORDER BY work_date DESC').all(req.ctx!.companyId, eid, q.from, q.to) as any[]
  res.json(rows.map(withTimes))
})

/** Full attendance list for a date range (reports/export, PRD §7.4.3). */
attendanceRouter.get('/attendance/list', requireCompany, requireCap('attendance.view'), (req, res) => {
  const cid = req.ctx!.companyId!
  const q = z.object({ from: z.string(), to: z.string(), branchId: z.string().optional(), divisionId: z.string().optional() }).parse(req.query)
  let rows = db.prepare('SELECT * FROM attendance_record WHERE company_id=? AND work_date>=? AND work_date<=? ORDER BY work_date DESC, created_at DESC').all(cid, q.from, q.to) as any[]
  rows = rows.filter((r) => visibleRec(req, r, q.branchId, q.divisionId))
  const branchName = (id: string) => (db.prepare('SELECT name FROM branch WHERE id=?').get(id) as any)?.name ?? '—'
  res.json(rows.map((r) => ({ ...withTimes(r), branchName: branchName(r.branch_id) })))
})

attendanceRouter.get('/attendance/anomalies', requireCompany, requireCap('attendance.view'), (req, res) => {
  const cid = req.ctx!.companyId!
  const branchId = (req.query.branchId as string) || undefined
  const today = todayInTz(companyTz(cid))
  const policy = mapPolicy(db.prepare('SELECT * FROM policy WHERE company_id=?').get(cid))
  let rows = db.prepare('SELECT * FROM attendance_record WHERE company_id=? AND work_date=? AND trust_score < ? ORDER BY trust_score').all(cid, today, policy.trustThresholds.review) as any[]
  rows = rows.filter((r) => visibleRec(req, r, branchId))
  res.json(rows.map(withTimes))
})

/** Reasons a record was flagged, derived from its events (for human review). */
function reasonsFor(events: any[]): string[] {
  const out: string[] = []
  for (const e of events) {
    if (e.geofence_result === 'outside') out.push('Di luar area kerja (outside geofence)')
    else if (e.geofence_result === 'near') out.push('Di tepi area (near geofence)')
    if (e.gps_accuracy > 100) out.push('Akurasi GPS rendah (kemungkinan bukan GPS)')
    if (e.liveness_passed === 0) out.push('Verifikasi liveness gagal')
  }
  return [...new Set(out)]
}

attendanceRouter.get('/attendance/:id', requireCompany, requireCap('attendance.view'), (req, res) => {
  const cid = req.ctx!.companyId!
  const rec = db.prepare('SELECT * FROM attendance_record WHERE id=? AND company_id=?').get(req.params.id, cid) as any
  if (!rec) return res.status(404).json({ error: 'not_found' })
  if (!inScope(req, rec.branch_id)) return res.status(403).json({ error: 'out_of_scope' })
  const emp = db.prepare('SELECT name FROM employee_profile WHERE id=?').get(rec.employee_id) as any
  const branch = db.prepare('SELECT name FROM branch WHERE id=?').get(rec.branch_id) as any
  const events = db.prepare('SELECT * FROM attendance_event WHERE attendance_record_id=? ORDER BY event_time_server').all(rec.id) as any[]
  res.json({
    ...mapAttendance(rec),
    name: emp?.name ?? '—',
    branchName: branch?.name ?? '—',
    clockInAt: rec.clock_in_at, clockOutAt: rec.clock_out_at, leftEarly: !!rec.left_early,
    reasons: reasonsFor(events),
    events: events.map((e) => ({
      type: e.type, eventTimeServer: e.event_time_server, lat: e.lat, long: e.long,
      gpsAccuracy: e.gps_accuracy, geofenceResult: e.geofence_result,
      livenessPassed: e.liveness_passed, photoData: e.photo_data, submittedOffline: !!e.submitted_offline,
    })),
  })
})

/** Manual correction by an approver (PRD §6.9) — audited; can resolve a flag. */
attendanceRouter.post('/attendance/:id/correct', requireCompany, requireCap('attendance.correct'), (req, res) => {
  const body = z.object({
    status: z.enum(['on_time', 'late', 'absent']).optional(),
    lateMinutes: z.number().int().nonnegative().optional(),
    clockOutAt: z.string().optional(),
    resolveFlag: z.boolean().optional(),
    reason: z.string().min(1),
  }).parse(req.body)
  const cid = req.ctx!.companyId!
  const rec = db.prepare('SELECT * FROM attendance_record WHERE id=? AND company_id=?').get(req.params.id, cid) as any
  if (!rec) return res.status(404).json({ error: 'not_found' })
  if (!inScope(req, rec.branch_id)) return res.status(403).json({ error: 'out_of_scope' })
  const policy = mapPolicy(db.prepare('SELECT * FROM policy WHERE company_id=?').get(cid))
  const newTrust = body.resolveFlag ? Math.max(rec.trust_score, policy.trustThresholds.review) : rec.trust_score
  db.prepare('UPDATE attendance_record SET status=?, late_minutes=?, clock_out_at=?, trust_score=? WHERE id=?').run(
    body.status ?? rec.status, body.lateMinutes ?? rec.late_minutes, body.clockOutAt ?? rec.clock_out_at, newTrust, rec.id,
  )
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: 'attendance.correct', target: rec.id, metadata: { reason: body.reason, status: body.status, lateMinutes: body.lateMinutes, resolveFlag: body.resolveFlag } })
  res.json(mapAttendance(db.prepare('SELECT * FROM attendance_record WHERE id=?').get(rec.id)))
})

/** Daily present/late counts for the last N days (dashboard trends, PRD §7.4.2). */
attendanceRouter.get('/dashboard/trends', requireCompany, requireCap('dashboard.view'), (req, res) => {
  const cid = req.ctx!.companyId!
  const branchId = (req.query.branchId as string) || undefined
  const days = Math.min(31, Math.max(1, Number(req.query.days ?? 7)))
  const tz = companyTz(cid)
  const today = todayInTz(tz)
  const [ty, tm, td] = today.split('-').map(Number)
  const out: Array<{ date: string; present: number; late: number }> = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(ty, tm - 1, td))
    d.setUTCDate(d.getUTCDate() - i)
    const date = d.toISOString().slice(0, 10)
    let rows = db.prepare('SELECT status, branch_id FROM attendance_record WHERE company_id=? AND work_date=?').all(cid, date) as any[]
    rows = rows.filter((r) => (!branchId || r.branch_id === branchId) && inScope(req, r.branch_id))
    out.push({ date, present: rows.length, late: rows.filter((r) => r.status === 'late').length })
  }
  res.json(out)
})
