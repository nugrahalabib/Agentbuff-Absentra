/** Cuti & lembur milik sendiri: ajukan, lalu pantau statusnya. */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { useActor } from '@/auth/useActor'
import { BottomSheet, Button, EmptyState, Field, Input, KepalaHalaman, PesanGalat, Select, Skeleton } from '@/components/ui'
import { RequestBadge } from '@/components/StatusBadge'
import { Maskot } from '@/components/merek'
import { IconBriefcase, IconChevronRight, IconClock } from '@/components/ui/icons'
import { toast } from '@/components/Toast'
import { formatDate, todayISODate } from '@/lib/format'
import { pesanGalat } from '@/lib/galat'
import type { DayType, LeaveType } from '@/lib/domain/types'

const JENIS_CUTI: Record<string, string> = { tahunan: 'Cuti tahunan', sakit: 'Sakit', izin: 'Izin', tanpa_bayar: 'Cuti tanpa gaji' }
const JENIS_HARI: Record<string, string> = { workday: 'Hari kerja biasa', weekly_rest: 'Hari libur mingguan', public_holiday: 'Tanggal merah', shortest_day: 'Tanggal merah di hari kerja terpendek' }

export default function PengajuanPage() {
  const qc = useQueryClient()
  const { company, employeeId } = useActor()
  const [lembar, setLembar] = useState<null | 'cuti' | 'lembur'>(null)

  const cutiQ = useQuery({ queryKey: ['leaves', company?.id, employeeId], enabled: !!employeeId, queryFn: () => api.listLeaves(undefined, employeeId ?? undefined) })
  const lemburQ = useQuery({ queryKey: ['overtimes', company?.id, employeeId], enabled: !!employeeId, queryFn: () => api.listOvertimes(undefined, employeeId ?? undefined) })

  const selesai = (pesan: string) => {
    qc.invalidateQueries({ queryKey: ['leaves'] })
    qc.invalidateQueries({ queryKey: ['overtimes'] })
    qc.invalidateQueries({ queryKey: ['approvals'] })
    setLembar(null)
    toast.berhasil(pesan)
  }

  type Baris = { id: string; judul: string; ket: string; catatan?: string; status: 'pending' | 'approved' | 'rejected'; urut: string }
  const baris: Baris[] = [
    ...(cutiQ.data ?? []).map((l) => ({
      id: l.id,
      judul: JENIS_CUTI[l.type] ?? l.type,
      ket: l.dateEnd !== l.dateStart ? `${formatDate(l.dateStart)} sampai ${formatDate(l.dateEnd)}` : formatDate(l.dateStart),
      catatan: l.reason?.trim() || undefined,
      status: l.status,
      urut: l.dateStart,
    })),
    ...(lemburQ.data ?? []).map((o) => ({ id: o.id, judul: `Lembur ${o.hours} jam`, ket: `${formatDate(o.workDate)} · ${JENIS_HARI[o.dayType] ?? o.dayType}`, status: o.status, urut: o.workDate })),
  ].sort((a, b) => b.urut.localeCompare(a.urut))
  const memuat = cutiQ.isLoading || lemburQ.isLoading

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-end justify-between gap-3">
        <KepalaHalaman judul="Cuti & lembur" keterangan="Ajukan di sini, atasanmu yang menyetujui." />
        <Maskot pose="cuti" ukuran="kecil" className="-mb-1 shrink-0" />
      </div>

      <div className="mb-5 grid grid-cols-2 gap-2.5">
        <button type="button" onClick={() => setLembar('cuti')} className="kaca-panel flex flex-col gap-3 rounded-[24px] p-4 text-left transition-transform active:scale-[0.98]">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-permukaan text-tinta shadow-lembut"><IconBriefcase width={20} height={20} /></span>
          <span className="flex items-center gap-1 text-[16px] font-semibold text-tinta">Ajukan cuti <IconChevronRight width={15} height={15} className="text-tinta-3" /></span>
          <span className="-mt-2 text-[13px] text-tinta-3">Cuti, sakit, atau izin</span>
        </button>
        <button type="button" onClick={() => setLembar('lembur')} className="kaca-panel flex flex-col gap-3 rounded-[24px] p-4 text-left transition-transform active:scale-[0.98]">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-permukaan text-tinta shadow-lembut"><IconClock width={20} height={20} /></span>
          <span className="flex items-center gap-1 text-[16px] font-semibold text-tinta">Ajukan lembur <IconChevronRight width={15} height={15} className="text-tinta-3" /></span>
          <span className="-mt-2 text-[13px] text-tinta-3">Jam kerja tambahan</span>
        </button>
      </div>

      <h2 className="mb-2.5 text-[20px] font-semibold tracking-[-0.02em] text-tinta">Pengajuanku</h2>
      {memuat ? (
        <Skeleton className="h-24" />
      ) : cutiQ.isError || lemburQ.isError ? (
        <EmptyState title="Daftar belum bisa dimuat" keterangan={pesanGalat(cutiQ.error ?? lemburQ.error)} />
      ) : baris.length === 0 ? (
        <EmptyState pose="cuti" title="Belum ada pengajuan" keterangan="Mau cuti atau lembur? Pilih salah satu tombol di atas." />
      ) : (
        <div className="kaca-panel divide-y divide-garis overflow-hidden rounded-[24px]">
          {baris.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-3 px-4 py-3.5">
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-tinta">{b.judul}</p>
                <p className="text-[13px] text-tinta-3">{b.ket}</p>
                {b.catatan && <p className="mt-0.5 line-clamp-2 text-[13px] text-tinta-2">{b.catatan}</p>}
              </div>
              <RequestBadge status={b.status} />
            </div>
          ))}
        </div>
      )}

      <BottomSheet open={lembar === 'cuti'} onClose={() => setLembar(null)} title="Ajukan cuti" keterangan="Atasanmu akan mendapat permintaan ini.">
        <FormCuti onSelesai={() => selesai('Pengajuan cuti terkirim.')} />
      </BottomSheet>
      <BottomSheet open={lembar === 'lembur'} onClose={() => setLembar(null)} title="Ajukan lembur" keterangan="Dihitung sesuai PP 35/2021 setelah disetujui.">
        <FormLembur onSelesai={() => selesai('Pengajuan lembur terkirim.')} />
      </BottomSheet>
    </div>
  )
}

