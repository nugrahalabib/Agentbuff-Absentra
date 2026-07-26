import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { useActor } from '@/auth/useActor'
import { Button, Card, Field, Input, Select, Skeleton, Badge } from '@/components/ui'
import { IconDownload, IconReceipt } from '@/components/ui/icons'
import { downloadCsv } from '@/lib/exporters'
import { formatDate, formatTime, todayISODate } from '@/lib/format'
import { AttendanceDetailSheet } from '@/features/dashboard/AttendanceDetailSheet'
import { EmployeeReportDocument, exportEmployeeReportCsv } from './EmployeeReportDocument'

function firstOfMonth(iso: string) { return iso.slice(0, 8) + '01' }
const statusLabel: Record<string, string> = { on_time: 'Tepat waktu', late: 'Terlambat', absent: 'Tidak hadir' }

/** Attendance list + per-employee periodic report (PRD §7.4.3). */
export function LaporanPage() {
  const [mode, setMode] = useState<'list' | 'employee'>('employee')

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-1 text-xl font-bold text-text">Riwayat & Laporan Absensi</h1>
      <p className="mb-4 text-sm text-text-muted">Laporan periodik per karyawan (absen, izin, cuti, lembur) atau daftar absensi mentah.</p>

      <div className="mb-4 flex gap-1 rounded-lg border border-border bg-surface-elevated p-1 no-print" role="tablist">
        <Tab active={mode === 'employee'} onClick={() => setMode('employee')}>Per karyawan</Tab>
        <Tab active={mode === 'list'} onClick={() => setMode('list')}>Daftar absensi</Tab>
      </div>

      {mode === 'employee' ? <EmployeeReportPanel /> : <AttendanceListPanel />}
    </div>
  )
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`min-h-touch flex-1 rounded-md px-3 text-sm font-medium transition-colors ${active ? 'bg-primary text-on-primary' : 'text-text-muted hover:bg-surface hover:text-text'}`}
    >
      {children}
    </button>
  )
}

