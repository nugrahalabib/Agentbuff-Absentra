/**
 * Pesan untuk kode galat masuk yang dikembalikan server (`/login?error=<kode>`).
 * Satu tempat supaya layar landing dan onboarding berbicara dengan kalimat yang
 * sama.
 */
export function pesanMasuk(kode: string): string {
  switch (kode) {
    case 'pakai_agentbuff':
    case 'perlu_agentbuff':
      return 'Pemilik perusahaan masuk dengan tombol "Masuk dengan AgentBuff". Karyawan tetap masuk dengan Google sesuai email undangan.'
    case 'belum_beli':
    case 'not_purchased':
      return 'Akun AgentBuff ini belum memiliki Absentra. Ambil dulu di Marketplace AgentBuff, lalu masuk lagi.'
    case 'akses_berakhir':
    case 'access_lapsed':
      return 'Langganan / trial AgentBuff kamu sudah berakhir. Perpanjang di agentbuff.id — data perusahaanmu tetap tersimpan.'
    case 'belum_aktif':
      return 'Akun AgentBuff kamu belum aktif. Mulai trial atau berlangganan di agentbuff.id dulu.'
    case 'not_registered':
      return 'Email ini belum terdaftar di AgentBuff. Daftar dulu di agentbuff.id lalu ambil Absentra di Marketplace.'
    case 'diblokir':
      return 'Akun AgentBuff ini sedang diblokir.'
    case 'akun_lain':
      return 'Email ini sudah tersambung ke akun AgentBuff lain.'
    case 'dibatalkan':
    case 'access_denied':
      return 'Masuk dibatalkan.'
    case 'gate_unreachable':
      return 'Akses belum bisa diperiksa ke AgentBuff saat ini. Coba lagi sebentar.'
    default:
      return `Masuk gagal (${kode}). Coba lagi.`
  }
}

export const URL_MASUK_AGENTBUFF = '/api/auth/agentbuff/start'
