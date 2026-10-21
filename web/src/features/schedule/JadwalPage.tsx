/** Jadwal shift karyawan: 2 hari ke belakang sampai 2 minggu ke depan, dikelompokkan per minggu. */
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { useActor } from '@/auth/useActor'
import { Badge, Button, EmptyState, KepalaHalaman, Skeleton, cx } from '@/components/ui'
import { Maskot } from '@/components/merek'
import { IconClock, IconRefresh } from '@/components/ui/icons'
import { formatDateShort, formatDayName, tambahHari, todayISODate } from '@/lib/format'
import { pesanGalat } from '@/lib/galat'

export default function JadwalPage() {
  const { company, employeeId } = useActor()
  const hariIni = todayISODate()
  const dari = tambahHari(hariIni, -2)
  const sampai = tambahHari(hariIni, 13)

  const q = useQuery({
    queryKey: ['schedule', company?.id, employeeId, dari, sampai],
    enabled: !!company?.id && !!employeeId,
    queryFn: () => api.assignmentsForEmployee(undefined, employeeId ?? undefined, dari, sampai),
  })
  const daftar = (q.data ?? []).slice().sort((a, b) => a.assignment.workDate.localeCompare(b.assignment.workDate))
  const berikut = daftar.find((x) => x.assignment.workDate >= hariIni)

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-end justify-between gap-3">
        <KepalaHalaman judul="Jadwal" keterangan="Shift kamu dua minggu ke depan." />
        <Maskot pose="jadwal" ukuran="kecil" className="-mb-1 shrink-0" />
      </div>

      {q.isLoading ? (
        <div className="flex flex-col gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[76px]" />)}</div>
      ) : q.isError ? (
        <EmptyState title="Jadwal belum bisa dimuat" keterangan={pesanGalat(q.error)} action={<Button variant="secondary" onClick={() => q.refetch()}><IconRefresh width={18} height={18} /> Coba lagi</Button>} />
      ) : daftar.length === 0 ? (
        <EmptyState pose="cuti" title="Belum ada jadwal shift" keterangan="Atasanmu belum menyusun jadwal. Kalau kamu harusnya masuk, kabari atasanmu ya." />
      ) : (
        <div className="flex flex-col gap-2.5">
          {berikut && (
            <p className="mb-1 text-[14px] text-tinta-2">
              Berikutnya: <span className="font-semibold text-tinta">{berikut.assignment.workDate === hariIni ? 'hari ini' : formatDayName(berikut.assignment.workDate)}</span>, {berikut.template.name} jam {berikut.template.startTime.replace(':', '.')}.
            </p>
          )}
          {daftar.map(({ assignment, template }) => {
            const hari = assignment.workDate === hariIni
            const lewat = assignment.workDate < hariIni
            return (
              <div
                key={assignment.id}
                className={cx(
                  'flex items-center gap-4 rounded-[22px] px-4 py-3.5',
                  hari ? 'bg-permukaan shadow-[0_0_0_2px_rgb(var(--grafit)),0_14px_30px_-16px_rgba(24,22,18,0.4)]' : 'kaca-panel',
                  lewat && 'opacity-60',
                )}
              >
                <span className={cx('flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl', hari ? 'bg-grafit text-grafit-teks' : 'bg-sumur text-tinta')}>
                  <span className="text-[12px] font-medium capitalize opacity-80">{formatDayName(assignment.workDate).slice(0, 3)}</span>
                  <span className="text-[19px] font-bold leading-none">{formatDateShort(assignment.workDate).split(' ')[0]}</span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[16px] font-semibold text-tinta">{template.name}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[14px] text-tinta-2">
                    <IconClock width={15} height={15} /> {template.startTime} sampai {template.endTime}
                    {template.crossesMidnight && ' (besok)'}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {hari && <Badge tone="accent">Hari ini</Badge>}
                  {template.crossesMidnight && <Badge>Shift malam</Badge>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
