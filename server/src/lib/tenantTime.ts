/**
 * Tenant-timezone time helpers (PRD §8 — dates in the tenant's timezone).
 * Indonesian zones are fixed-offset, but the helpers derive offsets through Intl
 * so they stay correct for any IANA zone.
 */
import { db } from './db.js'
import { safeTimezone } from './validate.js'

export function companyTz(companyId: string): string {
  const c = db.prepare('SELECT timezone FROM company WHERE id = ?').get(companyId) as { timezone?: string } | undefined
  return safeTimezone(c?.timezone)
}

function partsInTz(at: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute'), s: get('second') }
}

/** YYYY-MM-DD of `at` in the tenant timezone. */
export function dateInTz(at: Date, tz: string): string {
  const p = partsInTz(at, tz)
  return `${String(p.y).padStart(4, '0')}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`
}

/** Minutes since local midnight of `at` in the tenant timezone. */
export function minutesInTz(at: Date, tz: string): number {
  const p = partsInTz(at, tz)
  return p.h * 60 + p.mi
}

/** Offset (minutes east of UTC) of `tz` at instant `at`. */
export function tzOffsetMinutes(at: Date, tz: string): number {
  const p = partsInTz(at, tz)
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s)
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000)
}

/** The UTC instant of local wall-clock `dateISO hh:mm` in `tz`. */
export function zonedTimeToUtc(dateISO: string, hhmm: string, tz: string): Date {
  const [y, m, d] = dateISO.split('-').map(Number)
  const [h, mi] = hhmm.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, h, mi)
  const off = tzOffsetMinutes(new Date(guess), tz)
  return new Date(guess - off * 60000)
}

export function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const x = new Date(Date.UTC(y, m - 1, d))
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}

export function daysBetween(startISO: string, endISO: string): string[] {
  const out: string[] = []
  const [sy, sm, sd] = startISO.split('-').map(Number)
  const [ey, em, ed] = endISO.split('-').map(Number)
  const d = new Date(Date.UTC(sy, sm - 1, sd))
  const end = new Date(Date.UTC(ey, em - 1, ed))
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

export const dayOfWeek = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

export const timeToMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export interface ShiftTemplateRow {
  id: string
  start_time: string
  end_time: string
  crosses_midnight: number
  late_tolerance_minutes: number
}

/** True when the template ends on the following calendar day. */
export function crossesMidnight(t: ShiftTemplateRow): boolean {
  return !!t.crosses_midnight || timeToMin(t.end_time) <= timeToMin(t.start_time)
}

/** Absolute start/end of the shift that begins on `workDate`. */
export function shiftWindow(workDate: string, t: ShiftTemplateRow, tz: string): { start: Date; end: Date } {
  const start = zonedTimeToUtc(workDate, t.start_time, tz)
  const end = zonedTimeToUtc(crossesMidnight(t) ? addDaysIso(workDate, 1) : workDate, t.end_time, tz)
  return { start, end }
}

/**
 * The concrete shift occurrence a moment belongs to. For an overnight template
 * the occurrence that started the previous day is also considered; whichever
 * window is closest to `anchor` wins (0 distance when inside it).
 */
export function nearestShiftWindow(workDate: string, t: ShiftTemplateRow, tz: string, anchor: Date): { start: Date; end: Date } {
  const own = shiftWindow(workDate, t, tz)
  if (!crossesMidnight(t)) return own
  const prev = shiftWindow(addDaysIso(workDate, -1), t, tz)
  const dist = (w: { start: Date; end: Date }) => {
    const a = anchor.getTime()
    if (a < w.start.getTime()) return w.start.getTime() - a
    if (a > w.end.getTime()) return a - w.end.getTime()
    return 0
  }
  return dist(prev) < dist(own) ? prev : own
}
