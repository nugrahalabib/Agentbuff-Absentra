import { toast } from '@/components/Toast'

/**
 * Salin teks ke papan klip. Clipboard API butuh halaman aman + izin; peramban lama atau
 * WebView di HP kadang menolaknya, jadi ada cadangan lewat textarea tersembunyi.
 * Mengembalikan true hanya bila benar-benar tersalin.
 */
export async function salinTeks(teks: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(teks)
      return true
    }
  } catch {
    /* coba cara cadangan */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = teks
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}

/** Salin lalu beri tahu hasilnya. Kalau gagal, arahkan untuk menyalin manual. */
export async function salin(teks: string, pesanBerhasil: string): Promise<void> {
  if (await salinTeks(teks)) toast.berhasil(pesanBerhasil)
  else toast.galat('Belum bisa menyalin otomatis. Tekan lama teksnya lalu salin.')
}
