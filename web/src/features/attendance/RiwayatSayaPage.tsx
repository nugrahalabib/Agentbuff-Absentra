/** Riwayat kehadiran pribadi (hanya data milik sendiri), 60 hari terakhir. */
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { Badge, Button, EmptyState, KepalaHalaman, Skeleton } from '@/components/ui'
import { AttendanceBadge } from '@/components/StatusBadge'
import { Maskot } from '@/components/merek'
import { IconRefresh } from '@/components/ui/icons'
import { formatDateShort, formatDayName, formatTime, tambahHari, todayISODate } from '@/lib/format'
import { pesanGalat } from '@/lib/galat'

export default function RiwayatSayaPage() {
  const hariIni = todayISODate()
  const q = useQuery({ queryKey: ['myAttendance', 'riwayat', hariIni], queryFn: () => api.myAttendance(tambahHari(hariIni, -60), hariIni) })
  const data = q.data ?? []
  const hadir = data.filter((r) => r.status !== 'absent').length
  const telat = data.filter((r) => r.status === 'late').length

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-end justify-between gap-3">
        <KepalaHalaman judul="Riwayat absen" keterangan="60 hari terakhir. Hanya kamu yang bisa melihat ini." />
        <Maskot pose="pulang" ukuran="kecil" className="-mb-1 shrink-0" />
      </div>

      {data.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-2.5">
          <div className="kaca-panel rounded-[22px] px-4 py-3">
            <p className="text-[13px] text-tinta-3">Hadir</p>
            <p className="text-[26px] font-bold tabular-nums tracking-[-0.02em] text-tinta">{hadir} <span className="text-[14px] font-medium text-tinta-3">hari</span></p>
          </div>
          <div className="kaca-panel rounded-[22px] px-4 py-3">
            <p className="text-[13px] text-tinta-3">Terlambat</p>
            <p className="text-[26px] font-bold tabular-nums tracking-[-0.02em] text-tinta">{telat} <span className="text-[14px] font-medium text-tinta-3">kali</span></p>
          </div>
        </div>
      )}

      {q.isLoading ? (
        <div className="flex flex-col gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[72px]" />)}</div>
      ) : q.isError ? (
        <EmptyState title="Riwayat belum bisa dimuat" keterangan={pesanGalat(q.error)} action={<Button variant="secondary" onClick={() => q.refetch()}><IconRefresh width={18} height={18} /> Coba lagi</Button>} />
      ) : data.length === 0 ? (
        <EmptyState pose="selfie" title="Belum ada riwayat" keterangan="Begitu kamu absen, catatannya muncul di sini." />
      ) : (
        <div className="kaca-panel divide-y divide-garis overflow-hidden rounded-[24px]">
          {data.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3.5">
              <div className="w-14 shrink-0 text-center">
                <p className="text-[12px] font-medium capitalize text-tinta-3">{formatDayName(r.workDate).slice(0, 3)}</p>
                <p className="text-[15px] font-bold text-tinta">{formatDateShort(r.workDate)}</p>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium tabular-nums text-tinta">
                  {r.clockInAt ? formatTime(r.clockInAt) : '-'} <span className="text-tinta-3">sampai</span> {r.clockOutAt ? formatTime(r.clockOutAt) : '...'}
                </p>
                {!r.clockOutAt && r.workDate !== hariIni && <p className="text-[13px] text-perlu">Lupa absen keluar</p>}
              </div>
              <div className="flex flex-col items-end gap-1">
                <AttendanceBadge status={r.status} trustScore={r.trustScore} />
                {r.leftEarly && <Badge tone="warning">Pulang cepat</Badge>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
