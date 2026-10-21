/**
 * Input validation shared by REST routes and the MCP adapter: calendar dates +
 * range caps (DoS guard), image data URLs (size + magic bytes), tenant
 * timezones, and CSV cell escaping (formula-injection guard).
 */
import { z } from 'zod'

// ---------------------------------------------------------------- dates

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export const MAX_RANGE_DAYS = 366

/** True for a real calendar date in strict YYYY-MM-DD form. */
export function isValidIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/** Zod schema for a strict YYYY-MM-DD date (REST bodies/queries). */
export const isoDate = z.string().refine(isValidIsoDate, { message: 'invalid_date' })

/** Inclusive day count between two valid ISO dates. */
export function daySpan(from: string, to: string): number {
  const [sy, sm, sd] = from.split('-').map(Number)
  const [ey, em, ed] = to.split('-').map(Number)
  return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 864e5) + 1
}

export type RangeProblem = 'invalid_date' | 'invalid_range' | 'range_too_long'

/** null when OK; otherwise a machine-readable error code. */
export function rangeProblem(from: unknown, to: unknown, maxDays = MAX_RANGE_DAYS): RangeProblem | null {
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) return 'invalid_date'
  if (to < from) return 'invalid_range'
  if (daySpan(from, to) > maxDays) return 'range_too_long'
  return null
}

export const RANGE_MESSAGE: Record<RangeProblem, string> = {
  invalid_date: 'Format tanggal harus YYYY-MM-DD.',
  invalid_range: 'Tanggal akhir tidak boleh sebelum tanggal mulai.',
  range_too_long: `Rentang tanggal maksimal ${MAX_RANGE_DAYS} hari.`,
}

/** Express helper: writes a 400 and returns true when the range is bad. */
export function rejectBadRange(res: { status: (n: number) => { json: (b: unknown) => unknown } }, from: unknown, to: unknown, maxDays = MAX_RANGE_DAYS): boolean {
  const p = rangeProblem(from, to, maxDays)
  if (!p) return false
  res.status(400).json({ error: p, message: RANGE_MESSAGE[p] })
  return true
}

// ---------------------------------------------------------------- images

export const ATTENDANCE_PHOTO_MAX_BYTES = 400 * 1024
export const PROFILE_PHOTO_MAX_BYTES = 300 * 1024
export const LOGO_MAX_BYTES = 300 * 1024

const IMG_RE = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/

export type ImageCheck = { ok: true } | { ok: false; error: 'photo_invalid' | 'photo_too_large' }

/**
 * Accept only JPEG/PNG/WebP data URLs whose decoded size is within `maxBytes`
 * and whose first bytes really are that format (no SVG, no HTML polyglots).
 */
export function checkImageDataUrl(s: unknown, maxBytes: number): ImageCheck {
  if (typeof s !== 'string') return { ok: false, error: 'photo_invalid' }
  // Cheap size gate before touching the payload (base64 = 4 chars per 3 bytes).
  if (s.length > Math.ceil(maxBytes / 3) * 4 + 64) return { ok: false, error: 'photo_too_large' }
  const m = IMG_RE.exec(s)
  if (!m) return { ok: false, error: 'photo_invalid' }
  const b64 = m[2]
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  const bytes = (b64.length * 3) / 4 - padding
  if (bytes > maxBytes) return { ok: false, error: 'photo_too_large' }
  const head = Buffer.from(b64.slice(0, 24), 'base64')
  const type = m[1]
  const isJpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff
  const isPng = head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  const isWebp = head.length >= 12 && head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP'
  const matches = (type === 'jpeg' && isJpeg) || (type === 'png' && isPng) || (type === 'webp' && isWebp)
  return matches ? { ok: true } : { ok: false, error: 'photo_invalid' }
}

export const PHOTO_MESSAGE = {
  photo_invalid: 'Foto harus berupa gambar JPEG, PNG, atau WebP yang valid.',
  photo_too_large: 'Ukuran foto terlalu besar. Coba ambil ulang dengan resolusi lebih kecil.',
} as const

// ---------------------------------------------------------------- timezones

/** Indonesian tenant timezones (WIB / WITA / WIT). */
export const ALLOWED_TIMEZONES = ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura'] as const

export function isAllowedTimezone(tz: unknown): tz is string {
  return typeof tz === 'string' && (ALLOWED_TIMEZONES as readonly string[]).includes(tz)
}

/** A timezone Intl can use; anything unusable falls back to Asia/Jakarta (never throws). */
export function safeTimezone(tz: unknown): string {
  if (typeof tz !== 'string' || !tz) return 'Asia/Jakarta'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date(0))
    return tz
  } catch {
    return 'Asia/Jakarta'
  }
}

// ---------------------------------------------------------------- CSV

/**
 * Escape one CSV cell. Strings that a spreadsheet would treat as a formula
 * (leading = + - @ TAB CR) are neutralised with a leading apostrophe (OWASP
 * CSV-injection guidance). Numbers are emitted as-is.
 */
export function csvCell(v: unknown): string {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  let s = String(v ?? '')
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n')
}
