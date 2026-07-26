import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { useActor } from '@/auth/useActor'
import { Button, Card, Field, Input, Skeleton } from '@/components/ui'
import { IconReceipt } from '@/components/ui/icons'
import { t } from '@/i18n'
import { formatIDR, todayISODate } from '@/lib/format'
import type { PayrollRecapRow } from '@/lib/domain/payroll'

function firstOfMonth(iso: string) { return iso.slice(0, 8) + '01' }

export function PayrollPage() {
  const { company, scopeBranchIds } = useActor()
  const companyId = company?.id
  const today = todayISODate()
  const [start, setStart] = useState(firstOfMonth(today))
  const [end, setEnd] = useState(today)
  const [run, setRun] = useState(0)

  const q = useQuery({
    queryKey: ['payroll', companyId, start, end, run, scopeBranchIds.join(',')],
    enabled: !!companyId && run > 0,
    queryFn: () => api.generatePayroll(companyId!, start, end, scopeBranchIds),
  })

  const exportCsv = (rows: PayrollRecapRow[]) => {
    const header = ['Karyawan', 'Hadir', 'Telat(menit)', 'Potongan', 'UangMakan', 'JamLembur', 'NilaiLembur']
    const lines = rows.map((r) => [r.name, r.presentDays, r.lateMinutesTotal, r.lateDeduction, r.mealAllowance, r.overtimeHoursTotal, r.overtimePayTotal].join(','))
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `rekap-${start}-${end}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-1 text-xl font-bold text-text">{t.payroll.title}</h1>
      <p className="mb-4 text-sm text-text-muted">{t.payroll.note}</p>

      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Mulai"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Selesai"><Input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></Field>
          <Button onClick={() => setRun((r) => r + 1)}><IconReceipt width={18} height={18} /> {t.payroll.generate}</Button>
          {q.data && q.data.length > 0 && <Button variant="secondary" onClick={() => exportCsv(q.data)}>{t.payroll.export} CSV</Button>}
          {q.data && q.data.length > 0 && <Button variant="secondary" onClick={() => window.print()}>Cetak / PDF</Button>}
        </div>
      </Card>

      {run === 0 ? (
        <p className="text-sm text-text-muted">Pilih periode lalu buat rekap.</p>
      ) : q.isLoading ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="print-area overflow-x-auto rounded-lg border border-border">
          <div className="print-only mb-3">
            <h2 className="text-lg font-bold">Rekap Payroll · {company?.displayName ?? ''}</h2>
            <p className="text-sm">Periode {start} s/d {end} · sesuai PP 35/2021 · rekap siap-payroll (bukan transfer gaji)</p>
          </div>
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-surface text-left text-text-muted">
              <tr>
                <th className="p-3">{t.payroll.cols.name}</th>
                <th className="p-3 text-right">{t.payroll.cols.present}</th>
                <th className="p-3 text-right">{t.payroll.cols.late}</th>
                <th className="p-3 text-right">{t.payroll.cols.deduction}</th>
                <th className="p-3 text-right">{t.payroll.cols.meal}</th>
                <th className="p-3 text-right">{t.payroll.cols.otHours}</th>
                <th className="p-3 text-right">{t.payroll.cols.otPay}</th>
              </tr>
            </thead>
            <tbody>
              {q.data?.map((r) => (
                <tr key={r.employeeId} className="border-t border-border hover:bg-surface/60">
                  <td className="p-3 font-medium text-text">{r.name}</td>
                  <td className="p-3 text-right tabular-nums">{r.presentDays}</td>
                  <td className="p-3 text-right tabular-nums">{r.lateMinutesTotal}</td>
                  <td className="p-3 text-right tabular-nums text-danger">{r.lateDeduction ? `−${formatIDR(r.lateDeduction)}` : '—'}</td>
                  <td className="p-3 text-right tabular-nums">{r.mealAllowance ? formatIDR(r.mealAllowance) : '—'}</td>
                  <td className="p-3 text-right tabular-nums">{r.overtimeHoursTotal || '—'}</td>
                  <td className="p-3 text-right font-medium tabular-nums text-success">{r.overtimePayTotal ? formatIDR(r.overtimePayTotal) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
