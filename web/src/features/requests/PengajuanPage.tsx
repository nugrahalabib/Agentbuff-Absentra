import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { useActor } from '@/auth/useActor'
import { Button, Card, Field, Input, Select, BottomSheet, EmptyState, Skeleton } from '@/components/ui'
import { RequestBadge } from '@/components/StatusBadge'
import { t } from '@/i18n'
import { formatDate, todayISODate } from '@/lib/format'
import type { DayType, LeaveType } from '@/lib/domain/types'

export function PengajuanPage() {
  const qc = useQueryClient()
  const { company, employee } = useActor()
  const companyId = company?.id
  const employeeId = employee?.id
  const [sheet, setSheet] = useState<null | 'leave' | 'overtime'>(null)

  const leavesQ = useQuery({ queryKey: ['leaves', companyId, employeeId], enabled: !!companyId && !!employeeId, queryFn: () => api.listLeaves(companyId!, employeeId!) })
  const otQ = useQuery({ queryKey: ['overtimes', companyId, employeeId], enabled: !!companyId && !!employeeId, queryFn: () => api.listOvertimes(companyId!, employeeId!) })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['leaves'] })
    qc.invalidateQueries({ queryKey: ['overtimes'] })
    qc.invalidateQueries({ queryKey: ['approvals'] })
    setSheet(null)
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-4 text-xl font-bold text-text">{t.requests.title}</h1>
      <div className="mb-4 flex gap-2">
        <Button fullWidth variant="secondary" onClick={() => setSheet('leave')}>{t.requests.newLeave}</Button>
        <Button fullWidth variant="secondary" onClick={() => setSheet('overtime')}>{t.requests.newOvertime}</Button>
      </div>

      {(leavesQ.isLoading || otQ.isLoading) ? (
        <Skeleton className="h-20" />
      ) : (leavesQ.data?.length || otQ.data?.length) ? (
        <div className="flex flex-col gap-2">
          {leavesQ.data?.map((l) => (
            <Card key={l.id} className="flex items-center justify-between">
              <div>
                <p className="font-medium text-text">Cuti {l.type}</p>
                <p className="text-xs text-text-muted">{formatDate(l.dateStart)}{l.dateEnd !== l.dateStart && ` – ${formatDate(l.dateEnd)}`}</p>
              </div>
              <RequestBadge status={l.status} />
            </Card>
          ))}
          {otQ.data?.map((o) => (
            <Card key={o.id} className="flex items-center justify-between">
              <div>
                <p className="font-medium text-text">Lembur {o.hours} jam</p>
                <p className="text-xs text-text-muted">{formatDate(o.workDate)}</p>
              </div>
              <RequestBadge status={o.status} />
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title={t.requests.empty} />
      )}

      <BottomSheet open={sheet === 'leave'} onClose={() => setSheet(null)} title={t.requests.newLeave}>
        <LeaveForm companyId={companyId!} employeeId={employeeId!} onDone={invalidate} />
      </BottomSheet>
      <BottomSheet open={sheet === 'overtime'} onClose={() => setSheet(null)} title={t.requests.newOvertime}>
        <OvertimeForm companyId={companyId!} employeeId={employeeId!} onDone={invalidate} />
      </BottomSheet>
    </div>
  )
}

function LeaveForm({ companyId, employeeId, onDone }: { companyId: string; employeeId: string; onDone: () => void }) {
  const today = todayISODate()
  const [type, setType] = useState<LeaveType>('tahunan')
  const [dateStart, setStart] = useState(today)
  const [dateEnd, setEnd] = useState(today)
  const [reason, setReason] = useState('')
  const [attachmentName, setAttachment] = useState<string>('')
  const m = useMutation({ mutationFn: () => api.createLeave({ companyId, employeeId, type, dateStart, dateEnd, reason, attachmentName: attachmentName || undefined }), onSuccess: onDone })

  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
      <Field label={t.requests.type}>
        <Select value={type} onChange={(e) => setType((e.target as HTMLSelectElement).value as LeaveType)}>
          <option value="tahunan">Cuti tahunan</option>
          <option value="sakit">Sakit</option>
          <option value="izin">Izin</option>
          <option value="tanpa_bayar">Tanpa bayar</option>
        </Select>
      </Field>
      <div className="flex gap-2">
        <Field label={t.requests.dateStart}><Input type="date" value={dateStart} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label={t.requests.dateEnd}><Input type="date" value={dateEnd} min={dateStart} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
      <Field label={t.requests.reason}><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Opsional" /></Field>
      <Field label="Lampiran (opsional)" helper={attachmentName || 'mis. surat dokter'}>
        <input type="file" accept="image/*,.pdf" className="text-sm text-text" onChange={(e) => setAttachment(e.target.files?.[0]?.name ?? '')} />
      </Field>
      <Button type="submit" fullWidth loading={m.isPending}>{t.requests.submit}</Button>
    </form>
  )
}

function OvertimeForm({ companyId, employeeId, onDone }: { companyId: string; employeeId: string; onDone: () => void }) {
  const today = todayISODate()
  const [workDate, setDate] = useState(today)
  const [hours, setHours] = useState(2)
  const [dayType, setDayType] = useState<DayType>('workday')
  const m = useMutation({ mutationFn: () => api.createOvertime({ companyId, employeeId, workDate, hours, dayType }), onSuccess: onDone })

  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
      <Field label="Tanggal"><Input type="date" value={workDate} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label={t.requests.hours}><Input type="number" inputMode="numeric" min={1} max={11} value={hours} onChange={(e) => setHours(Number(e.target.value))} /></Field>
      <Field label={t.requests.dayType} helper="Menentukan pengali lembur (PP 35/2021)">
        <Select value={dayType} onChange={(e) => setDayType((e.target as HTMLSelectElement).value as DayType)}>
          <option value="workday">Hari kerja biasa</option>
          <option value="weekly_rest">Istirahat mingguan</option>
          <option value="public_holiday">Libur resmi</option>
          <option value="shortest_day">Libur di hari kerja terpendek</option>
        </Select>
      </Field>
      <Button type="submit" fullWidth loading={m.isPending}>{t.requests.submit}</Button>
    </form>
  )
}
