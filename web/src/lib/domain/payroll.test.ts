import { describe, it, expect } from 'vitest'
import { hourlyWage, overtimePay, lateDeduction, mealAllowance, computeRecapRow, HOURS_DIVISOR } from './payroll'
import type { Policy } from './types'

const basePolicy: Policy = {
  id: 'p1',
  companyId: 'c1',
  lateDeductionMode: 'per_minute',
  lateDeductionConfig: { perMinuteRate: 500 },
  mealAllowanceConfig: { perPresentDay: 0, onOvertimeMinHours: 4, onOvertimeAmount: 25000 },
  strictGeofence: false,
  trustThresholds: { accept: 80, review: 60 },
  photoRetentionDays: 90,
}

describe('hourlyWage (PP 35/2021)', () => {
  it('uses 1/173 of monthly base (basic + fixed allowance)', () => {
    expect(hourlyWage({ wageBasic: 4_000_000, wageFixedAllowance: 0 })).toBeCloseTo(4_000_000 / 173, 5)
    expect(HOURS_DIVISOR).toBe(173)
  })
  it('applies 75% basis when variable allowances are included', () => {
    const hw = hourlyWage({ wageBasic: 3_000_000, wageFixedAllowance: 500_000, wageVariableAllowance: 500_000, includeVariable: true })
    expect(hw).toBeCloseTo((4_000_000 * 0.75) / 173, 5)
  })
})

describe('overtimePay — workday', () => {
  it('matches the PRD verified example: Rp4,000,000 monthly, 2h OT ≈ Rp80,924', () => {
    // PRD rounds the hourly wage to whole Rupiah (23,121) before applying multipliers.
    const hw = Math.round(hourlyWage({ wageBasic: 4_000_000, wageFixedAllowance: 0 }))
    expect(hw).toBe(23_121)
    const pay = overtimePay({ hours: 2, hourlyWage: hw, dayType: 'workday', workweek: 'six_day' })
    expect(Math.round(pay)).toBe(80_924)
  })
  it('first hour is 1.5×, subsequent hours 2×', () => {
    const pay = overtimePay({ hours: 3, hourlyWage: 100, dayType: 'workday', workweek: 'five_day' })
    // 1.5*100 + 2*100*2 = 150 + 400 = 550
    expect(pay).toBe(550)
  })
})

describe('overtimePay — weekly rest / holiday tiers', () => {
  it('6-day week: hrs1-7=2x, hr8=3x, hrs9-11=4x', () => {
    // 8 hours = 7*2 + 1*3 = 17 ×
    expect(overtimePay({ hours: 8, hourlyWage: 100, dayType: 'weekly_rest', workweek: 'six_day' })).toBe(1700)
    // 10 hours = 7*2 + 1*3 + 2*4 = 14+3+8 = 25 ×
    expect(overtimePay({ hours: 10, hourlyWage: 100, dayType: 'public_holiday', workweek: 'six_day' })).toBe(2500)
  })
  it('5-day week: hrs1-8=2x, hr9=3x, hrs10-11=4x', () => {
    // 9 hours = 8*2 + 1*3 = 19 ×
    expect(overtimePay({ hours: 9, hourlyWage: 100, dayType: 'weekly_rest', workweek: 'five_day' })).toBe(1900)
  })
  it('holiday on shortest workday: hrs1-5=2x, hr6=3x, hrs7-9=4x', () => {
    // 7 hours = 5*2 + 1*3 + 1*4 = 17 ×
    expect(overtimePay({ hours: 7, hourlyWage: 100, dayType: 'shortest_day', workweek: 'six_day' })).toBe(1700)
  })
})

describe('lateDeduction', () => {
  it('per_minute', () => {
    expect(lateDeduction(10, basePolicy)).toBe(5000)
    expect(lateDeduction(0, basePolicy)).toBe(0)
  })
  it('grace_flat only charges past the grace window', () => {
    const p: Policy = { ...basePolicy, lateDeductionMode: 'grace_flat', lateDeductionConfig: { graceMinutes: 10, flatAmount: 20000 } }
    expect(lateDeduction(5, p)).toBe(0)
    expect(lateDeduction(15, p)).toBe(20000)
  })
  it('tiered picks the matching band', () => {
    const p: Policy = { ...basePolicy, lateDeductionMode: 'tiered', lateDeductionConfig: { tiers: [{ uptoMinutes: 15, amount: 10000 }, { uptoMinutes: 30, amount: 25000 }] } }
    expect(lateDeduction(10, p)).toBe(10000)
    expect(lateDeduction(20, p)).toBe(25000)
    expect(lateDeduction(60, p)).toBe(25000) // beyond last tier keeps last amount
  })
})

describe('mealAllowance', () => {
  it('mandatory meal when an OT block is >= 4h (PRD §2.4.1)', () => {
    const total = mealAllowance({ presentDays: 20, overtimeBlocks: [{ hours: 5 }, { hours: 2 }], policy: basePolicy })
    expect(total).toBe(25000) // one qualifying block; perPresentDay is 0
  })
})

describe('computeRecapRow', () => {
  it('aggregates a full deterministic recap', () => {
    const row = computeRecapRow({
      employeeId: 'e1', name: 'Andi',
      wageBasic: 4_000_000, wageFixedAllowance: 0,
      workweek: 'six_day',
      presentDays: 22, lateMinutesTotal: 30, absentDays: 0, leaveDays: 1,
      overtimeBlocks: [{ workDate: '2026-06-02', hours: 2, dayType: 'workday' }],
      policy: basePolicy,
    })
    expect(Math.round(row.hourlyWage)).toBe(23_121)
    expect(row.overtimePayTotal).toBe(80_924)
    expect(row.lateDeduction).toBe(15_000) // 30 min * 500
    expect(row.overtimeHoursTotal).toBe(2)
  })
})
