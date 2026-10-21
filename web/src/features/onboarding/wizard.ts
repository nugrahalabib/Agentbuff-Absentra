/**
 * Penanda "wizard penyiapan pemilik sedang berjalan". Perusahaan dibuat di langkah
 * pertama, jadi tanpa penanda ini gerbang onboarding langsung mengusir pemilik ke
 * aplikasi dan langkah lokasi, divisi, dan shift tidak pernah terlihat.
 */
const KUNCI = 'absentra_wizard'

export function wizardAktif(): boolean {
  try {
    return sessionStorage.getItem(KUNCI) === '1'
  } catch {
    return false
  }
}

export function mulaiWizard(): void {
  try {
    sessionStorage.setItem(KUNCI, '1')
  } catch {
    /* abaikan */
  }
}

export function selesaiWizard(): void {
  try {
    sessionStorage.removeItem(KUNCI)
  } catch {
    /* abaikan */
  }
}
