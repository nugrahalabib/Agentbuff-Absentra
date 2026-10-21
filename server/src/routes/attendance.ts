import { Router, type Request } from 'express'
import { z } from 'zod'
import { db, now } from '../lib/db.js'
import { id } from '../lib/ids.js'
import { mapAttendance, mapBranch, mapGeofence, mapShiftTemplate, mapAssignment, mapPolicy } from '../lib/map.js'
import { requireCompany, requireCap } from '../lib/context.js'
import { evaluateGeofence } from '../domain/geofence.js'
import { computeTrustScore, trustDecision, type TrustSignals } from '../domain/trust.js'
import { resolveAttendanceStatus } from '../domain/clockInMachine.js'
import { can, isManager } from '../domain/rbac.js'
import { audit } from '../lib/audit.js'
import { LIMITS } from '../lib/rateLimit.js'
import { ATTENDANCE_PHOTO_MAX_BYTES, PHOTO_MESSAGE, checkImageDataUrl, isoDate, rejectBadRange } from '../lib/validate.js'
import { addDaysIso, companyTz, crossesMidnight, dateInTz, nearestShiftWindow, type ShiftTemplateRow } from '../lib/tenantTime.js'

export const attendanceRouter = Router()

const OPEN_RECORD_WINDOW_MS = 20 * 60 * 60 * 1000 // an unfinished clock-in stays "open" for ~20 h (overnight shifts)
const OFFLINE_MAX_AGE_MS = 72 * 60 * 60 * 1000
const CLOCK_SKEW_MS = 2 * 60 * 1000