function FormCuti({ onSelesai }: { onSelesai: () => void }) {
  const hariIni = todayISODate()
  const [jenis, setJenis] = useState<LeaveType>('tahunan')
  const [mulai, setMulai] = useState(hariIni)
  const [sampai, setSampai] = useState(hariIni)
  const [alasan, setAlasan] = useState('')
  const m = useMutation({ mutationFn: () => api.createLeave({ type: jenis, dateStart: mulai, dateEnd: sampai < mulai ? mulai : sampai, reason: alasan || undefined }), onSuccess: onSelesai })

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
      <Field label="Jenis">
        <Select value={jenis} onChange={(e) => setJenis(e.target.value as LeaveType)}>
          {Object.entries(JENIS_CUTI).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </Field>
      <div className="flex gap-3">
        <Field label="Mulai"><Input type="date" value={mulai} onChange={(e) => setMulai(e.target.value)} required /></Field>
        <Field label="Sampai"><Input type="date" value={sampai} min={mulai} onChange={(e) => setSampai(e.target.value)} required /></Field>
      </div>
      <Field label="Alasan" helper="Boleh singkat, mis. acara keluarga.">
        <Input value={alasan} onChange={(e) => setAlasan(e.target.value)} maxLength={300} placeholder="Opsional" />
      </Field>
      <PesanGalat>{m.isError ? pesanGalat(m.error) : null}</PesanGalat>
      <Button type="submit" size="lg" fullWidth loading={m.isPending}>Kirim pengajuan</Button>
    </form>
  )
}

function FormLembur({ onSelesai }: { onSelesai: () => void }) {
  const [tanggal, setTanggal] = useState(todayISODate())
  const [jam, setJam] = useState(2)
  const [hari, setHari] = useState<DayType>('workday')
  const m = useMutation({ mutationFn: () => api.createOvertime({ workDate: tanggal, hours: jam, dayType: hari }), onSuccess: onSelesai })

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
      <Field label="Tanggal"><Input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} required /></Field>
      <Field label="Berapa jam?">
        <div className="flex items-center gap-2">
          <Button variant="secondary" aria-label="Kurangi" onClick={() => setJam((j) => Math.max(1, j - 1))}>−</Button>
          <Input type="number" inputMode="numeric" min={1} max={11} value={jam} onChange={(e) => setJam(Math.min(11, Math.max(1, Number(e.target.value) || 1)))} className="text-center text-[18px] font-semibold" />
          <Button variant="secondary" aria-label="Tambah" onClick={() => setJam((j) => Math.min(11, j + 1))}>+</Button>
        </div>
      </Field>
      <Field label="Hari apa?" helper="Menentukan pengali upah lembur.">
        <Select value={hari} onChange={(e) => setHari(e.target.value as DayType)}>
          {Object.entries(JENIS_HARI).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </Field>
      <PesanGalat>{m.isError ? pesanGalat(m.error) : null}</PesanGalat>
      <Button type="submit" size="lg" fullWidth loading={m.isPending}>Kirim pengajuan</Button>
    </form>
  )
}
