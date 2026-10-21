/** Perkecil gambar di peramban sebelum diunggah (logo/foto profil). */
export function kecilkanGambar(f: File, maks: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(f)
    const img = new Image()
    img.onload = () => {
      const skala = Math.min(1, maks / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(img.width * skala))
      c.height = Math.max(1, Math.round(img.height * skala))
      c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL(f.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.85))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('gambar')) }
    img.src = url
  })
}
