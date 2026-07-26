import { formatDate, formatTime, formatIDR } from '@/lib/format'

export interface EmployeeReport {
  company: { id: string; displayName: string; logoUrl: string | null; timezone: string }
  employee: { id: string; name: string; branchName: string; divisionName: string | null }
  period: { from: string; to: string }
  summary: {
    presentDays: number
    lateDays: number
    lateMinutesTotal: number
    absentDays: number
    leaveDays: number
    leaveBreakdown: Record<string, number>
    earlyLeaveDays: number
    overtimeHoursTotal: number
    overtimePayTotal: number
    lateDeduction: number
    mealAllowance: number
  }
  days: Array<{
    date: string
    shiftName: string | null
    shiftStart: string | null
    shiftEnd: string | null
    clockInAt: string | null
    clockOutAt: string | null
    status: string
    lateMinutes: number
    trustScore: number | null
    leftEarly: boolean
    leaveType: string | null
    overtimeHours: number | null
    note: string | null
  }>
}

const LEAVE_LABEL: Record<string, string> = {
  tahunan: 'Cuti tahunan',
  sakit: 'Sakit',
  izin: 'Izin',
  tanpa_bayar: 'Tanpa bayar',
}

/** Print-ready employee periodic report document (PRD §7.4). */
export function EmployeeReportDocument({ report }: { report: EmployeeReport }) {
  const { company, employee, period, summary, days } = report
  const leaveParts = Object.entries(summary.leaveBreakdown)
    .map(([k, v]) => `${LEAVE_LABEL[k] ?? k}: ${v}`)
    .join(' · ')

  return (
    <article className="employee-report print-area rounded-lg border border-border bg-surface-elevated p-5 sm:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Laporan Karyawan</p>
          <h2 className="mt-1 text-xl font-bold text-text sm:text-2xl">{company.displayName}</h2>
          <p className="mt-1 text-sm text-text-muted">
            Periode {formatDate(period.from + 'T00:00:00')} – {formatDate(period.to + 'T00:00:00')}
          </p>
        </div>
        <div className="text-right text-sm">
          <p className="text-lg font-semibold text-text">{employee.name}</p>
          <p className="text-text-muted">{employee.branchName}{employee.divisionName ? ` · ${employee.divisionName}` : ''}</p>
        </div>
      </header>

      <section className="mb-6">
        <h3 className="mb-3 text-sm font-semibold text-text">Ringkasan</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Hadir" value={String(summary.presentDays)} />
          <Stat label="Telat" value={`${summary.lateDays} hari / ${summary.lateMinutesTotal} mnt`} />
          <Stat label="Alpa" value={String(summary.absentDays)} />
          <Stat label="Cuti / Izin" value={String(summary.leaveDays)} />
          <Stat label="Pulang cepat" value={String(summary.earlyLeaveDays)} />
          <Stat label="Lembur" value={`${summary.overtimeHoursTotal} jam`} />
          <Stat label="Nilai lembur" value={formatIDR(summary.overtimePayTotal)} />
          <Stat label="Potongan telat" value={formatIDR(summary.lateDeduction)} />
        </div>
        {leaveParts && <p className="mt-2 text-xs text-text-muted">Rincian cuti/izin: {leaveParts}</p>}
        {summary.mealAllowance > 0 && <p className="mt-1 text-xs text-text-muted">Uang makan: {formatIDR(summary.mealAllowance)}</p>}
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold text-text">Detail harian</h3>
        {days.length === 0 ? (
          <p className="text-sm text-text-muted">Tidak ada aktivitas pada periode ini.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-surface text-left text-text-muted">
                <tr>
                  <th className="p-2 font-medium">Tanggal</th>
                  <th className="p-2 font-medium">Shift</th>
                  <th className="p-2 font-medium">Masuk</th>
                  <th className="p-2 font-medium">Keluar</th>
                  <th className="p-2 font-medium">Status</th>
                  <th className="p-2 font-medium text-right">Telat</th>
                  <th className="p-2 font-medium">Keterangan</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d.date} className="border-t border-border">
                    <td className="p-2 tabular-nums text-text">{d.date}</td>
                    <td className="p-2 text-text-muted">{d.shiftName ?? '—'}</td>
                    <td className="p-2 tabular-nums">{d.clockInAt ? formatTime(d.clockInAt) : '—'}</td>
                    <td className="p-2 tabular-nums">{d.clockOutAt ? formatTime(d.clockOutAt) : '—'}</td>
                    <td className="p-2 font-medium text-text">{d.status}</td>
                    <td className="p-2 text-right tabular-nums">{d.lateMinutes || '—'}</td>
                    <td className="p-2 text-text-muted">{d.note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </article>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-surface px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-text-muted">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-text">{value}</p>
    </div>
  )
}

export function exportEmployeeReportCsv(report: EmployeeReport) {
  const { employee, period, summary, days } = report
  const leaveParts = Object.entries(summary.leaveBreakdown)
    .map(([k, v]) => `${LEAVE_LABEL[k] ?? k}:${v}`)
    .join(';')

  const summaryHeader = [
    'Nama', 'Cabang', 'Divisi', 'Dari', 'Sampai',
    'Hadir', 'HariTelat', 'MenitTelat', 'Alpa', 'HariCutiIzin', 'RincianCuti',
    'PulangCepat', 'JamLembur', 'NilaiLembur', 'PotonganTelat', 'UangMakan',
  ]
  const summaryRow = [
    employee.name, employee.branchName, employee.divisionName ?? '',
    period.from, period.to,
    summary.presentDays, summary.lateDays, summary.lateMinutesTotal, summary.absentDays,
    summary.leaveDays, leaveParts, summary.earlyLeaveDays,
    summary.overtimeHoursTotal, summary.overtimePayTotal, summary.lateDeduction, summary.mealAllowance,
  ]

  const detailHeader = ['Tanggal', 'Shift', 'Masuk', 'Keluar', 'Status', 'Telat(menit)', 'Keterangan']
  const detailRows = days.map((d) => [
    d.date,
    d.shiftName ?? '',
    d.clockInAt ? formatTime(d.clockInAt) : '',
    d.clockOutAt ? formatTime(d.clockOutAt) : '',
    d.status,
    d.lateMinutes,
    d.note ?? '',
  ])

  return { summaryHeader, summaryRow, detailHeader, detailRows }
}
