/** Ekspor ringan di sisi peramban. CSV terbuka di Excel/Sheets; PDF lewat dialog cetak
 * peramban terhadap `.print-area` (lihat index.css). Tanpa pustaka berat. */
export function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    let s = String(v ?? '')
    // Cegah rumus Excel/Sheets jalan sendiri dari isian teks (CSV injection).
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [header.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }) // BOM untuk Excel
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
