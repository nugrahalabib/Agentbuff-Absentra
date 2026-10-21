# Gaya tampilan Absentra: "Inti Hidup" (rombak 21 Oktober 2026)

Tampilan Absentra diselaraskan dengan AgentBuff (agentbuff.id). Aturan induk ada di
`Docs/Produk/rombak-ui/PANDUAN-DESAIN.md` repo AgentBuff; dokumen ini terjemahannya untuk
Absentra (Vite + React 18 + Tailwind **v3**). `docs/design-system.md` lama sudah tidak berlaku
untuk warna, huruf, dan bentuk.

## 1. Rasa

Terang dulu, premium, tenang, aksen kaca gaya Apple. Bukan dasbor developer, bukan warna-warni.
Latar ivory bercahaya diam, teks dan tombol utama graphite, teal hanya untuk yang sedang hidup.
Mode gelap ikut perangkat (bisa dipilih di Akun saya).

## 2. Warna (pakai NAMA TOKEN, jangan hex di komponen)

Nilai di `web/src/index.css` (kanal RGB), peta di `web/tailwind.config.ts`.

| Token | Pakai untuk |
|---|---|
| `kanvas`, `kanvas-2` | latar halaman, lekuk |
| `permukaan` | permukaan terangkat (tab aktif, kartu padat) |
| `sumur` | latar segmen, kotak ikon, baris tenang (tembus) |
| `tinta`, `tinta-2`, `tinta-3` | teks utama / kedua / keterangan |
| `grafit`, `grafit-teks` | tombol utama, pilihan terpilih |
| `inti`, `inti-teks`, `inti-lembut` | yang sedang hidup: sudah hadir, tersambung, diperbarui otomatis |
| `perlu`, `perlu-lembut` | butuh keputusanmu: perlu dicek, menunggu, terlambat |
| `galat`, `galat-lembut` | gagal, tindakan merusak |
| `garis` | garis halus |
| `aksen` (+`-isi`, `-teks`, `-lembut`) | **aksen khas Absentra**: cyan "lencana hadir" dari logo |

Aturan arti:
- Aksen cyan dipakai SEDIKIT: tombol Absen masuk/keluar, kirim absen, momen absen tercatat,
  lokasi kerja, dan sentuhan merek di halaman depan. Tombol umum tetap graphite.
- Amber = butuh kamu, merah = gagal, teal = hidup. Status selalu kata + ikon, bukan warna saja.
- Nama lama (`primary`, `surface`, `text`, `border`, ...) masih dipetakan ke token baru, tapi
  kode baru pakai nama Inti Hidup. Jangan pakai warna bawaan Tailwind (`slate-*`, `teal-*`, ...).

## 3. Kaca dan cahaya

- `body` = latar bercahaya diam (`--latar-kaca`, HP `--latar-kaca-hp`). Kaca butuh cahaya.
- Kelas di `index.css`: `kaca-panel` (kartu/panel), `kaca-pil` (kapsul kecil), `kaca-ubin`
  (pilihan, terpilih = `aria-pressed`/`data-aktif`), `kaca-chip` (pil pilihan, terpilih graphite),
  `kaca-jendela` (popup), `kaca-bilah` (bilah atas menempel), `kaca-kaki` (bilah tab HP),
  `panel-samping` (menu samping), `tombol-grafit`, `tombol-kaca`, `tombol-aksen`, `cahaya-aksen`.
- **Buram (`backdrop-filter`) hanya untuk yang melayang di atas isi bergerak** dan hanya di
  layar >=1024px. Jangan menambah `backdrop-blur-*` baru. Cahaya hiasan pakai gradien
  (`cahaya-aksen`), BUKAN `filter: blur()` (berat di Safari dan HP murah).

## 4. Huruf

Geist (`@fontsource-variable/geist`, disimpan sendiri). Judul halaman 28-34 bold
`tracking-[-0.03em]`, judul bagian 18-22 semibold, isi 15-16, keterangan 13-14, minimal 13px
(lencana boleh 12). Tanpa label KAPITAL berjarak lebar. Tanpa tanda pisah panjang di teks.

## 5. Bentuk

- Tombol = kapsul (`rounded-full`) lewat `<Button>`: `primary` graphite, `aksen` cyan (absen saja),
  `secondary` kaca, `ghost`, `danger`.
- Kartu `rounded-[24px]`, panel besar `rounded-[28px]`, kolom isian `rounded-2xl` tinggi 48px.
- Popup selalu `<BottomSheet>`: lembar bawah di HP, jendela tengah di laptop (portal ke body).
- Target sentuh minimal 44px. Ikon garis tipis (`components/ui/icons.tsx`, stroke 1.8).

## 6. Logo dan maskot

- Logo = lencana ID ivory-graphite dengan centang cyan: selalu lewat `<LogoAbsentra>`
  (`public/merek/absentra-*.webp`). Ikon situs: `favicon.ico`, `icon-192/512.png`,
  `apple-touch-icon.png`, `og-absentra.png`.
- Maskot = robot Absentra berlanyard (keluarga Buff AgentBuff), `<Maskot pose=...>` dari
  `public/maskot/<pose>.webp` (480px) dan `-kecil.webp` (240px, otomatis untuk tampilan <=170px).
  Pose: `selfie` (absen, menyambut, berhasil), `peta` (lokasi, mencari GPS), `analisis` (beranda
  pemilik, laporan, rekap, agen AI), `jadwal` (jadwal, shift), `cuti` (cuti, libur, kosong yang
  ceria), `pulang` (absen keluar, absen lengkap, riwayat).
- Maskot punya FUNGSI: berbicara lewat `<Gelembung>` (kalimat keadaan), menyambut, menemani
  keadaan kosong. Berdiri bebas tanpa bingkai, satu per layar, tidak menutupi tombol.

## 7. Gerak dan ringan

Hanya `transform`/`opacity`, singkat, berhingga (`cincin-denyut` 3 kali, `anim-ayun` 3 kali).
Halaman dimuat per rute (`React.lazy`). Gambar diberi ukuran + `loading="lazy"` di bawah lipatan.
Tidak ada pustaka animasi. `prefers-reduced-motion` dan `prefers-reduced-transparency` dihormati.

## 8. Bahasa

Bahasa ngobrol pemilik usaha dan karyawan. Sedikit kata, tanpa istilah teknis di layar utama
("geofence" jadi "lokasi kerja", "trust score" jadi "perlu dicek", "payroll" jadi "rekap gaji",
"MCP" hanya di bagian untuk pengguna teknis). Galat dari server selalu lewat `lib/galat.ts`.

## 9. Periksa sebelum selesai

`cd web && npm run typecheck && npm test` · `cd server && npx tsc --noEmit && npm test` ·
potret laptop 1366x768 + HP 390x844, terang dan gelap, dilihat dengan mata · tanpa luber ke samping.
