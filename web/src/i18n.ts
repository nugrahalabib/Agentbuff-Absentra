/**
 * Centralised Bahasa Indonesia copy (PRD §8.10). Externalised so other locales
 * can be added later. Warm, clear, solution-focused; common IT terms kept in English.
 */
export const t = {
  appName: 'Absentra',
  tagline: 'Absensi enterprise-grade, gratis, untuk setiap UMKM Indonesia.',

  nav: {
    absen: 'Absen',
    jadwal: 'Jadwal',
    pengajuan: 'Pengajuan',
    dashboard: 'Dashboard',
    karyawan: 'Karyawan',
    persetujuan: 'Persetujuan',
    rekap: 'Rekap Payroll',
    agen: 'Koneksi Agen',
    profil: 'Profil',
    keluar: 'Keluar',
  },

  login: {
    title: 'Masuk ke Absentra',
    subtitle: 'Pilih akun demo untuk mencoba. Produksi memakai Login Google (OIDC).',
    withGoogle: 'Masuk dengan Google',
    demoNote: 'Mode demo — data tersimpan di perangkat ini saja.',
  },

  absen: {
    greeting: 'Halo',
    today: 'Hari ini',
    noShift: 'Tidak ada shift untuk kamu hari ini. Selamat beristirahat!',
    notYet: 'Belum Absen',
    clockedInAt: 'Sudah masuk pukul',
    done: 'Sudah selesai hari ini',
    clockIn: 'Absen Masuk',
    clockOut: 'Absen Keluar',
    locating: 'Mengambil lokasi…',
    capturing: 'Ambil foto',
    capture: 'Ambil Foto',
    retake: 'Ulangi',
    review: 'Periksa & kirim',
    confirm: 'Konfirmasi & Kirim',
    submitting: 'Mengirim…',
    success: 'Absen tersimpan',
    queued: 'Tersimpan, akan dikirim saat online',
    locationError: 'Kami tidak bisa membaca lokasimu. Pastikan izin lokasi aktif lalu coba lagi.',
    submitError: 'Absen ditolak. Coba lagi atau hubungi admin.',
    tryAgain: 'Coba lagi',
    livenessHint: 'Ikuti instruksi: hadap kamera dan',
    trustNote: 'Skor kepercayaan',
    flaggedNote: 'Absen ini ditandai untuk ditinjau admin (di luar area / sinyal lemah).',
    cameraDenied: 'Kamera tidak tersedia. Sesuai kebijakan, absen tetap dikirim & ditandai.',
  },

  status: {
    on_time: 'Tepat waktu',
    late: 'Terlambat',
    absent: 'Tidak hadir',
    cuti: 'Cuti',
    flagged: 'Ditandai',
    pending: 'Menunggu',
    approved: 'Disetujui',
    rejected: 'Ditolak',
  },

  dashboard: {
    title: 'Dashboard',
    present: 'Hadir',
    late: 'Terlambat',
    notYet: 'Belum absen',
    onLeave: 'Cuti',
    overtime: 'Lembur',
    liveFeed: 'Aktivitas terbaru',
    anomalies: 'Perlu ditinjau',
    noAnomalies: 'Tidak ada anomali. Semua absen tepercaya hari ini.',
    filterBranch: 'Semua cabang',
  },

  requests: {
    title: 'Pengajuan',
    newLeave: 'Ajukan Cuti',
    newOvertime: 'Ajukan Lembur',
    type: 'Jenis',
    dateStart: 'Tanggal mulai',
    dateEnd: 'Tanggal selesai',
    reason: 'Alasan',
    hours: 'Jam lembur',
    dayType: 'Jenis hari',
    submit: 'Kirim Pengajuan',
    empty: 'Belum ada pengajuan. Mulai dengan tombol di atas.',
  },

  approvals: {
    title: 'Persetujuan',
    approve: 'Setujui',
    reject: 'Tolak',
    empty: 'Tidak ada yang menunggu persetujuan. 🎉',
    reasonPlaceholder: 'Alasan (opsional)',
  },

  employees: {
    title: 'Karyawan',
    invite: 'Undang Karyawan',
    empty: 'Belum ada karyawan. Undang lewat link atau QR.',
    wageHidden: 'Upah disembunyikan',
    branch: 'Cabang',
    division: 'Divisi',
  },

  payroll: {
    title: 'Rekap Payroll',
    period: 'Periode',
    generate: 'Buat Rekap',
    export: 'Export',
    note: 'Rekap siap-payroll (PP 35/2021). Absentra tidak mentransfer gaji.',
    cols: {
      name: 'Karyawan',
      present: 'Hadir',
      late: 'Telat (mnt)',
      deduction: 'Potongan',
      meal: 'Uang makan',
      otHours: 'Jam lembur',
      otPay: 'Nilai lembur',
    },
  },

  mcp: {
    title: 'Koneksi Agen (MCP)',
    note: 'Agen AI dapat menjalankan Absentra atas namamu, dengan scope & cabang yang kamu izinkan.',
    scopes: 'Izin',
    branches: 'Cabang',
    revoke: 'Cabut',
    lastUsed: 'Terakhir dipakai',
    empty: 'Belum ada koneksi agen.',
  },

  common: {
    cancel: 'Batal',
    save: 'Simpan',
    close: 'Tutup',
    loading: 'Memuat…',
    offline: 'Kamu sedang offline. Aksi penting akan disinkronkan saat online.',
    all: 'Semua',
    switchTenant: 'Ganti Perusahaan',
  },
} as const
