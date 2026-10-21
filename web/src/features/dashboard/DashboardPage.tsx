/**
 * Beranda pemilik/admin. Pola Beranda AgentBuff: sapaan + maskot yang melapor dalam
 * satu kalimat, lalu angka hari ini, siapa yang masuk/keluar (diperbarui otomatis),
 * dan yang perlu dicek. Penyiapan perusahaan tampil sampai langkah wajib selesai.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api/client'
import { useActor } from '@/auth/useActor'
import { Badge, Button, EmptyState, Select, Skeleton, cx } from '@/components/ui'
import { AttendanceBadge } from '@/components/StatusBadge'
import { Gelembung, Maskot } from '@/components/merek'
import { IconAlert, IconArrowRight, IconCheck, IconChevronRight, IconClock } from '@/components/ui/icons'
import { formatDateShort, formatTime, hariIniPanjang, sapaanWaktu } from '@/lib/format'
import { AttendanceDetailSheet } from './AttendanceDetailSheet'

const SEGAR_MS = 20_000

function inisial(nama: string) {
  const b = nama.trim().split(/\s+/)
  return ((b[0]?.[0] ?? '') + (b[1]?.[0] ?? '')).toUpperCase()
}

export default function DashboardPage() {
  const qc = useQueryClient()
  const { company, scopeBranchIds, role, user } = useActor()
  const companyId = company?.id
  const [cabang, setCabang] = useState('')
  const [buka, setBuka] = useState<string | null>(null)
  const [lewatiDivisi, setLewatiDivisi] = useState(() => {
    try { return localStorage.getItem('absentra_lewati_divisi') === '1' } catch { return false }
  })

  useEffect(() => {
    const onSync = () => qc.invalidateQueries({ queryKey: ['dashboard'] })
    window.addEventListener('absentra:synced', onSync)
    return () => window.removeEventListener('absentra:synced', onSync)
  }, [qc])

  const pemilik = role === 'owner'
  const branchesQ = useQuery({ queryKey: ['branches', companyId], enabled: !!companyId, queryFn: () => api.branches() })
  const shiftsQ = useQuery({ queryKey: ['shiftTemplates', companyId], enabled: !!companyId && pemilik, queryFn: () => api.shiftTemplates() })
  const empQ = useQuery({ queryKey: ['employees', companyId], enabled: !!companyId && pemilik, queryFn: () => api.employees() })
  const divQ = useQuery({ queryKey: ['divisions', companyId], enabled: !!companyId && pemilik, queryFn: () => api.divisions() })
  const branchId = cabang || (scopeBranchIds.length === 1 ? scopeBranchIds[0] : undefined)
  const ringkasQ = useQuery({ queryKey: ['dashboard', 'summary', companyId, branchId], enabled: !!companyId, refetchInterval: SEGAR_MS, queryFn: () => api.dashboardSummary(undefined, branchId) })
  const arusQ = useQuery({ queryKey: ['dashboard', 'feed', companyId, branchId], enabled: !!companyId, refetchInterval: SEGAR_MS, queryFn: () => api.liveFeed(undefined, branchId) })
  const anomQ = useQuery({ queryKey: ['dashboard', 'anom', companyId, branchId], enabled: !!companyId, refetchInterval: SEGAR_MS, queryFn: () => api.anomalies(undefined, branchId) })
  const trenQ = useQuery({ queryKey: ['dashboard', 'trends', companyId, branchId], enabled: !!companyId, queryFn: () => api.dashboardTrends(branchId, 7) })

  const s = ringkasQ.data
  const terjadwal = s ? s.present + s.notYet : 0
  const langkah = [
    { label: 'Tentukan lokasi kerja', ket: 'Titik dan radius tempat karyawan absen.', to: '/cabang', selesai: (branchesQ.data?.length ?? 0) > 0, wajib: true },
    { label: 'Buat jam kerja (shift)', ket: 'Misalnya Shift Pagi 08.00 sampai 17.00.', to: '/shift', selesai: (shiftsQ.data?.length ?? 0) > 0, wajib: true },
    { label: 'Buat divisi', ket: 'Opsional, misalnya Dapur, Kasir, Gudang.', to: '/divisi', selesai: (divQ.data?.length ?? 0) > 0 || lewatiDivisi, wajib: false },
    { label: 'Undang karyawan', ket: 'Kirim link undangan lewat WhatsApp.', to: '/karyawan', selesai: (empQ.data?.length ?? 0) > 0, wajib: true },
    { label: 'Susun jadwal', ket: 'Tentukan siapa masuk shift apa.', to: '/shift', selesai: terjadwal > 0, wajib: true },
  ]
  const siap = langkah.every((x) => !x.wajib || x.selesai)
  const berikut = langkah.findIndex((x) => !x.selesai)
  const tampilPenyiapan = pemilik && !branchesQ.isLoading && !shiftsQ.isLoading && !empQ.isLoading && !siap

  const perluCek = anomQ.data?.length ?? 0
  const kalimat = !s
    ? 'Sebentar, aku hitung dulu kehadiran hari ini...'
    : tampilPenyiapan
      ? 'Usahamu belum siap dipakai absen. Yuk selesaikan langkah di bawah, tinggal sedikit.'
      : terjadwal === 0
        ? 'Hari ini belum ada yang dijadwalkan masuk.'
        : `${s.present} dari ${terjadwal} orang sudah absen hari ini${s.late ? `, ${s.late} terlambat` : ''}.${perluCek ? ` Ada ${perluCek} absen yang perlu kamu cek.` : ' Semua absen terlihat wajar.'}`

  return (
    <div className="mx-auto max-w-6xl">
      {/* Sapaan */}
      <section className="relative grid items-end gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0 pb-1">
              <p className="text-[14px] font-medium text-tinta-3">{hariIniPanjang()}</p>
              <h1 className="mt-1 text-[32px] font-bold leading-[1.05] tracking-[-0.035em] text-tinta sm:text-[40px]">
                {sapaanWaktu()}, {user?.name?.split(' ')[0]}.
              </h1>
            </div>
            <div className="relative shrink-0 lg:hidden">
              <div className="cahaya-aksen absolute -inset-4" />
              <Maskot pose="analisis" ukuran="kecil" prioritas className="relative" />
            </div>
          </div>
          <Gelembung className="mt-4 max-w-2xl">
            <p>{kalimat}</p>
            {perluCek > 0 && !tampilPenyiapan && (
              <a href="#perlu-dicek" className="kaca-pil mt-3 inline-flex min-h-[38px] items-center gap-1.5 rounded-full px-4 text-[14px] font-semibold text-tinta">
                Lihat yang perlu dicek <IconChevronRight width={15} height={15} />
              </a>
            )}
          </Gelembung>
        </div>
        <div className="relative hidden lg:block" aria-hidden>
          <div className="cahaya-aksen absolute -inset-10" />
          <Maskot pose="analisis" ukuran="besar" prioritas className="relative" />
        </div>
      </section>

      {tampilPenyiapan && (
        <section className="kaca-panel mt-6 rounded-[28px] p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-tinta">Siapkan usahamu</h2>
            <span className="text-[14px] font-medium text-tinta-3">{langkah.filter((x) => x.selesai).length} dari {langkah.length}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sumur">
            <div className="h-full rounded-full bg-grafit transition-[width]" style={{ width: `${(langkah.filter((x) => x.selesai).length / langkah.length) * 100}%` }} />
          </div>
          <ol className="mt-4 flex flex-col gap-1.5">
            {langkah.map((x, i) => {
              const aktif = i === berikut
              return (
                <li key={x.label} className={cx('flex flex-wrap items-center gap-x-3 gap-y-2.5 rounded-[18px] px-3 py-3', aktif && 'bg-permukaan shadow-lembut')}>
                  <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold', x.selesai ? 'bg-inti-lembut text-inti-teks' : aktif ? 'bg-grafit text-grafit-teks' : 'bg-sumur text-tinta-3')}>
                    {x.selesai ? <IconCheck width={16} height={16} /> : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cx('text-[15px] font-semibold', x.selesai ? 'text-tinta-3 line-through' : 'text-tinta')}>{x.label}</p>
                    {aktif && <p className="text-[13px] text-tinta-3">{x.ket}</p>}
                  </div>
                  {aktif && (
                    <div className="ml-11 flex w-[calc(100%-44px)] shrink-0 items-center gap-1 sm:ml-0 sm:w-auto">
                      {!x.wajib && (
                        <Button size="sm" variant="ghost" onClick={() => { setLewatiDivisi(true); try { localStorage.setItem('absentra_lewati_divisi', '1') } catch { /* */ } }}>Lewati</Button>
                      )}
                      <Link to={x.to} className="tombol-grafit inline-flex min-h-[40px] items-center gap-1.5 rounded-full px-4 text-[14px] font-semibold">
                        Buka <IconArrowRight width={15} height={15} />
                      </Link>
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        </section>
      )}

      {/* Angka hari ini */}
      <section className="mt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-[20px] font-semibold tracking-[-0.02em] text-tinta">
            Hari ini <span className="titik-hidup h-2 w-2 rounded-full" aria-hidden /> <span className="text-[13px] font-medium text-tinta-3">diperbarui otomatis</span>
          </h2>
          {scopeBranchIds.length !== 1 && (branchesQ.data?.length ?? 0) > 1 && (
            <Select aria-label="Pilih lokasi" value={cabang} onChange={(e) => setCabang(e.target.value)} className="!min-h-[40px] !w-auto !rounded-full !py-0 !text-[14px]">
              <option value="">Semua lokasi</option>
              {branchesQ.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5 [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1">
          <Angka label="Sudah hadir" nilai={s?.present} memuat={ringkasQ.isLoading} titik="bg-inti" />
          <Angka label="Terlambat" nilai={s?.late} memuat={ringkasQ.isLoading} titik="bg-perlu" />
          <Angka label="Belum absen" nilai={s?.notYet} memuat={ringkasQ.isLoading} titik="bg-tinta-3" />
          <Angka label="Cuti / izin" nilai={s?.onLeave} memuat={ringkasQ.isLoading} titik="bg-aksen" />
          <Angka label="Lembur" nilai={s?.overtime} memuat={ringkasQ.isLoading} titik="bg-grafit" />
        </div>
      </section>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Panel judul="Masuk & keluar hari ini">
          {arusQ.isLoading ? (
            <Skeleton className="h-40" />
          ) : arusQ.data?.length ? (
            <div className="-mx-2 flex flex-col">
              {arusQ.data.map((r) => (
                <button key={r.id} type="button" onClick={() => setBuka(r.id)} className="flex items-center gap-3 rounded-[16px] px-2 py-2.5 text-left hover:bg-sumur">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sumur text-[13px] font-bold text-tinta-2">{inisial(r.name)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-tinta">{r.name}</span>
                    <span className="block text-[13px] tabular-nums text-tinta-3">
                      Masuk {r.clockInAt ? formatTime(r.clockInAt) : '-'} · {r.clockOutAt ? `keluar ${formatTime(r.clockOutAt)}` : 'belum keluar'}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <AttendanceBadge status={r.status} trustScore={r.trustScore} />
                    {r.leftEarly && <Badge tone="warning">Pulang cepat</Badge>}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="py-6 text-center text-[14px] text-tinta-3">Belum ada yang absen hari ini.</p>
          )}
        </Panel>

        <div className="flex flex-col gap-5">
          <Panel judul="Perlu dicek" id="perlu-dicek" ikon={<IconAlert width={18} height={18} className="text-perlu" />}>
            {anomQ.isLoading ? (
              <Skeleton className="h-24" />
            ) : anomQ.data?.length ? (
              <div className="-mx-2 flex flex-col">
                {anomQ.data.map((r) => (
                  <button key={r.id} type="button" onClick={() => setBuka(r.id)} className="flex items-center gap-3 rounded-[16px] px-2 py-2.5 text-left hover:bg-sumur">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-perlu-lembut text-[13px] font-bold text-perlu">{inisial(r.name)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold text-tinta">{r.name}</span>
                      <span className="block text-[13px] text-tinta-3">Skor {r.trustScore} · ketuk untuk lihat foto & lokasi</span>
                    </span>
                    <IconChevronRight width={16} height={16} className="text-tinta-3" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="py-4 text-center text-[14px] text-tinta-3">Tidak ada yang mencurigakan hari ini.</p>
            )}
          </Panel>

          <Panel judul="7 hari terakhir">
            {trenQ.isLoading ? <Skeleton className="h-36" /> : <GrafikTren data={trenQ.data ?? []} />}
          </Panel>
        </div>
      </div>

      {!tampilPenyiapan && terjadwal === 0 && !ringkasQ.isLoading && (
        <div className="mt-6">
          <EmptyState
            pose="jadwal"
            title="Belum ada jadwal hari ini"
            keterangan="Karyawan baru bisa absen kalau sudah punya jadwal shift."
            action={<Link to="/shift" className="tombol-grafit inline-flex min-h-[46px] items-center gap-2 rounded-full px-5 text-[15px] font-semibold"><IconClock width={18} height={18} /> Susun jadwal</Link>}
          />
        </div>
      )}

      <AttendanceDetailSheet recordId={buka} onClose={() => setBuka(null)} />
    </div>
  )
}

function Panel({ judul, children, ikon, id }: { judul: string; children: ReactNode; ikon?: ReactNode; id?: string }) {
  return (
    <section id={id} className="kaca-panel scroll-mt-24 rounded-[28px] p-5">
      <h2 className="mb-3 flex items-center gap-2 text-[18px] font-semibold tracking-[-0.02em] text-tinta">{ikon}{judul}</h2>
      {children}
    </section>
  )
}

function Angka({ label, nilai, memuat, titik }: { label: string; nilai?: number; memuat?: boolean; titik: string }) {
  return (
    <div className="kaca-panel rounded-[22px] px-4 py-3.5">
      <p className="flex items-center gap-2 text-[13px] font-medium text-tinta-3"><span className={cx('h-2 w-2 rounded-full', titik)} />{label}</p>
      {memuat ? <Skeleton className="mt-2 h-8 w-12" /> : <p className="mt-1 text-[30px] font-bold tabular-nums leading-tight tracking-[-0.03em] text-tinta">{nilai ?? 0}</p>}
    </div>
  )
}

function GrafikTren({ data }: { data: Array<{ date: string; present: number; late: number }> }) {
  if (!data.length) return <p className="py-6 text-center text-[14px] text-tinta-3">Belum ada data.</p>
  const maks = Math.max(1, ...data.map((d) => d.present))
  return (
    <div>
      <div className="flex h-32 items-end justify-between gap-2">
        {data.map((d) => {
          const tinggi = Math.round((d.present / maks) * 100)
          const telat = d.present ? Math.round((d.late / d.present) * 100) : 0
          return (
            <div key={d.date} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5" title={`${d.present} hadir, ${d.late} terlambat`}>
              <span className="text-[12px] font-semibold tabular-nums text-tinta-2">{d.present}</span>
              <div className="relative w-full max-w-[28px] overflow-hidden rounded-[8px] bg-aksen/35" style={{ height: `${Math.max(tinggi, d.present ? 6 : 2)}%` }}>
                <div className="absolute inset-x-0 bottom-0 bg-perlu" style={{ height: `${telat}%` }} />
              </div>
              <span className="text-[12px] text-tinta-3">{formatDateShort(d.date).split(' ')[0]}</span>
            </div>
          )
        })}
      </div>
      <div className="mt-3 flex items-center gap-4 text-[13px] text-tinta-3">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-aksen/35" /> Hadir</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-perlu" /> Terlambat</span>
      </div>
    </div>
  )
}
