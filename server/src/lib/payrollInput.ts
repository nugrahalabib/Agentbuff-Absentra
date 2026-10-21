/**
 * Builds the per-employee input for the PP 35/2021 recap engine
 * (domain/payroll.ts). One builder for REST `/reports/payroll`,
 * `/reports/employee`, and MCP `payroll.recap`/`payroll.export`, so the three
 * can never disagree on what counts:
 *   • present days = records whose status is not 'absent' (meal allowance follows),
 *   • absent days = past scheduled days without a present record or approved
 *     leave (future days and today's not-yet-finished shift never count),
 *   • only APPROVED overtime; an approved auto-draft is ignored when a manual
 *     request for the same date is approved too (never paid twice).
 */
import { db } from './db.js'
import { mapPolicy } from './map.js'
import { companyTz, dateInTz, daysBetween, shiftWindow, type ShiftTemplateRow } from './tenantTime.js'
import { computeRecapRow, type OvertimeBlock, type PayrollInput, type PayrollRecapRow } from '../domain/payroll.js'

export interface EmployeePeriodData {
  input: PayrollInput
  recs: any[]
  presentRecs: any[]
  assigned: any[]
  leaveByDate: Map<string, { type: string; reason: string | null }>
  countedOvertime: any[]
  absentDates: Set<string>
}

export function employeePeriodData(companyId: string, emp: any, periodStart: string, periodEnd: string, nowAt = new Date()): EmployeePeriodData {
  const company = db.prepare('SELECT * FROM company WHERE id=?').get(companyId) as any
  const policy = mapPolicy(db.prepare('SELECT * FROM policy WHERE company_id=?').get(companyId))
  const tz = companyTz(companyId)
  const today = dateInTz(nowAt, tz)
  const period = new Set(daysBetween(periodStart, periodEnd))

  const recs = db.prepare('SELECT * FROM attendance_record WHERE company_id=? AND employee_id=? AND work_date>=? AND work_date<=? ORDER BY work_date')
    .all(companyId, emp.id, periodStart, periodEnd) as any[]
  const presentRecs = recs.filter((r) => r.status !== 'absent')
  const presentDates = new Set(presentRecs.map((r) => r.work_date))
  const absentRecDates = new Set(recs.filter((r) => r.status === 'absent').map((r) => r.work_date))

  const assigned = db.prepare('SELECT * FROM shift_assignment WHERE company_id=? AND employee_id=? AND work_date>=? AND work_date<=?')
    .all(companyId, emp.id, periodStart, periodEnd) as any[]

  const leaveByDate = new Map<string, { type: string; reason: string | null }>()
  const leaves = db.prepare(`SELECT * FROM leave_request WHERE company_id=? AND employee_id=? AND status='approved' AND date_start<=? AND date_end>=?`)
    .all(companyId, emp.id, periodEnd, periodStart) as any[]
  for (const l of leaves) for (const d of daysBetween(l.date_start, l.date_end)) if (period.has(d)) leaveByDate.set(d, { type: l.type, reason: l.reason ?? null })

  const templates = new Map((db.prepare('SELECT * FROM shift_template WHERE company_id=?').all(companyId) as ShiftTemplateRow[]).map((t) => [t.id, t]))
  const absentDates = new Set<string>()
  const consider = (date: string, templateId?: string) => {
    if (date > today) return // the future is never "alpa"
    if (presentDates.has(date) || leaveByDate.has(date)) return
    if (templateId) {
      // Today's shift (or last night's overnight shift) that has not ended yet.
      const t = templates.get(templateId)
      if (t && shiftWindow(date, t, tz).end.getTime() > nowAt.getTime()) return
    }
    absentDates.add(date)
  }
  for (const a of assigned) consider(a.work_date, a.shift_template_id)
  for (const d of absentRecDates) consider(d)

  const approvedOts = db.prepare(`SELECT * FROM overtime_request WHERE company_id=? AND employee_id=? AND status='approved' AND work_date>=? AND work_date<=?`)
    .all(companyId, emp.id, periodStart, periodEnd) as any[]
  const manualDates = new Set(approvedOts.filter((o) => !o.is_draft).map((o) => o.work_date))
  const countedOvertime = approvedOts.filter((o) => !o.is_draft || !manualDates.has(o.work_date))
  const overtimeBlocks: OvertimeBlock[] = countedOvertime.map((o) => ({ workDate: o.work_date, hours: o.hours, dayType: o.day_type }))

  const input: PayrollInput = {
    employeeId: emp.id,
    name: emp.name,
    wageBasic: emp.wage_basic,
    wageFixedAllowance: emp.wage_fixed_allowance,
    wageVariableAllowance: emp.wage_variable_allowance,
    includeVariable: emp.wage_variable_allowance > 0,
    workweek: company.workweek_type,
    presentDays: presentRecs.length,
    lateMinutesTotal: presentRecs.reduce((s, r) => s + (r.late_minutes ?? 0), 0),
    absentDays: absentDates.size,
    leaveDays: leaveByDate.size,
    overtimeBlocks,
    policy,
  }
  return { input, recs, presentRecs, assigned, leaveByDate, countedOvertime, absentDates }
}

/** Recap rows for a list of employee rows (already tenant- and scope-filtered by the caller). */
export function payrollRows(companyId: string, emps: any[], periodStart: string, periodEnd: string, nowAt = new Date()): PayrollRecapRow[] {
  return emps.map((e) => computeRecapRow(employeePeriodData(companyId, e, periodStart, periodEnd, nowAt).input))
}
