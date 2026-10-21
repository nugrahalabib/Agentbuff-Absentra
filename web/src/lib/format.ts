/**
 * Format tanggal/jam/uang gaya Indonesia, mengikuti zona waktu perusahaan aktif.
 *
 * Tanggal kerja (YYYY-MM-DD) BUKAN titik waktu: diformat apa adanya (dibaca
 * sebagai UTC lalu ditampilkan dalam UTC), supaya tidak bergeser sehari di
 * peramban WITA/WIT. Titik waktu (ISO lengkap) diformat dalam zona perusahaan.
 */

let zonaAktif = 'Asia/Jakarta'

/** Dipanggil saat sesi termuat (useActor) supaya semua jam ikut zona perusahaan. */
export function setZonaWaktu(zona: string | null | undefined): void {
  if (!zona) return
  try {
    new Intl.DateTimeFormat('id-ID', { timeZone: zona })
    zonaAktif = zona
  } catch {
    /* zona tidak dikenal: tetap pakai yang lama */
  }
}

export function zonaWaktu(): string {
  return zonaAktif
}

const singgah = new Map<string, Intl.DateTimeFormat>()
function pemformat(opsi: Intl.DateTimeFormatOptions, lokal = 'id-ID'): Intl.DateTimeFormat {
  const kunci = lokal + JSON.stringify(opsi)
  let f = singgah.get(kunci)
  if (!f) {
    f = new Intl.DateTimeFormat(lokal, opsi)
    singgah.set(kunci, f)
  }
  return f
}

const TANGGAL_SAJA = /^\d{4}-\d{2}-\d{2}$/

/** Ubah 'YYYY-MM-DD' (atau 'YYYY-MM-DDT00:00:00' lama) jadi Date UTC tengah malam. */
function dariTanggal(nilai: string): { date: Date; zona: string } {
  const bersih = nilai.length >= 10 && TANGGAL_SAJA.test(nilai.slice(0, 10)) && (nilai.length === 10 || nilai.endsWith('T00:00:00'))
  if (bersih) return { date: new Date(nilai.slice(0, 10) + 'T00:00:00Z'), zona: 'UTC' }
  return { date: new Date(nilai), zona: zonaAktif }
}

const rupiah = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })
const angka = new Intl.NumberFormat('id-ID')

export function formatIDR(amount: number): string {
  return rupiah.format(amount)
}

export function formatNumber(n: number): string {
  return angka.format(n)
}

export function formatDate(nilai: string, _zona?: string): string {
  const { date, zona } = dariTanggal(nilai)
  return pemformat({ day: 'numeric', month: 'long', year: 'numeric', timeZone: zona }).format(date)
}

export function formatDateShort(nilai: string, _zona?: string): string {
  const { date, zona } = dariTanggal(nilai)
  return pemformat({ day: 'numeric', month: 'short', timeZone: zona }).format(date)
}

export function formatTime(iso: string, zona?: string): string {
  return pemformat({ hour: '2-digit', minute: '2-digit', hour12: false, timeZone: zona ?? zonaAktif }).format(new Date(iso))
}

export function formatDayName(nilai: string, _zona?: string): string {
  const { date, zona } = dariTanggal(nilai)
  return pemformat({ weekday: 'long', timeZone: zona }).format(date)
}

/** "Selasa, 21 Oktober" untuk hari ini (zona perusahaan). */
export function hariIniPanjang(): string {
  return pemformat({ weekday: 'long', day: 'numeric', month: 'long', timeZone: zonaAktif }).format(new Date())
}

/** Sapaan menurut jam di zona perusahaan. */
export function sapaanWaktu(): string {
  const jam = Number(pemformat({ hour: 'numeric', hour12: false, timeZone: zonaAktif }).format(new Date()))
  if (jam < 11) return 'Selamat pagi'
  if (jam < 15) return 'Selamat siang'
  if (jam < 18) return 'Selamat sore'
  return 'Selamat malam'
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

export function todayISODate(zona?: string): string {
  return pemformat({ year: 'numeric', month: '2-digit', day: '2-digit', timeZone: zona ?? zonaAktif }, 'en-CA').format(new Date())
}

/** Tambah/kurangi hari pada 'YYYY-MM-DD'. */
export function tambahHari(iso: string, d: number): string {
  const [y, m, day] = iso.split('-').map(Number)
  const x = new Date(Date.UTC(y, m - 1, day))
  x.setUTCDate(x.getUTCDate() + d)
  return x.toISOString().slice(0, 10)
}

export function awalBulan(iso: string): string {
  return iso.slice(0, 8) + '01'
}
