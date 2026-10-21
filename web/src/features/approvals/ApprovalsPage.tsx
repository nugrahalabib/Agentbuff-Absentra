/** Persetujuan cuti & lembur. Menolak selalu dikonfirmasi; hasil langsung terlihat. */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { useActor } from '@/auth/useActor'
import { Badge, BottomSheet, Button, EmptyState, KepalaHalaman, Skeleton } from '@/components/ui'
import { Maskot } from '@/components/merek'
import { IconCheck, IconX } from '@/components/ui/icons'
import { toast } from '@/components/Toast'
import { formatDate } from '@/lib/format'
import { pesanGalat } from '@/lib/galat'
import type { RequestStatus } from '@/lib/domain/types'

const JENIS_CUTI: Record<string, string> = { tahunan: 'Cuti tahunan', sakit: 'Sakit', izin: 'Izin', tanpa_bayar: 'Cuti tanpa gaji' }
const JENIS_HARI: Record<string, string> = { workday: 'hari kerja', weekly_rest: 'hari libur mingguan', public_holiday: 'tanggal merah', shortest_day: 'tanggal merah (hari terpendek)' }

type Tolak = { jenis: 'cuti' | 'lembur'; id: string; nama: string }

export default function ApprovalsPage() {
  const qc = useQueryClient()
  const { company } = useActor()
  const [sibuk, setSibuk] = useState<string | null>(null)
  const [tolak, setTolak] = useState<Tolak | null>(null)

  const q = useQuery({ queryKey: ['approvals', company?.id], enabled: !!company?.id, refetchInterval: 30_000, queryFn: () => api.pendingApprovals() })
  const putus = useMutation({
    mutationFn: async ({ jenis, id, status }: { jenis: 'cuti' | 'lembur'; id: string; status: RequestStatus }): Promise<void> => {
      if (jenis === 'cuti') await api.decideLeave(undefined, id, status)
      else await api.decideOvertime(undefined, id, status)
    },
    onMutate: ({ id }) => setSibuk(id),
    onSuccess: (_d, v) => toast.berhasil(v.status === 'approved' ? 'Disetujui.' : 'Ditolak.'),
    onError: (e) => toast.galat(pesanGalat(e)),
    onSettled: () => {
      setSibuk(null)
      setTolak(null)
      qc.invalidateQueries({ queryKey: ['approvals'] })
      qc.invalidateQueries({ queryKey: ['leaves'] })
      qc.invalidateQueries({ queryKey: ['overtimes'] })
    },
  })

  const total = (q.data?.leaves.length ?? 0) + (q.data?.overtimes.length ?? 0)

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-end justify-between gap-3">
        <KepalaHalaman judul="Persetujuan" keterangan={total ? `${total} permintaan menunggu keputusanmu.` : 'Cuti dan lembur dari timmu muncul di sini.'} />
        <Maskot pose="cuti" ukuran="kecil" className="-mb-1 shrink-0" />
      </div>

      {q.isLoading ? (
        <Skeleton className="h-28" />
      ) : q.isError ? (
        <EmptyState title="Belum bisa dimuat" keterangan={pesanGalat(q.error)} />
      ) : total === 0 ? (
        <EmptyState pose="selfie" title="Semua sudah beres" keterangan="Tidak ada cuti atau lembur yang menunggu keputusan." />
      ) : (
        <div className="flex flex-col gap-3">
          {q.data?.leaves.map((l) => (
            <Kartu
              key={l.id}
              nama={l.name}
              jenis={<Badge tone="accent">{JENIS_CUTI[l.type] ?? l.type}</Badge>}
              ket={`${formatDate(l.dateStart)}${l.dateEnd !== l.dateStart ? ` sampai ${formatDate(l.dateEnd)}` : ''}`}
              alasan={l.reason}
              sibuk={sibuk === l.id}
              onSetuju={() => putus.mutate({ jenis: 'cuti', id: l.id, status: 'approved' })}
              onTolak={() => setTolak({ jenis: 'cuti', id: l.id, nama: l.name })}
            />
          ))}
          {q.data?.overtimes.map((o) => (
            <Kartu
              key={o.id}
              nama={o.name}
              jenis={<Badge tone="warning">Lembur {o.hours} jam</Badge>}
              ket={`${formatDate(o.workDate)} · ${JENIS_HARI[o.dayType] ?? o.dayType}`}
              alasan={o.isDraft ? 'Tercatat otomatis karena absen keluar lewat dari jam shift. Setujui kalau memang lembur.' : undefined}
              otomatis={o.isDraft}
              sibuk={sibuk === o.id}
              onSetuju={() => putus.mutate({ jenis: 'lembur', id: o.id, status: 'approved' })}
              onTolak={() => setTolak({ jenis: 'lembur', id: o.id, nama: o.name })}
            />
          ))}
        </div>
      )}

      <BottomSheet open={!!tolak} onClose={() => setTolak(null)} title="Tolak permintaan ini?">
        <p className="text-[15px] text-tinta-2">{tolak?.jenis === 'cuti' ? 'Cuti' : 'Lembur'} dari <span className="font-semibold text-tinta">{tolak?.nama}</span> akan ditolak. Kabari dia alasannya ya.</p>
        <div className="mt-5 flex gap-2">
          <Button variant="secondary" fullWidth onClick={() => setTolak(null)}>Batal</Button>
          <Button variant="danger" fullWidth loading={putus.isPending} onClick={() => tolak && putus.mutate({ jenis: tolak.jenis, id: tolak.id, status: 'rejected' })}>Ya, tolak</Button>
        </div>
      </BottomSheet>
    </div>
  )
}

function Kartu({
  nama, jenis, ket, alasan, sibuk, onSetuju, onTolak, otomatis,
}: {
  nama: string; jenis: React.ReactNode; ket: string; alasan?: string; sibuk: boolean; onSetuju: () => void; onTolak: () => void; otomatis?: boolean
}) {
  return (
    <article className="kaca-panel rounded-[24px] p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[17px] font-semibold text-tinta">{nama}</p>
          <p className="mt-0.5 text-[14px] text-tinta-2">{ket}</p>
          {alasan && <p className="mt-2 rounded-[14px] bg-sumur px-3 py-2 text-[14px] text-tinta-2">{otomatis ? alasan : <>&ldquo;{alasan}&rdquo;</>}</p>}
        </div>
        {jenis}
      </div>
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" fullWidth onClick={onTolak} disabled={sibuk}><IconX width={18} height={18} /> Tolak</Button>
        <Button fullWidth onClick={onSetuju} loading={sibuk}><IconCheck width={18} height={18} /> Setujui</Button>
      </div>
    </article>
  )
}
