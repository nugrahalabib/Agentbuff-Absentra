import { Badge } from './ui'
import { IconCheckCircle, IconAlert, IconClock } from './ui/icons'
import { t } from '@/i18n'
import type { AttendanceStatus, RequestStatus } from '@/lib/domain/types'

export function AttendanceBadge({ status, trustScore, reviewThreshold = 60 }: { status: AttendanceStatus; trustScore?: number; reviewThreshold?: number }) {
  if (trustScore != null && trustScore < reviewThreshold) {
    return <Badge tone="danger" icon={<IconAlert width={12} height={12} />}>{t.status.flagged}</Badge>
  }
  if (status === 'on_time') return <Badge tone="success" icon={<IconCheckCircle width={12} height={12} />}>{t.status.on_time}</Badge>
  if (status === 'late') return <Badge tone="warning" icon={<IconClock width={12} height={12} />}>{t.status.late}</Badge>
  return <Badge tone="danger" icon={<IconAlert width={12} height={12} />}>{t.status.absent}</Badge>
}

export function RequestBadge({ status }: { status: RequestStatus }) {
  if (status === 'approved') return <Badge tone="success" icon={<IconCheckCircle width={12} height={12} />}>{t.status.approved}</Badge>
  if (status === 'rejected') return <Badge tone="danger" icon={<IconAlert width={12} height={12} />}>{t.status.rejected}</Badge>
  return <Badge tone="warning" icon={<IconClock width={12} height={12} />}>{t.status.pending}</Badge>
}

export function TrustMeter({ score }: { score: number }) {
  const tone = score >= 80 ? 'bg-success' : score >= 60 ? 'bg-warning' : 'bg-danger'
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-border">
        <div className={`h-full ${tone}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-medium text-text-muted">{score}</span>
    </div>
  )
}
