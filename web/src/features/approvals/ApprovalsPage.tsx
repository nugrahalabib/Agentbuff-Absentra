import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { useActor } from '@/auth/useActor'
import { Button, Card, EmptyState, Skeleton, Badge } from '@/components/ui'
import { IconCheck, IconAlert } from '@/components/ui/icons'
import { t } from '@/i18n'
import { formatDate } from '@/lib/format'
import type { RequestStatus } from '@/lib/domain/types'

const dayTypeLabel: Record<string, string> = {
  workday: 'Hari kerja', weekly_rest: 'Istirahat mingguan', public_holiday: 'Libur resmi', shortest_day: 'Hari terpendek',
}

export function ApprovalsPage() {
  const qc = useQueryClient()
  const { company, scopeBranchIds, user } = useActor()
  const companyId = company?.id
  const [busyId, setBusyId] = useState<string | null>(null)

  const q = useQuery({
    queryKey: ['approvals', companyId, scopeBranchIds.join(',')],
    enabled: !!companyId,
    queryFn: () => api.pendingApprovals(companyId!, scopeBranchIds),
  })

  const leaveM = useMutation({
    mutationFn: ({ id, status }: { id: string; status: RequestStatus }) => api.decideLeave(companyId!, id, status, user!.id),
    onMutate: ({ id }) => setBusyId(id),
    onSettled: () => { setBusyId(null); qc.invalidateQueries({ queryKey: ['approvals'] }); qc.invalidateQueries({ queryKey: ['leaves'] }) },
  })
  const otM = useMutation({
    mutationFn: ({ id, status }: { id: string; status: RequestStatus }) => api.decideOvertime(companyId!, id, status, user!.id),
    onMutate: ({ id }) => setBusyId(id),
    onSettled: () => { setBusyId(null); qc.invalidateQueries({ queryKey: ['approvals'] }); qc.invalidateQueries({ queryKey: ['overtimes'] }) },
  })

  const total = (q.data?.leaves.length ?? 0) + (q.data?.overtimes.length ?? 0)

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-xl font-bold text-text">{t.approvals.title}</h1>
      {q.isLoading ? (
        <Skeleton className="h-24" />
      ) : total === 0 ? (
        <EmptyState title={t.approvals.empty} />
      ) : (
        <div className="flex flex-col gap-2">
          {q.data?.leaves.map((l) => (
            <Card key={l.id}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-text">{l.name} · Cuti {l.type}</p>
                  <p className="text-xs text-text-muted">{formatDate(l.dateStart)}{l.dateEnd !== l.dateStart && ` – ${formatDate(l.dateEnd)}`}{l.reason && ` · ${l.reason}`}</p>
                </div>
                <Badge tone="accent">Cuti</Badge>
              </div>
              <Actions
                pending={busyId === l.id}
                onApprove={() => leaveM.mutate({ id: l.id, status: 'approved' })}
                onReject={() => {
                  if (confirm(`Tolak cuti ${l.name}?`)) leaveM.mutate({ id: l.id, status: 'rejected' })
                }}
              />
            </Card>
          ))}
          {q.data?.overtimes.map((o) => (
            <Card key={o.id}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-text">{o.name} · Lembur {o.hours} jam</p>
                  <p className="text-xs text-text-muted">{formatDate(o.workDate)} · {dayTypeLabel[o.dayType]}</p>
                </div>
                <Badge tone="warning">Lembur</Badge>
              </div>
              <Actions
                pending={busyId === o.id}
                onApprove={() => otM.mutate({ id: o.id, status: 'approved' })}
                onReject={() => {
                  if (confirm(`Tolak lembur ${o.name}?`)) otM.mutate({ id: o.id, status: 'rejected' })
                }}
              />
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function Actions({ onApprove, onReject, pending }: { onApprove: () => void; onReject: () => void; pending: boolean }) {
  return (
    <div className="mt-3 flex gap-2">
      <Button size="sm" variant="danger" onClick={onReject} disabled={pending}><IconAlert width={16} height={16} /> {t.approvals.reject}</Button>
      <Button size="sm" onClick={onApprove} loading={pending}><IconCheck width={16} height={16} /> {t.approvals.approve}</Button>
    </div>
  )
}
