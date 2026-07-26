import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { Card, Skeleton, EmptyState, Badge } from '@/components/ui'
import { AttendanceBadge } from '@/components/StatusBadge'
import { IconClock } from '@/components/ui/icons'
import { formatDate, formatTime, todayISODate } from '@/lib/format'

function addDays(iso: string, d: number) {
  const [y, m, day] = iso.split('-').map(Number)
  const x = new Date(Date.UTC(y, m - 1, day)); x.setUTCDate(x.getUTCDate() + d)
  return x.toISOString().slice(0, 10)
}

/** Personal attendance history (UC-31) — strictly the signed-in employee's own data. */
export function RiwayatSayaPage() {
  const today = todayISODate()
  const q = useQuery({ queryKey: ['myAttendance'], queryFn: () => api.myAttendance(addDays(today, -60), today) })

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-1 text-xl font-bold text-text">Riwayat Kehadiran</h1>
      <p className="mb-4 text-sm text-text-muted">60 hari terakhir — hanya data kamu.</p>
      {q.isLoading ? (
        <div className="flex flex-col gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : q.data?.length ? (
        <div className="flex flex-col gap-2">
          {q.data.map((r) => (
            <Card key={r.id} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-text">{formatDate(r.workDate + 'T00:00:00')}</p>
                <p className="flex items-center gap-1 text-xs text-text-muted">
                  <IconClock width={12} height={12} /> Masuk {r.clockInAt ? formatTime(r.clockInAt) : '—'} · {r.clockOutAt ? `Keluar ${formatTime(r.clockOutAt)}` : 'Belum keluar'}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <AttendanceBadge status={r.status} trustScore={r.trustScore} />
                {r.leftEarly && <Badge tone="warning">Pulang cepat</Badge>}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title="Belum ada riwayat kehadiran." />
      )}
    </div>
  )
}
