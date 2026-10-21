/** Laporan absensi: rapor per karyawan (siap cetak) atau daftar absen dengan saringan. */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { useActor } from '@/auth/useActor'
import { Badge, Button, EmptyState, Field, Input, KepalaHalaman, PesanGalat, Segmen, Select, Skeleton } from '@/components/ui'
import { AttendanceBadge } from '@/components/StatusBadge'
import { Maskot } from '@/components/merek'
import { IconDownload, IconReceipt } from '@/components/ui/icons'
import { downloadCsv } from '@/lib/exporters'
import { awalBulan, formatDate, formatDateShort, formatTime, todayISODate } from '@/lib/format'
import { pesanGalat } from '@/lib/galat'
import { AttendanceDetailSheet } from '@/features/dashboard/AttendanceDetailSheet'
import { EmployeeReportDocument, exportEmployeeReportCsv } from './EmployeeReportDocument'

const STATUS: Record<string, string> = { on_time: 'Tepat waktu', late: 'Terlambat', absent: 'Tidak hadir' }

export default function LaporanPage() {
  const [mode, setMode] = useState<'karyawan' | 'daftar'>('karyawan')
  return (
    <div className="mx-auto max-w-6xl">
      <div className="no-print flex items-end justify-between gap-3">
        <KepalaHalaman judul="Laporan absensi" keterangan="Rapor per orang untuk dicetak, atau daftar semua absen." />
        <Maskot pose="analisis" ukuran="kecil" className="-mb-1 hidden shrink-0 sm:block" />
      </div>
      <Segmen label="Jenis laporan" nilai={mode} onChange={setMode} pilihan={[{ nilai: 'karyawan', label: 'Per karyawan' }, { nilai: 'daftar', label: 'Daftar absen' }]} className="no-print mb-5" />
      {mode === 'karyawan' ? <PanelKaryawan /> : <PanelDaftar />}
    </div>
  )
}

