/**
 * Galat dari server → kalimat yang bisa dipahami pemilik usaha dan karyawan.
 * Satu tempat supaya semua layar bicara dengan kata yang sama. Kode yang belum
 * dikenal jatuh ke kalimat umum (tidak pernah menampilkan pesan teknis mentah).
 */
import { ApiError, OfflineError } from './api/client'

const PESAN: Record<string, string> = {
  unauthenticated: 'Sesi kamu sudah habis. Silakan masuk lagi.',
  forbidden: 'Akunmu tidak punya izin untuk ini.',
  not_found: 'Datanya tidak ditemukan. Mungkin sudah dihapus.',
  rate_limited: 'Terlalu sering mencoba. Tunggu sebentar lalu coba lagi.',
  internal: 'Ada gangguan di server. Coba lagi sebentar lagi.',
  validation: 'Ada isian yang belum benar. Periksa lagi ya.',
  invalid_input: 'Ada isian yang belum benar. Periksa lagi ya.',
  bad_request: 'Ada isian yang belum benar. Periksa lagi ya.',
  membership_inactive: 'Akunmu di perusahaan ini sudah tidak aktif. Hubungi pemilik usaha.',
  consent_required: 'Setujui dulu pemakaian lokasi supaya bisa absen.',
  already_clocked_in: 'Kamu sudah absen masuk untuk shift ini.',
  already_clocked_out: 'Kamu sudah absen keluar untuk shift ini.',
  no_open_clock_in: 'Belum ada absen masuk yang bisa ditutup.',
  no_shift: 'Tidak ada shift untukmu hari ini.',
  outside_geofence: 'Kamu berada di luar area kerja. Perusahaanmu menolak absen dari luar area.',
  strict_geofence: 'Kamu berada di luar area kerja. Perusahaanmu menolak absen dari luar area.',
  stale_offline_event: 'Absen offline ini sudah terlalu lama, jadi tidak bisa dikirim. Minta admin mencatat manual.',
  photo_too_large: 'Fotonya terlalu besar. Coba ulangi foto.',
  photo_invalid: 'Fotonya tidak bisa dibaca. Coba ulangi foto.',
  leave_overlap: 'Tanggal itu sudah ada pengajuan cutinya.',
  insufficient_balance: 'Sisa cuti tahunanmu tidak cukup untuk tanggal itu.',
  range_too_long: 'Rentang tanggalnya terlalu panjang. Maksimal satu tahun.',
  invalid_date: 'Tanggalnya belum benar.',
  already_member: 'Kamu sudah bergabung di perusahaan ini.',
  invite_invalid: 'Undangan ini tidak berlaku atau sudah kedaluwarsa.',
  invite_expired: 'Undangan ini sudah kedaluwarsa. Minta link baru ke admin.',
  invite_used_up: 'Undangan ini sudah terpakai semua. Minta link baru ke admin.',
  email_exists: 'Email itu sudah terdaftar di perusahaan ini.',
  duplicate_email: 'Email itu sudah terdaftar di perusahaan ini.',
  cannot_assign_role: 'Kamu tidak bisa memberi peran itu.',
  last_owner: 'Perusahaan harus punya minimal satu pemilik.',
  tiers_required: 'Isi dulu jenjang potongannya, atau pilih cara potongan lain.',
  invalid_timezone: 'Zona waktunya tidak dikenal.',
  perlu_agentbuff: 'Pemilik usaha masuk dengan akun AgentBuff.',
  confirm_name_mismatch: 'Nama usaha yang diketik tidak cocok.',
  overlap: 'Jadwal itu bertabrakan dengan shift lain.',
  min_rest: 'Jarak istirahat antar shift terlalu pendek.',
  password_auth_forbidden: 'Email ini harus masuk dengan Google.',
  invalid_credentials: 'Email atau kata sandi salah.',
  invalid_current: 'Kata sandi lama salah.',
  not_registered: 'Email belum terdaftar.',
  forbidden_origin: 'Permintaan ditolak demi keamanan. Muat ulang halaman lalu coba lagi.',
  password_required: 'Kata sandi belum diisi atau terlalu pendek.',
  role_requires_owner: 'Hanya pemilik usaha yang bisa mengatur peran.',
  out_of_scope: 'Itu di luar lokasi kerja yang kamu pegang.',
  forbidden_target_role: 'Kamu hanya bisa mengatur karyawan biasa.',
  cannot_modify_owner: 'Akun pemilik tidak bisa diubah dari sini.',
  invalid_branch: 'Lokasi kerjanya tidak ditemukan.',
  invalid_division: 'Divisinya tidak ditemukan.',
  cannot_decide_own_request: 'Pengajuanmu sendiri harus diputuskan atasanmu.',
  cannot_correct_own_record: 'Absenmu sendiri harus dikoreksi atasanmu.',
  overtime_duplicate_date: 'Lembur di tanggal itu sudah disetujui.',
  employee_inactive: 'Karyawan ini sudah tidak aktif.',
  invalid_clock_out: 'Jam keluar tidak boleh sebelum jam masuk.',
  payload_too_large: 'Datanya terlalu besar. Coba perkecil gambarnya.',
  invalid_range: 'Rentang tanggalnya belum benar.',
  rejected_strict_geofence: 'Absen ditolak karena kamu di luar lokasi kerja. Dekati lokasi kerja lalu coba lagi.',
  gate_misconfigured: 'Masuk pemilik sedang bermasalah. Hubungi tim AgentBuff.',
  no_employee_profile: 'Akunmu belum terdaftar sebagai karyawan di usaha ini.',
}

export function kodeGalat(e: unknown): string | null {
  if (e instanceof ApiError) return typeof e.body?.error === 'string' ? e.body.error : null
  return null
}

export function pesanGalat(e: unknown, cadangan = 'Belum berhasil. Coba lagi ya.'): string {
  if (e instanceof OfflineError) return 'Kamu sedang offline. Coba lagi saat sinyal kembali.'
  if (e instanceof TypeError) return 'Tidak tersambung ke internet. Periksa sinyal lalu coba lagi.'
  if (e instanceof ApiError) {
    const kode = kodeGalat(e)
    if (kode && PESAN[kode]) return PESAN[kode]
    if (e.status === 401) return PESAN.unauthenticated
    if (e.status === 403) return PESAN.forbidden
    if (e.status === 404) return PESAN.not_found
    if (e.status === 429) return PESAN.rate_limited
    if (e.status >= 500) return PESAN.internal
  }
  return cadangan
}
