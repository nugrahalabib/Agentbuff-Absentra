/**
 * Shift-assignment rules shared by REST (single, bulk, rotation) and the MCP
 * adapter, so an agent can never schedule what the UI would refuse (PRD §4.9
 * parity, §6.7): no overlapping shifts — including an overnight shift spilling
 * into the next day — and the policy's minimum rest between consecutive shifts.
 */
import { db } from './db.js'
import { addDaysIso, timeToMin, type ShiftTemplateRow } from './tenantTime.js'

export type ShiftConflictReason = 'overlap' | 'min_rest'

/** Minutes from the work date's midnight; overnight shifts end after 1440. */
export function shiftSpan(t: Pick<ShiftTemplateRow, 'start_time' | 'end_time' | 'crosses_midnight'>): [number, number] {
  const s = timeToMin(t.start_time)
  const e = timeToMin(t.end_time)
  return [s, t.crosses_midnight || e <= s ? e + 1440 : e]
}

export function minRestHours(companyId: string): number {
  return (db.prepare('SELECT min_rest_hours FROM policy WHERE company_id=?').get(companyId) as { min_rest_hours?: number } | undefined)?.min_rest_hours ?? 0
}

/**
 * Why `tpl` cannot be assigned to `employeeId` on `date` (null = allowed).
 * An identical assignment that already exists is not a conflict (idempotent).
 */
export function assignmentConflict(companyId: string, employeeId: string, tpl: ShiftTemplateRow, date: string, minRest = minRestHours(companyId)): ShiftConflictReason | null {
  const [ns, ne] = shiftSpan(tpl)
  const templateOf = (tid: string) => db.prepare('SELECT * FROM shift_template WHERE id=? AND company_id=?').get(tid, companyId) as ShiftTemplateRow | undefined
  const onDate = (d: string) => (db.prepare('SELECT shift_template_id FROM shift_assignment WHERE company_id=? AND employee_id=? AND work_date=?').all(companyId, employeeId, d) as { shift_template_id: string }[])
  const minRestMin = Math.max(0, minRest) * 60

  for (const row of onDate(date)) {
    if (row.shift_template_id === tpl.id) continue
    const ot = templateOf(row.shift_template_id)
    if (!ot) continue
    const [os, oe] = shiftSpan(ot)
    if (ns < oe && os < ne) return 'overlap'
  }
  // Previous day's shift (expressed relative to this date's midnight).
  for (const row of onDate(addDaysIso(date, -1))) {
    const ot = templateOf(row.shift_template_id)
    if (!ot) continue
    const [, prevEnd] = shiftSpan(ot)
    const gap = ns - (prevEnd - 1440)
    if (gap < 0) return 'overlap'
    if (minRestMin > 0 && gap < minRestMin) return 'min_rest'
  }
  // Next day's shift.
  for (const row of onDate(addDaysIso(date, 1))) {
    const ot = templateOf(row.shift_template_id)
    if (!ot) continue
    const [nextStart] = shiftSpan(ot)
    const gap = nextStart + 1440 - ne
    if (gap < 0) return 'overlap'
    if (minRestMin > 0 && gap < minRestMin) return 'min_rest'
  }
  return null
}

export const CONFLICT_MESSAGE: Record<ShiftConflictReason, string> = {
  overlap: 'Bertabrakan dengan shift lain di hari yang sama atau berdekatan.',
  min_rest: 'Jeda istirahat antar-shift kurang dari batas minimum kebijakan.',
}
