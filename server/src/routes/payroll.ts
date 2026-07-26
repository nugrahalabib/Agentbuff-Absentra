import { Router } from 'express'
import { z } from 'zod'
import { db } from '../lib/db.js'
import { mapPolicy } from '../lib/map.js'
import { requireCompany, requireCap } from '../lib/context.js'
import { computeRecapRow, type OvertimeBlock } from '../domain/payroll.js'
import { audit } from '../lib/audit.js'

export const payrollRouter = Router()

function daysBetween(startISO: string, endISO: string): string[] {
  const out: string[] = []
  const [sy, sm, sd] = startISO.split('-').map(Number)
  const [ey, em, ed] = endISO.split('-').map(Number)
  const d = new Date(Date.UTC(sy, sm - 1, sd))
  const end = new Date(Date.UTC(ey, em - 1, ed))
  while (d <= end) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1) }
  return out
}

const LEAVE_LABEL: Record<string, string> = {
  tahunan: 'Cuti tahunan',
  sakit: 'Sakit',
  izin: 'Izin',
  tanpa_bayar: 'Tanpa bayar',
}

/** Payroll recap (PP 35/2021 engine). Produces a payroll-READY recap, never disburses (NG2). */
payrollRouter.post('/reports/payroll', requireCompany, requireCap('report.payroll.generate'), (req, res) => {
  const body = z.object({ periodStart: z.string(), periodEnd: z.string(), branchId: z.string().optional() }).parse(req.body)
  const cid = req.ctx!.companyId!
  const company = db.prepare('SELECT * FROM company WHERE id=?').get(cid) as any
  const policy = mapPolicy(db.prepare('SELECT * FROM policy WHERE company_id=?').get(cid))
  const scope = req.ctx!.actor!.membership.scopeBranchIds
  const period = new Set(daysBetween(body.periodStart, body.periodEnd))

  let emps = db.prepare('SELECT * FROM employee_profile WHERE company_id=?').all(cid) as any[]
  if (body.branchId) emps = emps.filter((e) => e.branch_id === body.branchId)
  if (scope.length) emps = emps.filter((e) => scope.includes(e.branch_id))

  const rows = emps.map((e) => {
    const recs = (db.prepare('SELECT * FROM attendance_record WHERE company_id=? AND employee_id=?').all(cid, e.id) as any[]).filter((r) => period.has(r.work_date))
    const presentDays = recs.length
    const lateMinutesTotal = recs.reduce((s, r) => s + r.late_minutes, 0)
    const assigned = (db.prepare('SELECT * FROM shift_assignment WHERE company_id=? AND employee_id=?').all(cid, e.id) as any[]).filter((a) => period.has(a.work_date))
    const recordedDates = new Set(recs.map((r) => r.work_date))
    const approvedLeaveDates = new Set(
      (db.prepare(`SELECT * FROM leave_request WHERE company_id=? AND employee_id=? AND status='approved'`).all(cid, e.id) as any[])
        .flatMap((l) => daysBetween(l.date_start, l.date_end)),
    )
    const absentDays = assigned.filter((a) => !recordedDates.has(a.work_date) && !approvedLeaveDates.has(a.work_date)).length
    const leaveDays = [...approvedLeaveDates].filter((d) => period.has(d)).length
    const overtimeBlocks: OvertimeBlock[] = (db.prepare(`SELECT * FROM overtime_request WHERE company_id=? AND employee_id=? AND status='approved'`).all(cid, e.id) as any[])
      .filter((o) => period.has(o.work_date))
      .map((o) => ({ workDate: o.work_date, hours: o.hours, dayType: o.day_type }))

    return computeRecapRow({
      employeeId: e.id, name: e.name,
      wageBasic: e.wage_basic, wageFixedAllowance: e.wage_fixed_allowance, wageVariableAllowance: e.wage_variable_allowance,
      includeVariable: e.wage_variable_allowance > 0,
      workweek: company.workweek_type,
      presentDays, lateMinutesTotal, absentDays, leaveDays, overtimeBlocks, policy,
    })
  })
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: 'report.payroll.generate', metadata: { period: `${body.periodStart}..${body.periodEnd}`, rows: rows.length } })
  res.json(rows)
})

/**
 * Periodic per-employee report: identity + summary (absensi/izin/cuti/lembur) + daily detail.
 * Single source for UI print/CSV and MCP.
 */
