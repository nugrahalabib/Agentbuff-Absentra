/** Shift & jadwal: jam kerja (template), jadwal minggu ini, dan penyusun jadwal massal. */
import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import type { ShiftTemplate } from '@/lib/domain/types'
import { BottomSheet, Button, Centang, EmptyState, Field, Input, InputAngka, KepalaHalaman, PesanGalat, Saklar, Select, Skeleton, cx } from '@/components/ui'
import { Maskot } from '@/components/merek'
import { IconCalendar, IconChevronLeft, IconChevronRight, IconClock, IconEdit, IconPlus } from '@/components/ui/icons'
import { toast } from '@/components/Toast'
import { formatDateShort, formatDayName, tambahHari, todayISODate } from '@/lib/format'
import { pesanGalat } from '@/lib/galat'

function senin(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const hari = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = Minggu
  return tambahHari(iso, hari === 0 ? -6 : 1 - hari)
}

export default function ShiftsPage() {
  const qc = useQueryClient()
  const [lembar, setLembar] = useState<null | 'baru' | 'susun' | ShiftTemplate>(null)
  const templates = useQuery({ queryKey: ['shiftTemplates'], queryFn: () => api.shiftTemplates() })
  const segarkan = () => {
    qc.invalidateQueries({ queryKey: ['shiftTemplates'] })
    qc.invalidateQueries({ queryKey: ['schedule'] })
    qc.invalidateQueries({ queryKey: ['jadwal-tim'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-end justify-between gap-3">
        <KepalaHalaman
          judul="Shift & jadwal"
          keterangan="Atur jam kerja, lalu tentukan siapa masuk kapan."
          aksi={
            <>
              <Button variant="secondary" onClick={() => setLembar('baru')}><IconPlus width={18} height={18} /> Jam kerja</Button>
              <Button onClick={() => setLembar('susun')} disabled={!templates.data?.length}><IconCalendar width={18} height={18} /> Susun jadwal</Button>
            </>
          }
        />
        <Maskot pose="jadwal" ukuran="kecil" className="-mb-1 hidden shrink-0 sm:block" />
      </div>

      <h2 className="mb-2.5 text-[20px] font-semibold tracking-[-0.02em] text-tinta">Jam kerja</h2>
      {templates.isLoading ? (
        <Skeleton className="h-24" />
      ) : !templates.data?.length ? (
        <EmptyState pose="jadwal" title="Belum ada jam kerja" keterangan="Buat dulu, misalnya Shift Pagi 08.00 sampai 17.00." action={<Button onClick={() => setLembar('baru')}><IconPlus width={18} height={18} /> Buat jam kerja</Button>} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.data.map((s) => (
            <button key={s.id} type="button" onClick={() => setLembar(s)} className="kaca-panel flex items-start gap-3 rounded-[22px] p-4 text-left transition-transform active:scale-[0.99]">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sumur text-tinta"><IconClock width={20} height={20} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] font-semibold text-tinta">{s.name}</span>
                <span className="block text-[14px] tabular-nums text-tinta-2">{s.startTime} sampai {s.endTime}{s.crossesMidnight ? ' (besok)' : ''}</span>
                <span className="mt-0.5 block text-[13px] text-tinta-3">Toleransi telat {s.lateToleranceMinutes} mnt · istirahat {s.breakMinutes} mnt</span>
              </span>
              <IconEdit width={16} height={16} className="mt-1 shrink-0 text-tinta-3" />
            </button>
          ))}
        </div>
      )}

      {!!templates.data?.length && <JadwalTim templates={templates.data} />}

      <BottomSheet open={lembar === 'baru'} onClose={() => setLembar(null)} title="Jam kerja baru">
        <FormShift onSelesai={(p) => { segarkan(); setLembar(null); toast.berhasil(p) }} />
      </BottomSheet>
      <BottomSheet open={!!lembar && typeof lembar === 'object'} onClose={() => setLembar(null)} title="Ubah jam kerja">
        {typeof lembar === 'object' && lembar && <FormShift key={lembar.id} awal={lembar} onSelesai={(p) => { segarkan(); setLembar(null); toast.berhasil(p) }} />}
      </BottomSheet>
      <BottomSheet open={lembar === 'susun'} onClose={() => setLembar(null)} title="Susun jadwal" keterangan="Pilih jam kerja, tanggal, lalu orangnya.">
        <FormSusun templates={templates.data ?? []} onSelesai={() => { segarkan(); setLembar(null) }} />
      </BottomSheet>
    </div>
  )
}

/** Dipakai juga oleh wizard penyiapan. */
export function FormShift({ awal, onSelesai, tombol = 'Simpan' }: { awal?: ShiftTemplate; onSelesai: (pesan: string) => void; tombol?: string }) {
  const [nama, setNama] = useState(awal?.name ?? 'Shift Pagi')
  const [mulai, setMulai] = useState(awal?.startTime ?? '08:00')
  const [selesai, setSelesai] = useState(awal?.endTime ?? '17:00')
  const [istirahat, setIstirahat] = useState(awal?.breakMinutes ?? 60)
  const [toleransi, setToleransi] = useState(awal?.lateToleranceMinutes ?? 10)
  const malam = selesai <= mulai
  const m = useMutation({
    mutationFn: () => {
      const data = { name: nama.trim(), startTime: mulai, endTime: selesai, crossesMidnight: malam, breakMinutes: istirahat, lateToleranceMinutes: toleransi }
      return awal ? api.updateShiftTemplate(awal.id, data) : api.createShiftTemplate(data)
    },
    onSuccess: () => onSelesai(awal ? 'Jam kerja tersimpan.' : 'Jam kerja ditambahkan.'),
  })
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
      <Field label="Nama"><Input value={nama} onChange={(e) => setNama(e.target.value)} placeholder="mis. Shift Malam" required maxLength={60} /></Field>
      <div className="flex gap-3">
        <Field label="Mulai"><Input type="time" value={mulai} onChange={(e) => setMulai(e.target.value)} required /></Field>
        <Field label="Selesai"><Input type="time" value={selesai} onChange={(e) => setSelesai(e.target.value)} required /></Field>
      </div>
      {malam && <p className="rounded-[16px] bg-aksen-lembut px-4 py-2.5 text-[14px] text-aksen-teks">Selesai keesokan harinya, jadi ini dihitung shift malam.</p>}
      <div className="flex gap-3">
        <Field label="Istirahat (menit)"><InputAngka min={0} max={240} nilai={istirahat} onNilai={setIstirahat} /></Field>
        <Field label="Toleransi telat (menit)" helper="Lewat dari ini dihitung telat."><InputAngka min={0} max={120} nilai={toleransi} onNilai={setToleransi} /></Field>
      </div>
      <PesanGalat>{m.isError ? pesanGalat(m.error) : null}</PesanGalat>
      <Button type="submit" size="lg" fullWidth loading={m.isPending} disabled={!nama.trim()}>{tombol}</Button>
    </form>
  )
}

function FormSusun({ templates, onSelesai }: { templates: ShiftTemplate[]; onSelesai: () => void }) {
  const karyawan = useQuery({ queryKey: ['employees'], queryFn: () => api.employees() })
  const hariIni = todayISODate()
  const [pilih, setPilih] = useState<string[]>([])
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '')
  const [dari, setDari] = useState(hariIni)
  const [sampai, setSampai] = useState(tambahHari(hariIni, 6))
  const [lewatiMinggu, setLewatiMinggu] = useState(true)
  const [hasil, setHasil] = useState<{ created: number; conflictDetails?: Array<{ employeeId: string; date: string; reason: string; message?: string }> } | null>(null)
  const aktif = (karyawan.data ?? []).filter((e) => e.employmentStatus === 'active')
  const m = useMutation({
    mutationFn: () => api.bulkAssign({ employeeIds: pilih, shiftTemplateId: templateId, dateStart: dari, dateEnd: sampai < dari ? dari : sampai, skipSundays: lewatiMinggu }),
    onSuccess: (r) => {
      setHasil(r)
      if (!r.conflictDetails?.length) { toast.berhasil(`${r.created} jadwal dibuat.`); onSelesai() }
    },
  })
  const ubahPilih = (id: string) => setPilih((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  if (hasil && hasil.conflictDetails?.length) {
    return (
      <div className="flex flex-col gap-4">
        <p className="rounded-[18px] bg-inti-lembut px-4 py-3 text-[15px] text-inti-teks">{hasil.created} jadwal dibuat.</p>
        <div className="rounded-[18px] bg-perlu-lembut px-4 py-3 text-[14px] text-perlu">
          <p className="font-semibold">{hasil.conflictDetails.length} jadwal dilewati karena bentrok</p>
          <ul className="mt-1 max-h-40 list-disc overflow-y-auto pl-5">
            {hasil.conflictDetails.slice(0, 30).map((c, i) => (
              <li key={i}>{aktif.find((e) => e.id === c.employeeId)?.name ?? 'Karyawan'}, {formatDateShort(c.date)}: {alasanBentrok(c.reason)}</li>
            ))}
          </ul>
        </div>
        <Button fullWidth onClick={onSelesai}>Selesai</Button>
      </div>
    )
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (pilih.length && templateId) m.mutate() }}>
      <Field label="Jam kerja">
        <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>{templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.startTime} sampai {t.endTime})</option>)}</Select>
      </Field>
      <div className="flex gap-3">
        <Field label="Dari"><Input type="date" value={dari} onChange={(e) => setDari(e.target.value)} required /></Field>
        <Field label="Sampai"><Input type="date" value={sampai} min={dari} onChange={(e) => setSampai(e.target.value)} required /></Field>
      </div>
      <Saklar checked={lewatiMinggu} onChange={setLewatiMinggu} label="Lewati hari Minggu" keterangan="Matikan kalau usahamu buka setiap hari." />
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[14px] font-medium text-tinta-2">Siapa saja ({pilih.length} dipilih)</span>
          <button type="button" className="text-[14px] font-semibold text-aksen-teks" onClick={() => setPilih(pilih.length === aktif.length ? [] : aktif.map((e) => e.id))}>
            {pilih.length === aktif.length && aktif.length > 0 ? 'Kosongkan' : 'Pilih semua'}
          </button>
        </div>
        <div className="max-h-56 overflow-y-auto rounded-[18px] bg-sumur px-3">
          {karyawan.isLoading ? <Skeleton className="my-3 h-10" /> : aktif.length === 0 ? (
            <p className="py-4 text-center text-[14px] text-tinta-3">Belum ada karyawan aktif.</p>
          ) : aktif.map((e) => (
            <Centang key={e.id} checked={pilih.includes(e.id)} onChange={() => ubahPilih(e.id)}>{e.name}</Centang>
          ))}
        </div>
      </div>
      <PesanGalat>{m.isError ? pesanGalat(m.error) : null}</PesanGalat>
      <Button type="submit" size="lg" fullWidth loading={m.isPending} disabled={!pilih.length || !templateId}>Terapkan jadwal</Button>
    </form>
  )
}

