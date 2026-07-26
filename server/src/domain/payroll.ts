/**
 * Payroll Recap Engine — encodes Indonesian overtime law PP No. 35 / 2021.
 * Source of truth: PRD §2.4.1 and §7.4.1. Deterministic, pure functions.
 *
 * NON-NEGOTIABLE: do not hand-roll the multipliers elsewhere — call this module.
 * The engine produces a payroll-READY recap; it never disburses pay (NG2).
 */
import type { DayType, WorkweekType, Policy } from './types'

export const HOURS_DIVISOR = 173 // 40h/wk × 52 ÷ 12 (PRD §2.4.1)

/**
 * Hourly wage. Basis = basic wage + fixed allowance (100%).
 * If variable allowances are folded in, regulation uses a 75% basis.
 */
export function hourlyWage(opts: {
  wageBasic: number
  wageFixedAllowance: number
  wageVariableAllowance?: number
  includeVariable?: boolean
}): number {
  const { wageBasic, wageFixedAllowance, wageVariableAllowance = 0, includeVariable = false } = opts
  const base = includeVariable
    ? (wageBasic + wageFixedAllowance + wageVariableAllowance) * 0.75
    : wageBasic + wageFixedAllowance
  return base / HOURS_DIVISOR
}

/**
 * Per-hour multiplier tiers for non-workday overtime, keyed by day type and
 * workweek type. Each entry is [uptoHour, multiplier], cumulative.
 */
type Tier = { uptoHour: number; multiplier: number }

function nonWorkdayTiers(dayType: DayType, workweek: WorkweekType): Tier[] {
  if (dayType === 'shortest_day') {
    // Holiday falling on the shortest workday
    return [
      { uptoHour: 5, multiplier: 2 },
      { uptoHour: 6, multiplier: 3 },
      { uptoHour: 9, multiplier: 4 },
    ]
  }
  // weekly_rest / public_holiday
  if (workweek === 'six_day') {
    return [
      { uptoHour: 7, multiplier: 2 },
      { uptoHour: 8, multiplier: 3 },
      { uptoHour: 11, multiplier: 4 },
    ]
  }
  // five_day
  return [
    { uptoHour: 8, multiplier: 2 },
    { uptoHour: 9, multiplier: 3 },
    { uptoHour: 11, multiplier: 4 },
  ]
}

/** Sum of multipliers applied per whole/fractional hour up to `hours`. */
function sumTierMultipliers(hours: number, tiers: Tier[]): number {
  let remaining = hours
  let prevCap = 0
  let total = 0
  for (const tier of tiers) {
    if (remaining <= 0) break
    const span = tier.uptoHour - prevCap
    const used = Math.min(remaining, span)
    total += used * tier.multiplier
    remaining -= used
    prevCap = tier.uptoHour
  }
  // Hours beyond the last tier keep the last (highest) multiplier.
  if (remaining > 0 && tiers.length) {
    total += remaining * tiers[tiers.length - 1].multiplier
  }
  return total
}

/**
 * Overtime pay for one approved overtime block.
 * Workday: hour 1 = 1.5×, hour 2+ = 2×.
 * Non-workdays: tiered per the table above.
 */
export function overtimePay(opts: {
  hours: number
  hourlyWage: number
  dayType: DayType
  workweek: WorkweekType
}): number {
  const { hours, hourlyWage: hw, dayType, workweek } = opts
  if (hours <= 0) return 0
  if (dayType === 'workday') {
    const firstHour = Math.min(hours, 1)
    const rest = Math.max(hours - 1, 0)
    return 1.5 * hw * firstHour + 2 * hw * rest
  }
  const multiplierSum = sumTierMultipliers(hours, nonWorkdayTiers(dayType, workweek))
  return hw * multiplierSum
}

// ---- Late deduction (configurable policy, PRD §7.4.1 step 3) ----
export function lateDeduction(lateMinutes: number, policy: Policy): number {
  if (lateMinutes <= 0) return 0
  const cfg = policy.lateDeductionConfig
  switch (policy.lateDeductionMode) {
    case 'grace_flat': {
      const grace = cfg.graceMinutes ?? 0
      return lateMinutes > grace ? cfg.flatAmount ?? 0 : 0
    }
    case 'per_minute':
      return lateMinutes * (cfg.perMinuteRate ?? 0)
    case 'tiered': {
      const tiers = [...(cfg.tiers ?? [])].sort((a, b) => a.uptoMinutes - b.uptoMinutes)
      for (const t of tiers) if (lateMinutes <= t.uptoMinutes) return t.amount
      return tiers.length ? tiers[tiers.length - 1].amount : 0
    }
  }
}