payrollRouter.get('/reports/employee', requireCompany, requireCap('report.export'), (req, res) => {
  const q = z.object({
    employeeId: z.string().min(1),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).parse(req.query)

  const cid = req.ctx!.companyId!
  const company = db.prepare('SELECT * FROM company WHERE id=?').get(cid) as any
  const emp = db.prepare('SELECT * FROM employee_profile WHERE id=? AND company_id=?').get(q.employeeId, cid) as any
  if (!emp) return res.status(404).json({ error: 'not_found' })

  const scope = req.ctx!.actor!.membership.scopeBranchIds
  if (scope.length && !scope.includes(emp.branch_id)) return res.status(403).json({ error: 'out_of_scope' })

  const branch = db.prepare('SELECT * FROM branch WHERE id=? AND company_id=?').get(emp.branch_id, cid) as any
  const division = emp.division_id
    ? db.prepare('SELECT * FROM division WHERE id=? AND company_id=?').get(emp.division_id, cid) as any
    : null
  const policy = mapPolicy(db.prepare('SELECT * FROM policy WHERE company_id=?').get(cid))
  const period = new Set(daysBetween(q.from, q.to))
  const periodDays = daysBetween(q.from, q.to)

  const recs = (db.prepare('SELECT * FROM attendance_record WHERE company_id=? AND employee_id=?').all(cid, emp.id) as any[])
    .filter((r) => period.has(r.work_date))
  const recByDate = new Map(recs.map((r) => [r.work_date, r]))

  const assigned = (db.prepare('SELECT * FROM shift_assignment WHERE company_id=? AND employee_id=?').all(cid, emp.id) as any[])
    .filter((a) => period.has(a.work_date))
  const assignByDate = new Map(assigned.map((a) => [a.work_date, a]))
  const templates = new Map(
    (db.prepare('SELECT * FROM shift_template WHERE company_id=?').all(cid) as any[]).map((t) => [t.id, t]),
  )

  const leaves = (db.prepare(`SELECT * FROM leave_request WHERE company_id=? AND employee_id=? AND status='approved'`).all(cid, emp.id) as any[])
    .filter((l) => daysBetween(l.date_start, l.date_end).some((d) => period.has(d)))
  const leaveByDate = new Map<string, { type: string; reason: string | null }>()
  for (const l of leaves) {
    for (const d of daysBetween(l.date_start, l.date_end)) {
      if (period.has(d)) leaveByDate.set(d, { type: l.type, reason: l.reason })
    }
  }

  const ots = (db.prepare(`SELECT * FROM overtime_request WHERE company_id=? AND employee_id=? AND status='approved'`).all(cid, emp.id) as any[])
    .filter((o) => period.has(o.work_date))
  const otByDate = new Map(ots.map((o) => [o.work_date, o]))

  const recordedDates = new Set(recs.map((r) => r.work_date))
  const approvedLeaveDates = new Set(leaveByDate.keys())
  const absentDays = assigned.filter((a) => !recordedDates.has(a.work_date) && !approvedLeaveDates.has(a.work_date)).length
  const lateDays = recs.filter((r) => r.status === 'late' || r.late_minutes > 0).length
  const earlyLeaveDays = recs.filter((r) => r.left_early).length

  const leaveBreakdown: Record<string, number> = {}
  for (const { type } of leaveByDate.values()) {
    leaveBreakdown[type] = (leaveBreakdown[type] ?? 0) + 1
  }

  const overtimeBlocks: OvertimeBlock[] = ots.map((o) => ({
    workDate: o.work_date, hours: o.hours, dayType: o.day_type,
  }))

  const summaryRow = computeRecapRow({
    employeeId: emp.id, name: emp.name,
    wageBasic: emp.wage_basic, wageFixedAllowance: emp.wage_fixed_allowance, wageVariableAllowance: emp.wage_variable_allowance,
    includeVariable: emp.wage_variable_allowance > 0,
    workweek: company.workweek_type,
    presentDays: recs.length,
    lateMinutesTotal: recs.reduce((s, r) => s + r.late_minutes, 0),
    absentDays,
    leaveDays: approvedLeaveDates.size,
    overtimeBlocks,
    policy,
  })

  const days = periodDays.map((date) => {
    const rec = recByDate.get(date)
    const asg = assignByDate.get(date)
    const tmpl = asg ? templates.get(asg.shift_template_id) : null
    const leave = leaveByDate.get(date)
    const ot = otByDate.get(date)
    const notes: string[] = []
    if (leave) notes.push(LEAVE_LABEL[leave.type] ?? leave.type)
    if (ot) notes.push(`Lembur ${ot.hours} jam`)
    if (rec?.left_early) notes.push('Pulang cepat')
    if (!rec && asg && !leave) notes.push('Alpa')

    let status = '—'
    if (leave) status = LEAVE_LABEL[leave.type] ?? leave.type
    else if (rec) status = rec.status === 'on_time' ? 'Tepat waktu' : rec.status === 'late' ? 'Terlambat' : 'Tidak hadir'
    else if (asg) status = 'Alpa'
    else if (ot) status = 'Lembur'

    return {
      date,
      shiftName: tmpl?.name ?? null,
      shiftStart: tmpl?.start_time ?? null,
      shiftEnd: tmpl?.end_time ?? null,
      clockInAt: rec?.clock_in_at ?? null,
      clockOutAt: rec?.clock_out_at ?? null,
      status,
      lateMinutes: rec?.late_minutes ?? 0,
      trustScore: rec?.trust_score ?? null,
      leftEarly: !!rec?.left_early,
      leaveType: leave?.type ?? null,
      overtimeHours: ot?.hours ?? null,
      note: notes.join(' · ') || null,
    }
  }).filter((d) => d.clockInAt || d.leaveType || d.overtimeHours != null || assignByDate.has(d.date))

  audit({
    companyId: cid, actorType: 'user', actorId: req.ctx!.userId,
    action: 'report.employee', target: emp.id,
    metadata: { period: `${q.from}..${q.to}` },
  })

  res.json({
    company: {
      id: company.id,
      displayName: company.display_name,
      logoUrl: company.logo_url ?? null,
      timezone: company.timezone,
    },
    employee: {
      id: emp.id,
      name: emp.name,
      branchName: branch?.name ?? '—',
      divisionName: division?.name ?? null,
    },
    period: { from: q.from, to: q.to },
    summary: {
      presentDays: summaryRow.presentDays,
      lateDays,
      lateMinutesTotal: summaryRow.lateMinutesTotal,
      absentDays: summaryRow.absentDays,
      leaveDays: summaryRow.leaveDays,
      leaveBreakdown,
      earlyLeaveDays,
      overtimeHoursTotal: summaryRow.overtimeHoursTotal,
      overtimePayTotal: summaryRow.overtimePayTotal,
      lateDeduction: summaryRow.lateDeduction,
      mealAllowance: summaryRow.mealAllowance,
    },
    days,
  })
})