function alasanBentrok(r: string): string {
  if (r.includes('overlap')) return 'sudah ada shift lain'
  if (r.includes('rest')) return 'jarak istirahat terlalu pendek'
  if (r.includes('inactive')) return 'karyawan nonaktif'
  return 'tidak bisa dijadwalkan'
}

/** Jadwal tim satu minggu: baris = orang, kolom = hari. */
function JadwalTim({ templates }: { templates: ShiftTemplate[] }) {
  const [awal, setAwal] = useState(() => senin(todayISODate()))
  const akhir = tambahHari(awal, 6)
  const hari = useMemo(() => Array.from({ length: 7 }, (_, i) => tambahHari(awal, i)), [awal])
  const hariIni = todayISODate()
  const jadwal = useQuery({ queryKey: ['jadwal-tim', awal], queryFn: () => api.assignmentsForEmployee(undefined, undefined, awal, akhir) })
  const karyawan = useQuery({ queryKey: ['employees'], queryFn: () => api.employees() })
  const peta = useMemo(() => {
    const m = new Map<string, string>()
    for (const { assignment, template } of jadwal.data ?? []) m.set(`${assignment.employeeId}|${assignment.workDate}`, template.name)
    return m
  }, [jadwal.data])
  const warna = useMemo(() => new Map(templates.map((t, i) => [t.name, i % 3])), [templates])
  const orang = (karyawan.data ?? []).filter((e) => e.employmentStatus === 'active')

  return (
    <section className="mt-8">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-tinta">Jadwal tim</h2>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Minggu sebelumnya" onClick={() => setAwal(tambahHari(awal, -7))} className="flex h-10 w-10 items-center justify-center rounded-full text-tinta-2 hover:bg-sumur"><IconChevronLeft width={18} height={18} /></button>
          <span className="min-w-[132px] text-center text-[14px] font-medium text-tinta-2">{formatDateShort(awal)} sampai {formatDateShort(akhir)}</span>
          <button type="button" aria-label="Minggu berikutnya" onClick={() => setAwal(tambahHari(awal, 7))} className="flex h-10 w-10 items-center justify-center rounded-full text-tinta-2 hover:bg-sumur"><IconChevronRight width={18} height={18} /></button>
        </div>
      </div>
      {jadwal.isLoading || karyawan.isLoading ? (
        <Skeleton className="h-40" />
      ) : orang.length === 0 ? (
        <p className="kaca-panel rounded-[22px] px-4 py-6 text-center text-[14px] text-tinta-3">Belum ada karyawan untuk dijadwalkan.</p>
      ) : (
        <div className="kaca-panel overflow-x-auto rounded-[24px]">
          <table className="w-full min-w-[640px] text-[14px]">
            <thead>
              <tr className="text-tinta-3">
                <th className="sticky left-0 bg-[var(--kaca-pekat)] p-3 text-left font-medium lg:bg-transparent">Nama</th>
                {hari.map((h) => (
                  <th key={h} className={cx('p-2 text-center font-medium', h === hariIni && 'text-tinta')}>
                    <span className="block text-[12px] capitalize">{formatDayName(h).slice(0, 3)}</span>
                    <span className={cx('mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-[13px]', h === hariIni && 'bg-grafit font-bold text-grafit-teks')}>{formatDateShort(h).split(' ')[0]}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orang.map((e) => (
                <tr key={e.id} className="border-t border-garis">
                  <td className="sticky left-0 max-w-[160px] truncate bg-[var(--kaca-pekat)] p-3 font-medium text-tinta lg:bg-transparent">{e.name}</td>
                  {hari.map((h) => {
                    const n = peta.get(`${e.id}|${h}`)
                    const w = n != null ? warna.get(n) ?? 0 : -1
                    return (
                      <td key={h} className="p-1.5 text-center">
                        {n ? (
                          <span className={cx('inline-block max-w-[84px] truncate rounded-full px-2 py-1 text-[12px] font-semibold', w === 0 ? 'bg-aksen-lembut text-aksen-teks' : w === 1 ? 'bg-perlu-lembut text-perlu' : 'bg-sumur text-tinta-2')}>{n}</span>
                        ) : (
                          <span className="text-tinta-3">-</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
