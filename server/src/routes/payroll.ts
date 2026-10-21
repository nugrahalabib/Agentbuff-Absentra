import { Router } from 'express'
import { z } from 'zod'
import { db } from '../lib/db.js'
import { requireCompany, requireCap } from '../lib/context.js'
import { computeRecapRow } from '../domain/payroll.js'
import { audit } from '../lib/audit.js'
import { isoDate, rejectBadRange } from '../lib/validate.js'
import { daysBetween } from '../lib/tenantTime.js'
import { employeePeriodData, payrollRows } from '../lib/payrollInput.js'

export const payrollRouter = Router()

const LEAVE_LABEL: Record<string, string> = {
  tahunan: 'Cuti tahunan',
  sakit: 'Sakit',
  izin: 'Izin',
  tanpa_bayar: 'Tanpa bayar',
}

/** Payroll recap (PP 35/2021 engine). Produces a payroll-READY recap, never disburses (NG2). */
payrollRouter.post('/reports/payroll', requireCompany, requireCap('report.payroll.generate'), (req, res) => {
  const body = z.object({ periodStart: isoDate, periodEnd: isoDate, branchId: z.string().optional() }).parse(req.body)
  if (rejectBadRange(res, body.periodStart, body.periodEnd)) return
  const cid = req.ctx!.companyId!
  const scope = req.ctx!.actor!.membership.scopeBranchIds

  let emps = db.prepare('SELECT * FROM employee_profile WHERE company_id=?').all(cid) as any[]
  if (body.branchId) emps = emps.filter((e) => e.branch_id === body.branchId)
  if (scope.length) emps = emps.filter((e) => scope.includes(e.branch_id))

  const rows = payrollRows(cid, emps, body.periodStart, body.periodEnd)
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: 'report.payroll.generate', metadata: { period: `${body.periodStart}..${body.periodEnd}`, rows: rows.length } })
  res.json(rows)
})

/**
 * Periodic per-employee report: identity + summary (absensi/izin/cuti/lembur) + daily detail.
 * Single source for UI print/CSV and MCP.
 */
payrollRouter.get('/reports/employee', requireCompany, requireCap('report.export'), (req, res) => {
  const q = z.object({ employeeId: z.string().min(1), from: isoDate, to: isoDate }).parse(req.query)
  if (rejectBadRange(res, q.from, q.to)) return

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

  const data = employeePeriodData(cid, emp, q.from, q.to)
  const summaryRow = computeRecapRow(data.input)
  const recByDate = new Map(data.recs.map((r) => [r.work_date, r]))
  const assignByDate = new Map(data.assigned.map((a) => [a.work_date, a]))
  const templates = new Map((db.prepare('SELECT * FROM shift_template WHERE company_id=?').all(cid) as any[]).map((t) => [t.id, t]))
  const otHoursByDate = new Map<string, number>()
  for (const o of data.countedOvertime) otHoursByDate.set(o.work_date, Math.round(((otHoursByDate.get(o.work_date) ?? 0) + o.hours) * 100) / 100)

  const lateDays = data.presentRecs.filter((r) => r.status === 'late' || r.late_minutes > 0).length
  const earlyLeaveDays = data.presentRecs.filter((r) => r.left_early).length
  const leaveBreakdown: Record<string, number> = {}
  for (const { type } of data.leaveByDate.values()) leaveBreakdown[type] = (leaveBreakdown[type] ?? 0) + 1

  const days = daysBetween(q.from, q.to).map((date) => {
    const rec = recByDate.get(date)
    const asg = assignByDate.get(date)
    const tmpl = asg ? templates.get(asg.shift_template_id) : null
    const leave = data.leaveByDate.get(date)
    const otHours = otHoursByDate.get(date)
    const absent = data.absentDates.has(date)
    const notes: string[] = []
    if (leave) notes.push(LEAVE_LABEL[leave.type] ?? leave.type)
    if (otHours != null) notes.push(`Lembur ${otHours} jam`)
    if (rec?.left_early) notes.push('Pulang cepat')
    if (absent) notes.push('Alpa')

    let status = '—'
    if (leave) status = LEAVE_LABEL[leave.type] ?? leave.type
    else if (rec && rec.status !== 'absent') status = rec.status === 'on_time' ? 'Tepat waktu' : 'Terlambat'
    else if (absent) status = 'Alpa'
    else if (asg) status = 'Terjadwal'
    else if (otHours != null) status = 'Lembur'

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
      overtimeHours: otHours ?? null,
      note: notes.join(' · ') || null,
    }
  }).filter((d) => d.clockInAt || d.leaveType || d.overtimeHours != null || assignByDate.has(d.date) || recByDate.has(d.date))

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