function EmployeeReportPanel() {
  const today = todayISODate()
  const [from, setFrom] = useState(firstOfMonth(today))
  const [to, setTo] = useState(today)
  const [employeeId, setEmployeeId] = useState('')
  const [run, setRun] = useState(0)

  const empQ = useQuery({ queryKey: ['employees'], queryFn: () => api.employees() })
  const reportQ = useQuery({
    queryKey: ['employeeReport', employeeId, from, to, run],
    enabled: run > 0 && !!employeeId,
    queryFn: () => api.employeeReport(employeeId, from, to),
  })

  const exportCsv = () => {
    if (!reportQ.data) return
    const { summaryHeader, summaryRow, detailHeader, detailRows } = exportEmployeeReportCsv(reportQ.data)
    const name = reportQ.data.employee.name.replace(/\s+/g, '-')
    downloadCsv(`ringkasan-${name}-${from}-${to}.csv`, summaryHeader, [summaryRow])
    downloadCsv(`detail-${name}-${from}-${to}.csv`, detailHeader, detailRows)
  }

  return (
    <>
      <Card className="mb-4 no-print">
        <div className="grid w-full grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-12">
          <div className="min-w-0 sm:col-span-2 lg:col-span-4">
            <Field label="Karyawan">
              <Select value={employeeId} onChange={(e) => setEmployeeId((e.target as HTMLSelectElement).value)}>
                <option value="">Pilih karyawan…</option>
                {(empQ.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </Select>
            </Field>
          </div>
          <div className="min-w-0 lg:col-span-2">
            <Field label="Dari"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          </div>
          <div className="min-w-0 lg:col-span-2">
            <Field label="Sampai"><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
          <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
            <Button disabled={!employeeId} onClick={() => setRun((r) => r + 1)}><IconReceipt width={18} height={18} /> Tampilkan</Button>
            {reportQ.data && <>
              <Button variant="secondary" onClick={exportCsv}><IconDownload width={16} height={16} /> CSV</Button>
              <Button variant="secondary" onClick={() => window.print()}>Cetak PDF</Button>
            </>}
          </div>
        </div>
      </Card>

      {run === 0 ? (
        <p className="text-sm text-text-muted">Pilih karyawan dan periode, lalu klik Tampilkan.</p>
      ) : reportQ.isLoading ? (
        <Skeleton className="h-64" />
      ) : reportQ.data ? (
        <EmployeeReportDocument report={reportQ.data} />
      ) : (
        <p className="text-sm text-danger">Gagal memuat laporan.</p>
      )}
    </>
  )
}

function AttendanceListPanel() {
  const { company, scopeBranchIds } = useActor()
  const today = todayISODate()
  const [from, setFrom] = useState(firstOfMonth(today))
  const [to, setTo] = useState(today)
  const [branch, setBranch] = useState('')
  const [division, setDivision] = useState('')
  const [employee, setEmployee] = useState('')
  const [run, setRun] = useState(0)
  const [openId, setOpenId] = useState<string | null>(null)

  const branchesQ = useQuery({ queryKey: ['branches'], queryFn: () => api.branches() })
  const divQ = useQuery({ queryKey: ['divisions'], queryFn: () => api.divisions() })
  const empQ = useQuery({ queryKey: ['employees'], queryFn: () => api.employees() })
  const branchId = branch || (scopeBranchIds.length === 1 ? scopeBranchIds[0] : undefined)
  const q = useQuery({ queryKey: ['attlist', from, to, branchId, run], enabled: run > 0, queryFn: () => api.attendanceList(from, to, branchId) })

  const empMap = useMemo(() => new Map((empQ.data ?? []).map((e) => [e.id, e])), [empQ.data])
  const rows = (q.data ?? []).filter((r) => {
    if (employee && r.employeeId !== employee) return false
    if (division && empMap.get(r.employeeId)?.divisionId !== division) return false
    return true
  })
  const empOptions = (empQ.data ?? []).filter((e) => (!branchId || e.branchId === branchId) && (!division || e.divisionId === division))

  const exportCsv = () => downloadCsv(`absensi-${from}-${to}.csv`,
    ['Nama', 'Cabang', 'Tanggal', 'Masuk', 'Keluar', 'Status', 'Telat(menit)', 'Trust', 'PulangCepat'],
    rows.map((r) => [r.name, r.branchName, r.workDate, r.clockInAt ? formatTime(r.clockInAt) : '', r.clockOutAt ? formatTime(r.clockOutAt) : '', statusLabel[r.status] ?? r.status, r.lateMinutes, r.trustScore, r.leftEarly ? 'Ya' : '']))

  return (
    <>
      <Card className="mb-4 no-print">
        <div className="grid w-full grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-2">
            <Field label="Dari"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          </div>
          <div className="min-w-0 lg:col-span-2">
            <Field label="Sampai"><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
          {scopeBranchIds.length !== 1 && (
            <div className="min-w-0 lg:col-span-2">
              <Field label="Cabang"><Select value={branch} onChange={(e) => { setBranch((e.target as HTMLSelectElement).value); setEmployee('') }}><option value="">Semua</option>{branchesQ.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
            </div>
          )}
          <div className="min-w-0 lg:col-span-2">
            <Field label="Divisi"><Select value={division} onChange={(e) => { setDivision((e.target as HTMLSelectElement).value); setEmployee('') }}><option value="">Semua</option>{divQ.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
          </div>
          <div className="min-w-0 lg:col-span-2">
            <Field label="Karyawan"><Select value={employee} onChange={(e) => setEmployee((e.target as HTMLSelectElement).value)}><option value="">Semua</option>{empOptions.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select></Field>
          </div>
          <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-2">
            <Button onClick={() => setRun((r) => r + 1)}><IconReceipt width={18} height={18} /> Tampilkan</Button>
            {rows.length > 0 && <>
              <Button variant="secondary" onClick={exportCsv}><IconDownload width={16} height={16} /> CSV</Button>
              <Button variant="secondary" onClick={() => window.print()}>Cetak PDF</Button>
            </>}
          </div>
        </div>
      </Card>

      {run === 0 ? (
        <p className="text-sm text-text-muted">Pilih filter lalu klik Tampilkan.</p>
      ) : q.isLoading ? (
        <Skeleton className="h-40" />
      ) : rows.length > 0 ? (
        <div className="print-area overflow-x-auto rounded-lg border border-border">
          <div className="print-only mb-3">
            <h2 className="text-lg font-bold">Riwayat Absensi · {company?.displayName ?? ''}</h2>
            <p className="text-sm">Periode {formatDate(from + 'T00:00:00')} – {formatDate(to + 'T00:00:00')}</p>
          </div>
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-surface text-left text-text-muted">
              <tr><th className="p-2">Nama</th><th className="p-2">Cabang</th><th className="p-2">Tanggal</th><th className="p-2">Masuk</th><th className="p-2">Keluar</th><th className="p-2">Status</th><th className="p-2 text-right">Telat</th><th className="p-2 text-right">Trust</th><th className="p-2 no-print"></th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="cursor-pointer border-t border-border hover:bg-surface/60" onClick={() => setOpenId(r.id)}>
                  <td className="p-2 font-medium text-text">{r.name}</td>
                  <td className="p-2 text-text-muted">{r.branchName}</td>
                  <td className="p-2 text-text-muted">{r.workDate}</td>
                  <td className="p-2">{r.clockInAt ? formatTime(r.clockInAt) : '—'}</td>
                  <td className="p-2">{r.clockOutAt ? formatTime(r.clockOutAt) : '—'} {r.leftEarly && <Badge tone="warning">cepat</Badge>}</td>
                  <td className="p-2">{statusLabel[r.status] ?? r.status}</td>
                  <td className="p-2 text-right tabular-nums">{r.lateMinutes || '—'}</td>
                  <td className="p-2 text-right tabular-nums">{r.trustScore}</td>
                  <td className="p-2 text-right text-xs text-accent no-print">Foto →</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-text-muted">Tidak ada data pada filter ini.</p>
      )}

      <AttendanceDetailSheet recordId={openId} onClose={() => setOpenId(null)} />
    </>
  )
}
