import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { useActor } from '@/auth/useActor'
import { can } from '@/lib/domain/rbac'
import { Button, BottomSheet, Field, Input, Select, Spinner, Badge } from '@/components/ui'
import { AttendanceBadge, TrustMeter } from '@/components/StatusBadge'
import { IconAlert, IconCheckCircle, IconClock } from '@/components/ui/icons'
import { formatTime } from '@/lib/format'

/** Detail + correction for one attendance record (PRD §6.9, §7.4.2 anomaly review). */
export function AttendanceDetailSheet({ recordId, onClose }: { recordId: string | null; onClose: () => void }) {
  const qc = useQueryClient()
  const { actor } = useActor()
  const canCorrect = actor ? can(actor, 'attendance.correct') : false

  const q = useQuery({ queryKey: ['attendance', recordId], enabled: !!recordId, queryFn: () => api.attendanceDetail(recordId!) })

  const [status, setStatus] = useState<'on_time' | 'late' | 'absent' | ''>('')
  const [lateMinutes, setLate] = useState<string>('')
  const [resolveFlag, setResolve] = useState(false)
  const [reason, setReason] = useState('')

  const correct = useMutation({
    mutationFn: () => api.correctAttendance(recordId!, {
      status: status || undefined,
      lateMinutes: lateMinutes === '' ? undefined : Number(lateMinutes),
      resolveFlag,
      reason,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['attendance', recordId] })
      onClose()
    },
  })

  const d = q.data
  const photo = d?.events.find((e) => e.photoData)?.photoData

  return (
    <BottomSheet open={!!recordId} onClose={onClose} title="Detail Absensi">
      {q.isLoading || !d ? (
        <div className="flex justify-center py-8"><Spinner className="h-6 w-6 text-primary" /></div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-text">{d.name}</p>
              <p className="text-xs text-text-muted">{d.branchName} · {d.workDate}</p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <AttendanceBadge status={d.status} trustScore={d.trustScore} />
              {d.leftEarly && <Badge tone="warning" icon={<IconClock width={12} height={12} />}>Pulang cepat</Badge>}
            </div>
          </div>

          {photo ? (
            <img src={photo} alt="Foto absen" className="w-full rounded-lg" />
          ) : (
            <div className="rounded-lg bg-surface p-4 text-center text-sm text-text-muted">Tanpa foto</div>
          )}

          <div className="flex items-center gap-2 text-sm text-text-muted">Skor kepercayaan: <TrustMeter score={d.trustScore} /></div>

          <div className="grid grid-cols-2 gap-2 text-sm">
            {d.clockInAt && <Info label="Masuk" value={formatTime(d.clockInAt)} />}
            {d.clockOutAt && <Info label="Keluar" value={formatTime(d.clockOutAt)} />}
            {d.lateMinutes > 0 && <Info label="Telat" value={`${d.lateMinutes} mnt`} />}
            {d.events[0]?.geofenceResult && (
              <Info label="Geofence" value={d.events[0].geofenceResult === 'inside' ? 'Di dalam' : d.events[0].geofenceResult === 'near' ? 'Di tepi' : 'Di luar'} />
            )}
            {d.events[0]?.gpsAccuracy != null && <Info label="Akurasi GPS" value={`${Math.round(d.events[0].gpsAccuracy)} m`} />}
            {d.events.some((e) => e.submittedOffline) && <Info label="Pengiriman" value="Offline (late-submitted)" />}
          </div>

          {d.reasons.length > 0 && (
            <div className="rounded-md bg-warning/10 p-3 text-sm text-warning">
              <p className="mb-1 flex items-center gap-1 font-medium"><IconAlert width={14} height={14} /> Alasan ditandai</p>
              <ul className="list-inside list-disc text-xs">{d.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </div>
          )}

          {canCorrect ? (
            <form className="mt-1 flex flex-col gap-2 border-t border-border pt-3" onSubmit={(e) => { e.preventDefault(); correct.mutate() }}>
              <p className="text-sm font-semibold text-text">Koreksi (tercatat di audit)</p>
              <div className="flex gap-2">
                <Field label="Status">
                  <Select value={status} onChange={(e) => setStatus((e.target as HTMLSelectElement).value as any)}>
                    <option value="">(tidak diubah)</option>
                    <option value="on_time">Tepat waktu</option>
                    <option value="late">Terlambat</option>
                    <option value="absent">Tidak hadir</option>
                  </Select>
                </Field>
                <Field label="Telat (mnt)"><Input type="number" min={0} value={lateMinutes} onChange={(e) => setLate(e.target.value)} placeholder="—" /></Field>
              </div>
              <label className="flex items-center gap-2 text-sm text-text"><input type="checkbox" checked={resolveFlag} onChange={(e) => setResolve(e.target.checked)} /> Tandai sudah ditinjau (hapus flag)</label>
              <Field label="Alasan"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. sinyal lemah, sudah dikonfirmasi" required /></Field>
              <Button type="submit" fullWidth loading={correct.isPending} disabled={!reason}><IconCheckCircle width={16} height={16} /> Simpan koreksi</Button>
            </form>
          ) : (
            <p className="border-t border-border pt-3 text-xs text-text-muted">Hanya admin/HR yang dapat mengoreksi.</p>
          )}
        </div>
      )}
    </BottomSheet>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-surface px-3 py-2">
      <p className="text-xs text-text-muted">{label}</p>
      <p className="font-medium text-text">{value}</p>
    </div>
  )
}
