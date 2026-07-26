import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { useActor } from '@/auth/useActor'
import { Card, Skeleton, EmptyState, Badge } from '@/components/ui'
import { IconCalendar, IconClock } from '@/components/ui/icons'
import { t } from '@/i18n'
import { formatDayName, formatDateShort, todayISODate } from '@/lib/format'

function addDays(iso: string, d: number) {
  const [y, m, day] = iso.split('-').map(Number)
  const x = new Date(Date.UTC(y, m - 1, day))
  x.setUTCDate(x.getUTCDate() + d)
  return x.toISOString().slice(0, 10)
}

export function JadwalPage() {
  const { company, employee } = useActor()
  const today = todayISODate()
  const from = addDays(today, -2)
  const to = addDays(today, 13)

  const q = useQuery({
    queryKey: ['schedule', company?.id, employee?.id, from, to],
    enabled: !!company?.id && !!employee?.id,
    queryFn: () => api.assignmentsForEmployee(company!.id, employee!.id, from, to),
  })

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-4 text-xl font-bold text-text">{t.nav.jadwal}</h1>
      {q.isLoading ? (
        <div className="flex flex-col gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : q.data?.length ? (
        <div className="flex flex-col gap-2">
          {q.data.map(({ assignment, template }) => {
            const isToday = assignment.workDate === today
            return (
              <Card key={assignment.id} className={`flex items-center gap-3 ${isToday ? 'border-primary' : ''}`}>
                <span className="flex h-11 w-11 flex-col items-center justify-center rounded-md bg-surface text-text">
                  <span className="text-xs text-text-muted">{formatDayName(assignment.workDate).slice(0, 3)}</span>
                  <span className="text-sm font-bold">{formatDateShort(assignment.workDate).split(' ')[0]}</span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 font-medium text-text"><IconCalendar width={14} height={14} /> {template.name}</p>
                  <p className="flex items-center gap-1 text-sm text-text-muted"><IconClock width={14} height={14} /> {template.startTime}–{template.endTime}{template.crossesMidnight && ' (+1)'}</p>
                </div>
                {isToday && <Badge tone="accent">Hari ini</Badge>}
                {template.crossesMidnight && <Badge tone="neutral">Malam</Badge>}
              </Card>
            )
          })}
        </div>
      ) : (
        <EmptyState title="Belum ada jadwal shift." />
      )}
    </div>
  )
}
