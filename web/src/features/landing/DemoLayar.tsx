/**
 * Cuplikan layar ASLI Absentra untuk halaman depan: dirakit dari komponen yang sama
 * dengan aplikasinya (kaca, tombol, lencana, maskot), diisi data contoh.
 * Layar HP berganti sendiri hanya saat terlihat, beberapa putaran lalu berhenti.
 */
import { useEffect, useRef, useState } from 'react'
import { cx } from '@/components/ui'
import { AttendanceBadge } from '@/components/StatusBadge'
import { Gelembung, Maskot } from '@/components/merek'
import { IconCamera, IconCheckCircle, IconClock, IconMapPin } from '@/components/ui/icons'

function useTerlihat<T extends Element>(ambang = 0.35) {
  const ref = useRef<T | null>(null)
  const [terlihat, setTerlihat] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { setTerlihat(true); return }
    const io = new IntersectionObserver(([e]) => setTerlihat(e.isIntersecting), { threshold: ambang })
    io.observe(el)
    return () => io.disconnect()
  }, [ambang])
  return { ref, terlihat }
}

const LANGKAH_HP = ['siap', 'lokasi', 'foto', 'tercatat'] as const

export function DemoHp() {
  const { ref, terlihat } = useTerlihat<HTMLDivElement>()
  const [i, setI] = useState(0)
  const [putaran, setPutaran] = useState(0)
  useEffect(() => {
    if (!terlihat || putaran >= 4) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setI(3); return }
    const t = window.setTimeout(() => {
      setI((x) => {
        const n = (x + 1) % LANGKAH_HP.length
        if (n === 0) setPutaran((p) => p + 1)
        return n
      })
    }, i === 3 ? 3200 : 2300)
    return () => window.clearTimeout(t)
  }, [terlihat, i, putaran])
  const tahap = LANGKAH_HP[putaran >= 4 ? 3 : i]

  return (
    <div ref={ref} className="lp-hp w-[272px] shrink-0 sm:w-[300px]" aria-label="Contoh layar absen Absentra di HP" role="img">
      <div className="lp-hp-layar relative flex h-[560px] flex-col px-4 pb-4 pt-9 sm:h-[600px]">
        <div className="absolute left-1/2 top-2.5 h-5 w-24 -translate-x-1/2 rounded-full bg-[#0c0c0e]" />
        <p className="text-[11px] font-medium text-tinta-3">Selasa, 21 Oktober</p>
        <p className="mt-0.5 text-[24px] font-bold leading-[1.05] tracking-[-0.035em] text-tinta">Selamat pagi, Rina.</p>
        <Gelembung className="mt-3 !rounded-[18px] !px-3.5 !py-2.5 text-[13px]">
          {tahap === 'siap' && 'Shift Pagi mulai 08.00 di Toko Pusat. Yuk absen masuk.'}
          {tahap === 'lokasi' && 'Sebentar, aku cek dulu kamu sudah di lokasi kerja atau belum.'}
          {tahap === 'foto' && 'Sekarang foto wajahmu, biar atasanmu tahu ini memang kamu.'}
          {tahap === 'tercatat' && 'Absen masuk tercatat. Semangat kerjanya!'}
        </Gelembung>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className="kaca-pil inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-tinta"><IconClock width={12} height={12} /> Shift Pagi · 08.00</span>
          <span className="kaca-pil inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-tinta"><IconMapPin width={12} height={12} /> Toko Pusat</span>
        </div>

        <div key={tahap} className="lp-ganti kaca-panel mt-3 flex flex-1 flex-col rounded-[24px] p-4">
          {tahap !== 'siap' && tahap !== 'tercatat' && (
            <div className="mb-3 flex items-center gap-1.5">
              {['Lokasi', 'Foto', 'Kirim'].map((l, k) => {
                const aktif = (tahap === 'lokasi' && k === 0) || (tahap === 'foto' && k === 1)
                const lewat = tahap === 'foto' && k === 0
                return (
                  <span key={l} className="flex flex-1 items-center gap-1">
                    <span className={cx('flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold', lewat ? 'bg-grafit text-grafit-teks' : aktif ? 'bg-aksen-lembut text-aksen-teks ring-2 ring-aksen' : 'bg-sumur text-tinta-3')}>{lewat ? '✓' : k + 1}</span>
                    <span className={cx('text-[10px]', aktif ? 'font-semibold text-tinta' : 'text-tinta-3')}>{l}</span>
                  </span>
                )
              })}
            </div>
          )}
          {tahap === 'siap' && (
            <div className="flex flex-1 flex-col justify-center">
              <div className="relative">
                <span className="cincin-denyut absolute inset-0 rounded-full bg-aksen/35" />
                <span className="tombol-aksen relative flex min-h-[54px] items-center justify-center gap-2 rounded-full text-[16px] font-bold"><IconClock width={20} height={20} /> Absen masuk</span>
              </div>
              <p className="mt-2.5 text-center text-[11px] text-tinta-3">Lokasi dicek dulu, lalu foto wajah.</p>
            </div>
          )}
          {tahap === 'lokasi' && (
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <span className="relative flex h-14 w-14 items-center justify-center">
                <span className="cincin-denyut absolute inset-0 rounded-full bg-aksen/30" />
                <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-aksen-lembut text-aksen-teks"><IconMapPin width={22} height={22} /></span>
              </span>
              <p className="mt-3 text-[14px] font-semibold text-tinta">Di lokasi kerja</p>
              <p className="text-[11px] text-tinta-3">12 m dari titik · akurasi 9 m</p>
            </div>
          )}
          {tahap === 'foto' && (
            <div className="flex flex-1 flex-col">
              <div className="relative flex flex-1 items-end justify-center overflow-hidden rounded-[18px] bg-[#1d1f24]">
                <Maskot pose="selfie" ukuran="kecil" className="translate-y-3" />
                <span className="pointer-events-none absolute inset-x-[18%] inset-y-[10%] rounded-[50%] ring-2 ring-[rgba(255,255,255,0.7)]" />
              </div>
              <span className="tombol-aksen mt-3 flex min-h-[44px] items-center justify-center gap-2 rounded-full text-[14px] font-bold"><IconCamera width={18} height={18} /> Ambil foto</span>
            </div>
          )}
          {tahap === 'tercatat' && (
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-aksen-isi text-aksen-isi-teks"><IconCheckCircle width={28} height={28} /></span>
              <p className="mt-3 text-[17px] font-bold tracking-[-0.02em] text-tinta">Absen masuk tercatat</p>
              <p className="text-[12px] text-tinta-2">Jam 07.58 · tepat waktu</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const ARUS = [
  { nama: 'Rina Wulandari', inisial: 'RW', masuk: '07.58', keluar: null, status: 'on_time' as const },
  { nama: 'Dimas Pratama', inisial: 'DP', masuk: '08.17', keluar: null, status: 'late' as const },
  { nama: 'Ayu Lestari', inisial: 'AL', masuk: '07.49', keluar: null, status: 'on_time' as const },
  { nama: 'Bagus Santoso', inisial: 'BS', masuk: '07.55', keluar: null, status: 'on_time' as const },
]

export function DemoDasbor() {
  return (
    <div className="lp-laptop w-full" role="img" aria-label="Contoh beranda pemilik usaha di Absentra">
      <div className="lp-laptop-layar flex gap-3 p-3 sm:p-4">
        <div className="panel-samping hidden w-[150px] shrink-0 flex-col gap-1 rounded-[20px] p-2.5 md:flex">
          <div className="mb-2 flex items-center gap-2 px-1.5 pt-1"><img src="/merek/absentra-96.webp" width={20} height={20} alt="" /><span className="text-[13px] font-bold tracking-[-0.02em] text-tinta">Absentra</span></div>
          {['Beranda', 'Persetujuan', 'Karyawan', 'Shift & jadwal', 'Laporan absensi', 'Rekap gaji'].map((m, k) => (
            <span key={m} className={cx('rounded-[10px] px-2.5 py-1.5 text-[11px] font-medium', k === 0 ? 'bg-permukaan text-tinta shadow-lembut' : 'text-tinta-2')}>{m}</span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-end justify-between gap-2">
            <div>
              <p className="text-[11px] font-medium text-tinta-3">Selasa, 21 Oktober</p>
              <p className="text-[22px] font-bold leading-tight tracking-[-0.035em] text-tinta sm:text-[26px]">Selamat pagi, Bu Sari.</p>
            </div>
            <Maskot pose="analisis" ukuran="mini" className="-mb-1" />
          </div>
          <Gelembung className="mt-2 !rounded-[16px] !px-3.5 !py-2.5 text-[12px] sm:text-[13px]">9 dari 11 orang sudah absen hari ini, 1 terlambat. Ada 1 absen yang perlu kamu cek.</Gelembung>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[['Sudah hadir', '9', 'bg-inti'], ['Terlambat', '1', 'bg-perlu'], ['Belum absen', '2', 'bg-tinta-3'], ['Cuti / izin', '1', 'bg-aksen']].map(([l, n, w]) => (
              <div key={l} className="kaca-panel rounded-[16px] px-3 py-2">
                <p className="flex items-center gap-1.5 text-[10px] font-medium text-tinta-3"><span className={cx('h-1.5 w-1.5 rounded-full', w)} />{l}</p>
                <p className="text-[22px] font-bold tabular-nums leading-tight tracking-[-0.03em] text-tinta">{n}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1.3fr_1fr]">
            <div className="kaca-panel rounded-[18px] p-3">
              <p className="mb-1.5 text-[12px] font-semibold text-tinta">Masuk & keluar hari ini</p>
              {ARUS.map((r) => (
                <div key={r.nama} className="flex items-center gap-2 py-1.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sumur text-[10px] font-bold text-tinta-2">{r.inisial}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold text-tinta">{r.nama}</span>
                    <span className="block text-[10px] text-tinta-3">Masuk {r.masuk} · belum keluar</span>
                  </span>
                  <span className="origin-right scale-[0.85]"><AttendanceBadge status={r.status} /></span>
                </div>
              ))}
            </div>
            <div className="kaca-panel rounded-[18px] p-3">
              <p className="mb-1.5 text-[12px] font-semibold text-tinta">Perlu dicek</p>
              <div className="flex items-center gap-2 py-1.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-perlu-lembut text-[10px] font-bold text-perlu">YP</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-semibold text-tinta">Yoga Putra</span>
                  <span className="block text-[10px] text-tinta-3">Skor 55 · ketuk untuk lihat foto & lokasi</span>
                </span>
              </div>
              <p className="mt-1.5 rounded-[10px] bg-perlu-lembut px-2.5 py-1.5 text-[10px] text-perlu">Di luar area kerja</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export { useTerlihat }
