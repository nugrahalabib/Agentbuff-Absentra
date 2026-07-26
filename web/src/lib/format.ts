/** Indonesian locale + tenant-timezone formatting (PRD §8.10). */

export function formatIDR(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount)
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('id-ID').format(n)
}

export function formatDate(iso: string, timezone = 'Asia/Jakarta'): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: timezone,
  }).format(new Date(iso))
}

export function formatDateShort(iso: string, timezone = 'Asia/Jakarta'): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    timeZone: timezone,
  }).format(new Date(iso))
}

export function formatTime(iso: string, timezone = 'Asia/Jakarta'): string {
  return new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  }).format(new Date(iso))
}

export function formatDayName(iso: string, timezone = 'Asia/Jakarta'): string {
  return new Intl.DateTimeFormat('id-ID', { weekday: 'long', timeZone: timezone }).format(new Date(iso))
}

/** 'HH:mm' string → minutes of day. */
export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export function minutesToTime(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function todayISODate(timezone = 'Asia/Jakarta'): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: timezone,
  })
  return fmt.format(new Date()) // en-CA → YYYY-MM-DD
}