function haversineKm(lat1: number, lo1: number, lat2: number, lo2: number): number {
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1), dLo = toRad(lo2 - lo1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLo / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

const templateById = (cid: string, tid: string | null | undefined) =>
  tid ? (db.prepare('SELECT * FROM shift_template WHERE id=? AND company_id=?').get(tid, cid) as (ShiftTemplateRow & Record<string, any>) | undefined) : undefined

/** Most recent clock-in without a clock-out within ~20 h before `at` (overnight shifts). */
function findOpenRecord(cid: string, employeeId: string, at: Date): any | undefined {
  return db.prepare(
    `SELECT * FROM attendance_record WHERE company_id=? AND employee_id=? AND clock_in_at IS NOT NULL AND clock_out_at IS NULL
       AND clock_in_at <= ? AND clock_in_at >= ? ORDER BY clock_in_at DESC LIMIT 1`,
  ).get(cid, employeeId, new Date(at.getTime() + CLOCK_SKEW_MS).toISOString(), new Date(at.getTime() - OPEN_RECORD_WINDOW_MS).toISOString())
}

/**
 * Which scheduled shift a clock-in at `at` belongs to: last night's overnight
 * shift while it is still running (and not yet recorded), otherwise the shift
 * of the event's own date nearest to `at`.
 */
function resolveShiftForClockIn(cid: string, employeeId: string, at: Date, tz: string): { workDate: string; assignment: any | null; template: any | null } {
  const today = dateInTz(at, tz)
  const yesterday = addDaysIso(today, -1)
  const prevRows = db.prepare('SELECT * FROM shift_assignment WHERE company_id=? AND employee_id=? AND work_date=?').all(cid, employeeId, yesterday) as any[]
  for (const a of prevRows) {
    const t = templateById(cid, a.shift_template_id)
    if (!t || !crossesMidnight(t)) continue
    const rec = db.prepare('SELECT id FROM attendance_record WHERE company_id=? AND employee_id=? AND work_date=?').get(cid, employeeId, yesterday)
    const w = nearestShiftWindow(yesterday, t, tz, at)
    if (!rec && at.getTime() < w.end.getTime() && w.start.getTime() <= at.getTime() + 60 * 60_000) return { workDate: yesterday, assignment: a, template: t }
  }
  const rows = db.prepare('SELECT * FROM shift_assignment WHERE company_id=? AND employee_id=? AND work_date=?').all(cid, employeeId, today) as any[]
  let best: { assignment: any; template: any; dist: number } | null = null
  for (const a of rows) {
    const t = templateById(cid, a.shift_template_id)
    if (!t) continue
    const w = nearestShiftWindow(today, t, tz, at)
    const dist = Math.abs(w.start.getTime() - at.getTime())
    if (!best || dist < best.dist) best = { assignment: a, template: t, dist }
  }
  return { workDate: today, assignment: best?.assignment ?? null, template: best?.template ?? null }
}

function myEmployeeId(req: Request): string | null {
  return req.ctx!.employeeId ?? null
}

attendanceRouter.get('/attendance/today-context', requireCompany, (req, res) => {
  const cid = req.ctx!.companyId!
  const employeeId = myEmployeeId(req)
  const none = { kind: 'none', assignment: null, template: null, branch: null, geofence: null, record: null, consent: { location: false, photo: false } }
  if (!employeeId) return res.json(none)
  const tz = companyTz(cid)
  const at = new Date()
  const emp = db.prepare('SELECT * FROM employee_profile WHERE id=? AND company_id=?').get(employeeId, cid) as any
  if (!emp) return res.json(none)
  const consent = { location: !!emp.consent_location_at, photo: !!emp.consent_photo_at }

  let kind: 'in' | 'out' | 'none'
  let record: any = findOpenRecord(cid, employeeId, at)
  let aRow: any = null
  let template: any = null
  if (record) {
    // An unfinished clock-in (incl. an overnight shift that started yesterday) → clock-out.
    kind = 'out'
    aRow = record.shift_assignment_id ? db.prepare('SELECT * FROM shift_assignment WHERE id=? AND company_id=?').get(record.shift_assignment_id, cid) : null
    template = aRow ? templateById(cid, aRow.shift_template_id) : null
  } else {
    const s = resolveShiftForClockIn(cid, employeeId, at, tz)
    if (!s.assignment) return res.json({ ...none, consent })
    aRow = s.assignment
    template = s.template
    record = db.prepare('SELECT * FROM attendance_record WHERE company_id=? AND employee_id=? AND work_date=?').get(cid, employeeId, s.workDate)
    kind = record ? (record.clock_in_at && !record.clock_out_at ? 'out' : 'none') : 'in'
  }
  const branch = db.prepare('SELECT * FROM branch WHERE id=? AND company_id=?').get(emp.branch_id, cid) as any
  const geofence = db.prepare('SELECT * FROM geofence WHERE company_id=? AND branch_id=?').get(cid, emp.branch_id) as any
  res.json({
    kind,
    assignment: aRow ? mapAssignment(aRow) : null,
    template: template ? mapShiftTemplate(template) : null,
    branch: branch ? mapBranch(branch) : null,
    geofence: geofence ? mapGeofence(geofence) : null,
    record: record ? mapAttendance(record) : null,
    consent,
  })
})

function eventResult(cid: string, evt: any) {
  const rec = db.prepare('SELECT * FROM attendance_record WHERE id=? AND company_id=?').get(evt.attendance_record_id, cid) as any
  let reasons: string[] = []
  try { reasons = evt.trust_reasons ? JSON.parse(evt.trust_reasons) : [] } catch { reasons = [] }
  return {
    record: rec ? mapAttendance(rec) : null,
    trustScore: evt.trust_score ?? rec?.trust_score ?? 100,
    decision: evt.decision ?? 'accepted',
    reasons,
    duplicate: true,
  }
}

attendanceRouter.post('/attendance/clock', requireCompany, LIMITS.clock, (req, res) => {
  const body = z.object({
    kind: z.enum(['in', 'out']),
    lat: z.number().min(-90).max(90), long: z.number().min(-180).max(180), gpsAccuracyM: z.number().nonnegative().max(1e7),
    livenessPassed: z.boolean().nullable(),
    cameraAvailable: z.boolean(),
    photoData: z.string().optional(),
    idempotencyKey: z.string().min(8).max(128),
    eventTimeClient: z.string().max(64).optional(),
    submittedOffline: z.boolean().optional(),
  }).parse(req.body)
  const cid = req.ctx!.companyId!
  const actor = req.ctx!.actor!
  const employeeId = myEmployeeId(req)
  if (!employeeId) return res.status(400).json({ error: 'no_employee_profile' })
  if (!can(actor, 'attendance.clock', { ownerEmployeeId: employeeId })) return res.status(403).json({ error: 'forbidden', capability: 'attendance.clock' })
  const emp = db.prepare('SELECT * FROM employee_profile WHERE id=? AND company_id=?').get(employeeId, cid) as any
  if (!emp) return res.status(400).json({ error: 'no_employee_profile' })
  if (emp.employment_status !== 'active') return res.status(403).json({ error: 'employee_inactive' })
  // UU PDP: location is collected only with explicit consent (PRD §2.4.2, §6.3).
  if (!emp.consent_location_at) return res.status(403).json({ error: 'consent_required', message: 'Berikan persetujuan penggunaan lokasi sebelum absen.' })
  // No photo consent → never store a photo, whatever the client sent.
  const photoData = emp.consent_photo_at ? body.photoData : undefined
  if (photoData) {
    const check = checkImageDataUrl(photoData, ATTENDANCE_PHOTO_MAX_BYTES)
    if (!check.ok) return res.status(400).json({ error: check.error, message: PHOTO_MESSAGE[check.error] })
  }

  // Idempotency (PRD §6.9 dobel submit): the key is namespaced per tenant + employee,
  // and a retry returns the ORIGINAL verdict.
  const idemKey = `${cid}:${employeeId}:${body.idempotencyKey}`
  const dup = db.prepare('SELECT * FROM attendance_event WHERE company_id=? AND idempotency_key=?').get(cid, idemKey) as any
  if (dup) return res.json(eventResult(cid, dup))

  // Effective event time: server time, or — for an offline-queued submission —
  // the real (client) time, bounded so it cannot be back/forward-dated freely.
  const serverNow = new Date()
  const offline = body.submittedOffline === true
  let at = serverNow
  if (offline) {
    const t = body.eventTimeClient ? Date.parse(body.eventTimeClient) : NaN
    if (!Number.isFinite(t) || t > serverNow.getTime() + CLOCK_SKEW_MS || t < serverNow.getTime() - OFFLINE_MAX_AGE_MS) {
      return res.status(400).json({ error: 'stale_offline_event', message: 'Absen offline terlalu lama atau waktunya tidak valid (maksimal 72 jam). Silakan absen ulang.' })
    }
    at = new Date(t)
  }
  const atIso = at.toISOString()
  const tz = companyTz(cid)

  // Resolve the record this event belongs to.
  let rec: any
  let aRow: any = null
  let template: any = null
  let workDate: string
  if (body.kind === 'in') {
    const s = resolveShiftForClockIn(cid, employeeId, at, tz)
    workDate = s.workDate
    aRow = s.assignment
    template = s.template
    rec = db.prepare('SELECT * FROM attendance_record WHERE company_id=? AND employee_id=? AND work_date=?').get(cid, employeeId, workDate)
    if (rec?.clock_in_at) return res.status(409).json({ error: 'already_clocked_in', message: 'Anda sudah absen masuk untuk shift ini.', record: mapAttendance(rec) })
  } else {
    rec = findOpenRecord(cid, employeeId, at)
    if (!rec) {
      const todayRec = db.prepare('SELECT * FROM attendance_record WHERE company_id=? AND employee_id=? AND work_date=?').get(cid, employeeId, dateInTz(at, tz)) as any
      if (todayRec?.clock_out_at) return res.status(409).json({ error: 'already_clocked_out', message: 'Anda sudah absen keluar.', record: mapAttendance(todayRec) })
      return res.status(409).json({ error: 'no_open_clock_in', message: 'Belum ada absen masuk yang bisa ditutup. Absen masuk dulu atau minta koreksi ke admin.' })
    }
    workDate = rec.work_date
    aRow = rec.shift_assignment_id ? db.prepare('SELECT * FROM shift_assignment WHERE id=? AND company_id=?').get(rec.shift_assignment_id, cid) : null
    template = aRow ? templateById(cid, aRow.shift_template_id) : null
  }

  const geofence = db.prepare('SELECT * FROM geofence WHERE company_id=? AND branch_id=?').get(cid, emp.branch_id) as any
  const policy = mapPolicy(db.prepare('SELECT * FROM policy WHERE company_id=?').get(cid))
  const geoEval = geofence
    ? evaluateGeofence({ lat: body.lat, long: body.long }, mapGeofence(geofence))
    : { result: 'inside' as const, distanceM: null }

  // Impossible-travel: compare with the employee's previous event (PRD §7.3.4 / TC-122).
  let impossibleTravel = false
  const last = db.prepare(
    `SELECT lat, long, CASE WHEN submitted_offline=1 AND event_time_client IS NOT NULL THEN event_time_client ELSE event_time_server END AS t
       FROM attendance_event WHERE company_id=? AND attendance_record_id IN (SELECT id FROM attendance_record WHERE company_id=? AND employee_id=?) AND lat IS NOT NULL
      ORDER BY t DESC LIMIT 1`,
  ).get(cid, cid, employeeId) as any
  if (last) {
    const distKm = haversineKm(last.lat, last.long, body.lat, body.long)
    const hours = Math.max(Math.abs(at.getTime() - new Date(last.t).getTime()) / 3.6e6, 1 / 3600)
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
    submittedOffline: offline,
    // Photo consent given but no photo arrived (camera off/denied) — transparent deduction.
    photoMissing: !!emp.consent_photo_at && !photoData,
  }
  const trust = computeTrustScore(signals)
  const decision = trustDecision(trust.score, policy.trustThresholds, policy.strictGeofence)
  if (decision === 'rejected') {
    return res.status(422).json({ error: 'rejected_strict_geofence', trustScore: trust.score, reasons: trust.reasons })
  }

  let status: 'on_time' | 'late' = 'on_time'
  let lateMinutes = 0
  if (body.kind === 'in' && template) {
    const w = nearestShiftWindow(workDate, template, tz, at)
    const lateBy = Math.floor((at.getTime() - w.start.getTime()) / 60000)
    const r = resolveAttendanceStatus(lateBy, 0, template.late_tolerance_minutes ?? 0)
    status = r.status
    lateMinutes = r.lateMinutes
  }

  const tx = db.transaction(() => {
    if (body.kind === 'in') {
      if (rec) {
        db.prepare('UPDATE attendance_record SET clock_in_at=?, status=?, late_minutes=?, trust_score=MIN(trust_score, ?) WHERE id=? AND company_id=?')
          .run(atIso, status, lateMinutes, trust.score, rec.id, cid)
      } else {
        const rid = id('att')
        db.prepare(`INSERT INTO attendance_record (id, company_id, employee_id, branch_id, work_date, shift_assignment_id, status, late_minutes, trust_score, clock_in_at, created_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(rid, cid, employeeId, emp.branch_id, workDate, aRow?.id ?? null, status, lateMinutes, trust.score, atIso, now())
        rec = { id: rid }
      }
    } else {
      let leftEarly = 0
      if (template) {
        const w = nearestShiftWindow(rec.work_date, template, tz, new Date(rec.clock_in_at))
        if (at.getTime() < w.end.getTime()) leftEarly = 1 // "pulang cepat"
        // Worked past the shift end → DRAFT overtime for the employee to confirm,
        // never auto-counted (PRD §6.6 / TC-110/125). A manual request for the
        // same date already covers it, so no draft is added then.
        const otHours = Math.round(((at.getTime() - w.end.getTime()) / 3.6e6) * 100) / 100
        const covered = db.prepare(`SELECT id FROM overtime_request WHERE company_id=? AND employee_id=? AND work_date=? AND status IN ('pending','approved')`).get(cid, employeeId, rec.work_date)
        if (otHours >= 0.5 && !covered) {
          db.prepare(`INSERT INTO overtime_request (id, company_id, employee_id, work_date, hours, day_type, status, is_draft, created_at) VALUES (?,?,?,?,?, 'workday', 'pending', 1, ?)`)
            .run(id('ot'), cid, employeeId, rec.work_date, Math.min(otHours, 11), now())
        }
      }
      db.prepare('UPDATE attendance_record SET clock_out_at=?, left_early=?, trust_score=MIN(trust_score, ?) WHERE id=? AND company_id=?').run(atIso, leftEarly, trust.score, rec.id, cid)
    }
    db.prepare(`INSERT INTO attendance_event (id, company_id, attendance_record_id, type, event_time_client, event_time_server, lat, long, gps_accuracy, ip, photo_data, liveness_passed, geofence_result, submitted_offline, late_submitted, idempotency_key, trust_score, trust_reasons, decision)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id('evt'), cid, rec.id, body.kind === 'in' ? 'clock_in' : 'clock_out', body.eventTimeClient ?? null, now(),
      body.lat, body.long, body.gpsAccuracyM, req.ip ?? null, photoData ?? null,
      body.livenessPassed == null ? null : body.livenessPassed ? 1 : 0, geoEval.result, offline ? 1 : 0, offline ? 1 : 0, idemKey,
      trust.score, JSON.stringify(trust.reasons), decision,
    )
  })
  tx()
  const saved = db.prepare('SELECT * FROM attendance_record WHERE id=? AND company_id=?').get(rec.id, cid) as any
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: `attendance.${body.kind}`, target: saved.id, metadata: { trust: trust.score, geofence: geoEval.result, offline } })
  res.json({ record: mapAttendance(saved), trustScore: trust.score, decision, reasons: trust.reasons })
})

// ---- Dashboard ----
function inScope(req: Request, branchId: string): boolean {
  const scope = req.ctx!.actor!.membership.scopeBranchIds
  return scope.length === 0 || scope.includes(branchId)
}
const divisionOf = (cid: string, employeeId: string) => (db.prepare('SELECT division_id FROM employee_profile WHERE id=? AND company_id=?').get(employeeId, cid) as any)?.division_id
/** Combined visibility for manager views: branch scope + optional branch/division filter. */
function visibleRec(req: Request, r: any, branchId?: string, divisionId?: string): boolean {
  if (branchId && r.branch_id !== branchId) return false
  if (divisionId && divisionOf(req.ctx!.companyId!, r.employee_id) !== divisionId) return false
  return inScope(req, r.branch_id)
}
/** Company-wide views (dashboard, feed, list, anomalies) are for managers only. */
function requireManager(req: Request, res: any, next: any) {
  if (!isManager(req.ctx!.actor!.membership.role)) return res.status(403).json({ error: 'forbidden', message: 'Hanya untuk admin/HR.' })
  next()
}

attendanceRouter.get('/dashboard/summary', requireCompany, requireCap('dashboard.view'), requireManager, (req, res) => {
  const cid = req.ctx!.companyId!
  const branchId = (req.query.branchId as string) || undefined
  const divisionId = (req.query.divisionId as string) || undefined
  const today = dateInTz(new Date(), companyTz(cid))
  const emps = (db.prepare(`SELECT * FROM employee_profile WHERE company_id=? AND employment_status='active'`).all(cid) as any[])
    .filter((e) => (!branchId || e.branch_id === branchId) && (!divisionId || e.division_id === divisionId) && inScope(req, e.branch_id))
  const empIds = new Set(emps.map((e) => e.id))
  const att = (db.prepare('SELECT * FROM attendance_record WHERE company_id=? AND work_date=?').all(cid, today) as any[])
    .filter((r) => visibleRec(req, r, branchId, divisionId) && r.status !== 'absent')
  const assigned = (db.prepare('SELECT * FROM shift_assignment WHERE company_id=? AND work_date=?').all(cid, today) as any[]).filter((a) => empIds.has(a.employee_id))
  const onLeave = (db.prepare(`SELECT * FROM leave_request WHERE company_id=? AND status='approved' AND date_start<=? AND date_end>=?`).all(cid, today, today) as any[]).filter((l) => empIds.has(l.employee_id)).length
  const overtime = (db.prepare(`SELECT * FROM overtime_request WHERE company_id=? AND work_date=? AND status='approved'`).all(cid, today) as any[]).filter((o) => empIds.has(o.employee_id)).length
  res.json({
    present: att.length,
    late: att.filter((r) => r.status === 'late').length,
    notYet: Math.max(0, assigned.length - att.length),
    onLeave, overtime, totalEmployees: emps.length,
  })
})

const withTimes = (r: any) => ({
  ...mapAttendance(r),
  name: (db.prepare('SELECT name FROM employee_profile WHERE id=? AND company_id=?').get(r.employee_id, r.company_id) as any)?.name ?? '—',
  clockInAt: r.clock_in_at, clockOutAt: r.clock_out_at, leftEarly: !!r.left_early,
})

attendanceRouter.get('/attendance/feed', requireCompany, requireCap('attendance.view'), requireManager, (req, res) => {
  const cid = req.ctx!.companyId!
  const branchId = (req.query.branchId as string) || undefined
  const divisionId = (req.query.divisionId as string) || undefined
  const today = dateInTz(new Date(), companyTz(cid))
  let rows = db.prepare('SELECT * FROM attendance_record WHERE company_id=? AND work_date=? ORDER BY created_at DESC').all(cid, today) as any[]
  rows = rows.filter((r) => visibleRec(req, r, branchId, divisionId))
  res.json(rows.map(withTimes))
})

/** Self attendance history for the signed-in employee (UC-31; strictly own data). */
attendanceRouter.get('/me/attendance', requireCompany, (req, res) => {
  const q = z.object({ from: isoDate, to: isoDate }).parse(req.query)
  if (rejectBadRange(res, q.from, q.to)) return
  const eid = req.ctx!.employeeId
  if (!eid) return res.json([])
  const rows = db.prepare('SELECT * FROM attendance_record WHERE company_id=? AND employee_id=? AND work_date>=? AND work_date<=? ORDER BY work_date DESC').all(req.ctx!.companyId, eid, q.from, q.to) as any[]
  res.json(rows.map(withTimes))
})

/** Full attendance list for a date range (reports/export, PRD §7.4.3). */
attendanceRouter.get('/attendance/list', requireCompany, requireCap('attendance.view'), requireManager, (req, res) => {
  const cid = req.ctx!.companyId!
  const q = z.object({ from: isoDate, to: isoDate, branchId: z.string().optional(), divisionId: z.string().optional() }).parse(req.query)
  if (rejectBadRange(res, q.from, q.to)) return
  let rows = db.prepare('SELECT * FROM attendance_record WHERE company_id=? AND work_date>=? AND work_date<=? ORDER BY work_date DESC, created_at DESC').all(cid, q.from, q.to) as any[]
  rows = rows.filter((r) => visibleRec(req, r, q.branchId, q.divisionId))
  const branchName = (bid: string) => (db.prepare('SELECT name FROM branch WHERE id=? AND company_id=?').get(bid, cid) as any)?.name ?? '—'
  res.json(rows.map((r) => ({ ...withTimes(r), branchName: branchName(r.branch_id) })))
})

attendanceRouter.get('/attendance/anomalies', requireCompany, requireCap('attendance.view'), requireManager, (req, res) => {
  const cid = req.ctx!.companyId!
  const branchId = (req.query.branchId as string) || undefined
  const today = dateInTz(new Date(), companyTz(cid))
  const policy = mapPolicy(db.prepare('SELECT * FROM policy WHERE company_id=?').get(cid))
  let rows = db.prepare('SELECT * FROM attendance_record WHERE company_id=? AND work_date=? AND trust_score < ? ORDER BY trust_score').all(cid, today, policy.trustThresholds.review) as any[]
  rows = rows.filter((r) => visibleRec(req, r, branchId))
  res.json(rows.map(withTimes))
})

/** Reasons a record was flagged: stored trust verdicts + signals derived from the events. */
function reasonsFor(events: any[]): string[] {
  const out: string[] = []
  for (const e of events) {
    if (e.trust_reasons) { try { out.push(...(JSON.parse(e.trust_reasons) as string[])) } catch { /* ignore */ } continue }
    if (e.geofence_result === 'outside') out.push('Absen di luar lokasi kerja')
    else if (e.geofence_result === 'near') out.push('Absen di tepi lokasi kerja')
    if (e.gps_accuracy > 100) out.push('Sinyal GPS lemah')
    if (e.liveness_passed === 0) out.push('Foto tidak lolos pemeriksaan')
  }
  return [...new Set(out)]
}

attendanceRouter.get('/attendance/:id', requireCompany, requireCap('attendance.view'), (req, res) => {
  const cid = req.ctx!.companyId!
  const rec = db.prepare('SELECT * FROM attendance_record WHERE id=? AND company_id=?').get(req.params.id, cid) as any
  if (!rec) return res.status(404).json({ error: 'not_found' })
  // Photos + GPS are sensitive: employees only ever see their own record; managers within their branches.
  if (!can(req.ctx!.actor!, 'attendance.view', { branchId: rec.branch_id, ownerEmployeeId: rec.employee_id })) return res.status(403).json({ error: 'out_of_scope' })
  const emp = db.prepare('SELECT name FROM employee_profile WHERE id=? AND company_id=?').get(rec.employee_id, cid) as any
  const branch = db.prepare('SELECT name FROM branch WHERE id=? AND company_id=?').get(rec.branch_id, cid) as any
  const events = db.prepare('SELECT * FROM attendance_event WHERE attendance_record_id=? AND company_id=? ORDER BY event_time_server').all(rec.id, cid) as any[]
  if (rec.employee_id !== req.ctx!.employeeId) {
    // UU PDP: every access to someone else's location/photo data is audited.
    audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: 'attendance.view_detail', target: rec.id })
  }
  res.json({
    ...mapAttendance(rec),
    name: emp?.name ?? '—',
    branchName: branch?.name ?? '—',
    clockInAt: rec.clock_in_at, clockOutAt: rec.clock_out_at, leftEarly: !!rec.left_early,
    reasons: reasonsFor(events),
    events: events.map((e) => ({
      type: e.type, eventTimeServer: e.event_time_server, eventTimeClient: e.event_time_client ?? null, lat: e.lat, long: e.long,
      gpsAccuracy: e.gps_accuracy, geofenceResult: e.geofence_result,
      livenessPassed: e.liveness_passed, photoData: e.photo_data, submittedOffline: !!e.submitted_offline,
    })),
  })
})

