/**
 * Tema tampilan per perangkat: terang, gelap, atau ikut HP/laptop.
 * Pilihan disimpan di localStorage; atribut `data-theme` di <html> yang dibaca CSS.
 * Skrip `public/tema-awal.js` memasang atribut yang sama sebelum halaman tergambar
 * (tanpa kedip putih untuk pengguna mode gelap).
 */
export type PilihanTema = 'terang' | 'gelap' | 'sistem'

const KUNCI = 'absentra_tema'

export function bacaPilihanTema(): PilihanTema {
  try {
    const v = localStorage.getItem(KUNCI)
    if (v === 'terang' || v === 'gelap' || v === 'sistem') return v
    // Simpanan lama (absentra_ui_v1) memakai light/dark.
    const lama = localStorage.getItem('absentra_ui_v1')
    const t = lama ? JSON.parse(lama)?.state?.theme : null
    if (t === 'dark') return 'gelap'
    if (t === 'light') return 'terang'
  } catch {
    /* penyimpanan diblokir: pakai bawaan */
  }
  return 'sistem'
}

function sistemGelap(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

export function temaEfektif(p: PilihanTema): 'light' | 'dark' {
  if (p === 'gelap') return 'dark'
  if (p === 'terang') return 'light'
  return sistemGelap() ? 'dark' : 'light'
}

export function terapkanTema(p: PilihanTema): void {
  const efektif = temaEfektif(p)
  document.documentElement.setAttribute('data-theme', efektif)
  const meta = document.querySelector('meta[name="theme-color"]')
  meta?.setAttribute('content', efektif === 'dark' ? '#0e1014' : '#f4f1ec')
}

export function simpanPilihanTema(p: PilihanTema): void {
  try {
    localStorage.setItem(KUNCI, p)
  } catch {
    /* abaikan */
  }
  terapkanTema(p)
  window.dispatchEvent(new CustomEvent('absentra:tema', { detail: p }))
}

/** Ikuti perubahan mode HP saat pilihan = sistem. Dipanggil sekali di main.tsx. */
export function pantauTemaSistem(): void {
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (bacaPilihanTema() === 'sistem') terapkanTema('sistem')
    })
  } catch {
    /* peramban lama */
  }
}
