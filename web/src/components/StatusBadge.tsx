import { Badge } from './ui'
import { IconCheckCircle, IconAlert, IconClock } from './ui/icons'
import type { AttendanceStatus, RequestStatus } from '@/lib/domain/types'

export function AttendanceBadge({ status, trustScore, reviewThreshold = 60 }: { status: AttendanceStatus; trustScore?: number; reviewThreshold?: number }) {
  if (trustScore != null && trustScore < reviewThreshold) {
    return <Badge tone="warning" icon={<IconAlert width={12} height={12} />}>Perlu dicek</Badge>
  }
  if (status === 'on_time') return <Badge tone="success" icon={<IconCheckCircle width={12} height={12} />}>Tepat waktu</Badge>
  if (status === 'late') return <Badge tone="warning" icon={<IconClock width={12} height={12} />}>Terlambat</Badge>
  return <Badge tone="danger" icon={<IconAlert width={12} height={12} />}>Tidak hadir</Badge>
}

export function RequestBadge({ status }: { status: RequestStatus }) {
  if (status === 'approved') return <Badge tone="success" icon={<IconCheckCircle width={12} height={12} />}>Disetujui</Badge>
  if (status === 'rejected') return <Badge tone="danger" icon={<IconAlert width={12} height={12} />}>Ditolak</Badge>
  return <Badge tone="warning" icon={<IconClock width={12} height={12} />}>Menunggu</Badge>
}

/** Skor kepercayaan dengan kata, bukan angka saja. */
export function TrustMeter({ score }: { score: number }) {
  const nada = score >= 80 ? 'bg-inti' : score >= 60 ? 'bg-perlu' : 'bg-galat'
  const kata = score >= 80 ? 'Meyakinkan' : score >= 60 ? 'Cukup' : 'Perlu dicek'
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-sumur">
        <span className={`block h-full rounded-full ${nada}`} style={{ width: `${Math.max(4, score)}%` }} />
      </span>
      <span className="text-[13px] font-medium text-tinta-2">{kata} ({score})</span>
    </span>
  )
}
