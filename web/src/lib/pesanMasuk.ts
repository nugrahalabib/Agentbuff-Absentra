/**
 * Kalimat untuk kode galat masuk dari server (`/login?error=<kode>`). Satu tempat
 * supaya halaman Masuk dan penyiapan usaha bicara dengan kata yang sama.
 */
export function pesanMasuk(kode: string): string {
  switch (kode) {
    case 'pakai_agentbuff':
    case 'perlu_agentbuff':
      return 'Pemilik usaha masuk lewat tombol "Masuk dengan AgentBuff". Karyawan tetap masuk dengan Google, pakai email yang didaftarkan atasannya.'
    case 'belum_beli':
    case 'not_purchased':
      return 'Akun AgentBuff ini belum punya Absentra. Ambil dulu di Marketplace AgentBuff (gratis), lalu masuk lagi.'
    case 'akses_berakhir':
    case 'access_lapsed':
      return 'Masa aktif AgentBuff-mu sudah habis. Perpanjang di agentbuff.id, data absensimu tetap aman tersimpan.'
    case 'belum_aktif':
      return 'Akun AgentBuff-mu belum aktif. Mulai masa coba atau berlangganan di agentbuff.id dulu ya.'
    case 'not_registered':
      return 'Email ini belum terdaftar. Kalau kamu karyawan, minta atasanmu menambahkan emailmu atau kirim link undangan.'
    case 'diblokir':
      return 'Akun AgentBuff ini sedang diblokir.'
    case 'akun_lain':
      return 'Email ini sudah tersambung ke akun AgentBuff lain.'
    case 'dibatalkan':
    case 'access_denied':
      return 'Masuknya dibatalkan. Coba lagi kalau mau.'
    case 'gate_unreachable':
      return 'Akses belum bisa dicek ke AgentBuff. Coba lagi sebentar lagi.'
    case 'state':
    case 'token':
    case 'oauth':
    case 'userinfo':
      return 'Masuk dengan Google belum berhasil. Coba ulangi dari awal.'
    case 'noemail':
      return 'Akun Google ini tidak membagikan email, jadi tidak bisa dipakai.'
    case 'email_tidak_terverifikasi':
      return 'Email Google ini belum terverifikasi. Pakai akun Google lain.'
    case 'gate_misconfigured':
      return 'Masuk pemilik sedang bermasalah. Hubungi tim AgentBuff.'
    case 'google':
      return 'Masuk dengan Google belum disiapkan di server ini.'
    default:
      return 'Masuk belum berhasil. Coba lagi ya.'
  }
}

export const URL_MASUK_AGENTBUFF = '/api/auth/agentbuff/start'