function PanelKaryawan() {
  const hariIni = todayISODate()
  const [dari, setDari] = useState(awalBulan(hariIni))
  const [sampai, setSampai] = useState(hariIni)
  const [orang, setOrang] = useState('')
  const [jalan, setJalan] = useState(0)
  const empQ = useQuery({ queryKey: ['employees'], queryFn: () => api.employees() })
  const rapor = useQuery({ queryKey: ['employeeReport', orang, dari, sampai, jalan], enabled: jalan > 0 && !!orang, queryFn: () => api.employeeReport(orang, dari, sampai) })

  const unduh = () => {
    if (!rapor.data) return
    const { summaryHeader, summaryRow, detailHeader, detailRows } = exportEmployeeReportCsv(rapor.data)
    const n = rapor.data.employee.name.replace(/\s+/g, '-')
    downloadCsv(`ringkasan-${n}-${dari}-${sampai}.csv`, summaryHeader, [summaryRow])
    downloadCsv(`detail-${n}-${dari}-${sampai}.csv`, detailHeader, detailRows)
  }

  return (
    <>
      <div className="kaca-panel no-print mb-5 grid gap-3 rounded-[24px] p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto] lg:items-end">
        <Field label="Karyawan">
          <Select value={orang} onChange={(e) => setOrang(e.target.value)}>
            <option value="">Pilih karyawan</option>
            {(empQ.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </Select>
        </Field>
        <Field label="Dari"><Input type="date" value={dari} onChange={(e) => setDari(e.target.value)} /></Field>
        <Field label="Sampai"><Input type="date" value={sampai} min={dari} onChange={(e) => setSampai(e.target.value)} /></Field>
        <Button disabled={!orang} onClick={() => setJalan((r) => r + 1)}><IconReceipt width={18} height={18} /> Tampilkan</Button>
      </div>
      {rapor.data && (
        <div className="no-print mb-4 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={unduh}><IconDownload width={16} height={16} /> Unduh CSV</Button>
          <Button variant="secondary" size="sm" onClick={() => window.print()}>Cetak / simpan PDF</Button>
        </div>
      )}
      {jalan === 0 ? (
        <EmptyState pose="analisis" title="Pilih karyawan dan periodenya" keterangan="Rapornya berisi hadir, telat, cuti, lembur, dan detail harian. Bisa dicetak atau disimpan jadi PDF." />
      ) : rapor.isLoading ? (
        <Skeleton className="h-72" />
      ) : rapor.isError ? (
        <PesanGalat>{pesanGalat(rapor.error)}</PesanGalat>
      ) : rapor.data ? (
        <EmployeeReportDocument report={rapor.data} />
      ) : null}
    </>
  )
}

function PanelDaftar() {
  const { company, scopeBranchIds } = useActor()
  const hariIni = todayISODate()
  const [dari, setDari] = useState(awalBulan(hariIni))
  const [sampai, setSampai] = useState(hariIni)
  const [cabang, setCabang] = useState('')
  const [divisi, setDivisi] = useState('')
  const [orang, setOrang] = useState('')
  const [jalan, setJalan] = useState(0)
  const [buka, setBuka] = useState<string | null>(null)

  const cabangQ = useQuery({ queryKey: ['branches'], queryFn: () => api.branches() })
  const divQ = useQuery({ queryKey: ['divisions'], queryFn: () => api.divisions() })
  const empQ = useQuery({ queryKey: ['employees'], queryFn: () => api.employees() })
  const branchId = cabang || (scopeBranchIds.length === 1 ? scopeBranchIds[0] : undefined)
  const q = useQuery({ queryKey: ['attlist', dari, sampai, branchId, jalan], enabled: jalan > 0, queryFn: () => api.attendanceList(dari, sampai, branchId) })

  const petaOrang = useMemo(() => new Map((empQ.data ?? []).map((e) => [e.id, e])), [empQ.data])
  const baris = (q.data ?? []).filter((r) => (!orang || r.employeeId === orang) && (!divisi || petaOrang.get(r.employeeId)?.divisionId === divisi))
  const pilihanOrang = (empQ.data ?? []).filter((e) => (!branchId || e.branchId === branchId) && (!divisi || e.divisionId === divisi))

  const unduh = () =>
    downloadCsv(
      `absensi-${dari}-${sampai}.csv`,
      ['Nama', 'Lokasi', 'Tanggal', 'Masuk', 'Keluar', 'Status', 'MenitTelat', 'Skor', 'PulangCepat'],
      baris.map((r) => [r.name, r.branchName, r.workDate, r.clockInAt ? formatTime(r.clockInAt) : '', r.clockOutAt ? formatTime(r.clockOutAt) : '', STATUS[r.status] ?? r.status, r.lateMinutes, r.trustScore, r.leftEarly ? 'Ya' : '']),
    )

  return (
    <>
      <div className="kaca-panel no-print mb-5 grid gap-3 rounded-[24px] p-4 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
        <Field label="Dari"><Input type="date" value={dari} onChange={(e) => setDari(e.target.value)} /></Field>
        <Field label="Sampai"><Input type="date" value={sampai} min={dari} onChange={(e) => setSampai(e.target.value)} /></Field>
        {scopeBranchIds.length !== 1 && (
          <Field label="Lokasi"><Select value={cabang} onChange={(e) => { setCabang(e.target.value); setOrang('') }}><option value="">Semua</option>{cabangQ.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
        )}
        <Field label="Divisi"><Select value={divisi} onChange={(e) => { setDivisi(e.target.value); setOrang('') }}><option value="">Semua</option>{divQ.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
        <Field label="Karyawan"><Select value={orang} onChange={(e) => setOrang(e.target.value)}><option value="">Semua</option>{pilihanOrang.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select></Field>
        <Button onClick={() => setJalan((r) => r + 1)}><IconReceipt width={18} height={18} /> Tampilkan</Button>
      </div>
      {baris.length > 0 && (
        <div className="no-print mb-4 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={unduh}><IconDownload width={16} height={16} /> Unduh CSV</Button>
          <Button variant="secondary" size="sm" onClick={() => window.print()}>Cetak / simpan PDF</Button>
        </div>
      )}
      {jalan === 0 ? (
        <EmptyState pose="analisis" title="Atur saringannya, lalu tampilkan" keterangan="Ketuk satu baris untuk melihat foto dan lokasi absennya." />
      ) : q.isLoading ? (
        <Skeleton className="h-48" />
      ) : q.isError ? (
        <PesanGalat>{pesanGalat(q.error)}</PesanGalat>
      ) : baris.length === 0 ? (
        <p className="py-8 text-center text-[15px] text-tinta-3">Tidak ada absen untuk saringan ini.</p>
      ) : (
        <div className="print-area kaca-panel overflow-x-auto rounded-[24px]">
          <div className="print-only mb-3 p-3">
            <h2 className="text-lg font-bold">Daftar absen · {company?.displayName ?? ''}</h2>
            <p className="text-sm">Periode {formatDate(dari)} sampai {formatDate(sampai)}</p>
          </div>
          <table className="w-full min-w-[760px] text-[14px]">
            <thead className="text-left text-tinta-3">
              <tr>
                <th className="p-3 font-medium">Nama</th><th className="p-3 font-medium">Lokasi</th><th className="p-3 font-medium">Tanggal</th>
                <th className="p-3 font-medium">Masuk</th><th className="p-3 font-medium">Keluar</th><th className="p-3 font-medium">Status</th>
                <th className="p-3 text-right font-medium">Telat</th>
              </tr>
            </thead>
            <tbody>
              {baris.map((r) => (
                <tr key={r.id} className="cursor-pointer border-t border-garis hover:bg-sumur" onClick={() => setBuka(r.id)}>
                  <td className="p-3 font-semibold text-tinta">{r.name}</td>
                  <td className="p-3 text-tinta-2">{r.branchName}</td>
                  <td className="p-3 tabular-nums text-tinta-2">{formatDateShort(r.workDate)}</td>
                  <td className="p-3 tabular-nums text-tinta">{r.clockInAt ? formatTime(r.clockInAt) : '-'}</td>
                  <td className="p-3 tabular-nums text-tinta">{r.clockOutAt ? formatTime(r.clockOutAt) : '-'} {r.leftEarly && <Badge tone="warning">cepat</Badge>}</td>
                  <td className="p-3"><AttendanceBadge status={r.status} trustScore={r.trustScore} /></td>
                  <td className="p-3 text-right tabular-nums text-tinta-2">{r.lateMinutes ? `${r.lateMinutes} mnt` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AttendanceDetailSheet recordId={buka} onClose={() => setBuka(null)} />
    </>
  )
}