/** Manual correction by an approver (PRD §6.9) — audited; can resolve a flag. */
attendanceRouter.post('/attendance/:id/correct', requireCompany, requireCap('attendance.correct'), (req, res) => {
  const body = z.object({
    status: z.enum(['on_time', 'late', 'absent']).optional(),
    lateMinutes: z.number().int().nonnegative().max(1440).optional(),
    clockOutAt: z.string().datetime({ offset: true }).optional(),
    resolveFlag: z.boolean().optional(),
    reason: z.string().trim().min(1).max(500),
  }).parse(req.body)
  const cid = req.ctx!.companyId!
  const rec = db.prepare('SELECT * FROM attendance_record WHERE id=? AND company_id=?').get(req.params.id, cid) as any
  if (!rec) return res.status(404).json({ error: 'not_found' })
  if (!can(req.ctx!.actor!, 'attendance.correct', { branchId: rec.branch_id })) return res.status(403).json({ error: 'out_of_scope' })
  if (req.ctx!.actor!.membership.role !== 'owner' && rec.employee_id === req.ctx!.employeeId) {
    return res.status(403).json({ error: 'cannot_correct_own_record', message: 'Koreksi kehadiran sendiri harus dilakukan atasan.' })
  }
  if (body.clockOutAt && rec.clock_in_at && new Date(body.clockOutAt).getTime() < new Date(rec.clock_in_at).getTime()) {
    return res.status(400).json({ error: 'invalid_clock_out', message: 'Jam keluar tidak boleh sebelum jam masuk.' })
  }
  const policy = mapPolicy(db.prepare('SELECT * FROM policy WHERE company_id=?').get(cid))
  const newTrust = body.resolveFlag ? Math.max(rec.trust_score, policy.trustThresholds.review) : rec.trust_score
  const newStatus = body.status ?? rec.status
  // on_time / absent carry no lateness unless explicitly given.
  const newLate = body.lateMinutes ?? (body.status === 'on_time' || body.status === 'absent' ? 0 : rec.late_minutes)
  db.prepare('UPDATE attendance_record SET status=?, late_minutes=?, clock_out_at=?, trust_score=? WHERE id=? AND company_id=?').run(
    newStatus, newLate, body.clockOutAt ? new Date(body.clockOutAt).toISOString() : rec.clock_out_at, newTrust, rec.id, cid,
  )
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: 'attendance.correct', target: rec.id, metadata: { reason: body.reason, status: body.status, lateMinutes: newLate, resolveFlag: body.resolveFlag } })
  res.json(mapAttendance(db.prepare('SELECT * FROM attendance_record WHERE id=?').get(rec.id)))
})

/** Daily present/late counts for the last N days (dashboard trends, PRD §7.4.2). */
attendanceRouter.get('/dashboard/trends', requireCompany, requireCap('dashboard.view'), requireManager, (req, res) => {
  const cid = req.ctx!.companyId!
  const branchId = (req.query.branchId as string) || undefined
  const days = Math.min(31, Math.max(1, Number(req.query.days ?? 7) || 7))
  const today = dateInTz(new Date(), companyTz(cid))
  const out: Array<{ date: string; present: number; late: number }> = []
  for (let i = days - 1; i >= 0; i--) {
    const date = addDaysIso(today, -i)
    let rows = db.prepare('SELECT status, branch_id FROM attendance_record WHERE company_id=? AND work_date=?').all(cid, date) as any[]
    rows = rows.filter((r) => (!branchId || r.branch_id === branchId) && inScope(req, r.branch_id) && r.status !== 'absent')
    out.push({ date, present: rows.length, late: rows.filter((r) => r.status === 'late').length })
  }
  res.json(out)
})