// ---- Meal allowance (PRD §7.4.1 step 4) ----
export function mealAllowance(opts: {
  presentDays: number
  overtimeBlocks: Array<{ hours: number }>
  policy: Policy
}): number {
  const { presentDays, overtimeBlocks, policy } = opts
  const cfg = policy.mealAllowanceConfig
  let total = (cfg.perPresentDay ?? 0) * presentDays
  if (cfg.onOvertimeMinHours != null && cfg.onOvertimeAmount != null) {
    const qualifying = overtimeBlocks.filter((b) => b.hours >= cfg.onOvertimeMinHours!).length
    total += qualifying * cfg.onOvertimeAmount
  }
  return total
}

// ---- Full per-employee recap ----
export interface OvertimeBlock {
  workDate: string
  hours: number
  dayType: DayType
}

export interface PayrollInput {
  employeeId: string
  name: string
  wageBasic: number
  wageFixedAllowance: number
  wageVariableAllowance?: number
  includeVariable?: boolean
  workweek: WorkweekType
  presentDays: number
  lateMinutesTotal: number
  absentDays: number
  leaveDays: number
  overtimeBlocks: OvertimeBlock[]
  policy: Policy
}

export interface OvertimeLine extends OvertimeBlock {
  pay: number
}

export interface PayrollRecapRow {
  employeeId: string
  name: string
  hourlyWage: number
  presentDays: number
  lateMinutesTotal: number
  absentDays: number
  leaveDays: number
  lateDeduction: number
  mealAllowance: number
  overtimeLines: OvertimeLine[]
  overtimeHoursTotal: number
  overtimePayTotal: number
}

/**
 * Compute one employee's payroll-ready recap row. Deterministic.
 *
 * Money convention: Indonesian Rupiah has no practical subunit, so the hourly
 * wage is rounded to whole Rupiah BEFORE applying overtime multipliers — this
 * reproduces the PRD §7.4.1 verified example exactly (Rp4,000,000 → hw Rp23,121
 * → 2h workday OT 3.5 × 23,121 = Rp80,923.5 → Rp80,924).
 */
export function computeRecapRow(input: PayrollInput): PayrollRecapRow {
  const hwExact = hourlyWage({
    wageBasic: input.wageBasic,
    wageFixedAllowance: input.wageFixedAllowance,
    wageVariableAllowance: input.wageVariableAllowance,
    includeVariable: input.includeVariable,
  })
  const hw = Math.round(hwExact) // whole Rupiah

  const overtimeLines: OvertimeLine[] = input.overtimeBlocks.map((b) => ({
    ...b,
    pay: roundRp(overtimePay({ hours: b.hours, hourlyWage: hw, dayType: b.dayType, workweek: input.workweek })),
  }))

  const overtimeHoursTotal = round2(input.overtimeBlocks.reduce((s, b) => s + b.hours, 0))
  const overtimePayTotal = roundRp(overtimeLines.reduce((s, l) => s + l.pay, 0))

  return {
    employeeId: input.employeeId,
    name: input.name,
    hourlyWage: hw,
    presentDays: input.presentDays,
    lateMinutesTotal: input.lateMinutesTotal,
    absentDays: input.absentDays,
    leaveDays: input.leaveDays,
    lateDeduction: roundRp(lateDeduction(input.lateMinutesTotal, input.policy)),
    mealAllowance: roundRp(
      mealAllowance({ presentDays: input.presentDays, overtimeBlocks: input.overtimeBlocks, policy: input.policy }),
    ),
    overtimeLines,
    overtimeHoursTotal,
    overtimePayTotal,
  }
}

/** Round to whole Rupiah. */
export function roundRp(n: number): number {
  return Math.round(n + Number.EPSILON)
}

/** Round to 2 decimals (for non-money quantities like hours). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
