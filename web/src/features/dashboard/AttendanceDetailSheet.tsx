/** Detail satu absen + koreksi oleh admin (tercatat di jejak audit). */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type AttendanceDetail } from '@/lib/api/client'
import { useActor } from '@/auth/useActor'
import { can } from '@/lib/domain/rbac'
import { Badge, BottomSheet, Button, Field, Input, PesanGalat, Select, Spinner, Centang } from '@/components/ui'
import { AttendanceBadge, TrustMeter } from '@/components/StatusBadge'
import { IconAlert, IconCamera, IconExternal } from '@/components/ui/icons'
import { toast } from '@/components/Toast'
import { formatDate, formatTime } from '@/lib/format'
import { pesanGalat } from '@/lib/galat'

export function AttendanceDetailSheet({ recordId, onClose }: { recordId: string | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ['attendance', recordId], enabled: !!recordId, queryFn: () => api.attendanceDetail(recordId!) })
  return (
    <BottomSheet open={!!recordId} onClose={onClose} title="Detail absen">
      {q.isLoading || !q.data ? (
        q.isError ? <PesanGalat>{pesanGalat(q.error)}</PesanGalat> : <div className="flex justify-center py-10 text-tinta-3"><Spinner className="h-6 w-6" /></div>
      ) : (
        // key = id: isian koreksi selalu kosong saat membuka absen lain.
        <IsiDetail key={q.data.id} d={q.data} onClose={onClose} />
      )}
    </BottomSheet>
  )
}

function IsiDetail({ d, onClose }: { d: AttendanceDetail; onClose: () => void }) {
  const qc = useQueryClient()
  const { actor } = useActor()
  const bolehKoreksi = actor ? can(actor, 'attendance.correct', { branchId: d.branchId }) : false
  const [status, setStatus] = useState<'on_time' | 'late' | 'absent' | ''>('')
  const [telat, setTelat] = useState('')
  const [sudahDicek, setSudahDicek] = useState(false)
  const [alasan, setAlasan] = useState('')
  const foto = d.events.find((e) => e.photoData)?.photoData
  const masuk = d.events.find((e) => e.type === 'clock_in')
  const koreksi = useMutation({
    mutationFn: () =>
      api.correctAttendance(d.id, {
        status: status || undefined,
        lateMinutes: telat === '' ? (status === 'on_time' ? 0 : undefined) : Number(telat),
        resolveFlag: sudahDicek,
        reason: alasan,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['attendance', d.id] })
      qc.invalidateQueries({ queryKey: ['attlist'] })
      toast.berhasil('Koreksi tersimpan.')
      onClose()
    },
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[18px] font-semibold text-tinta">{d.name}</p>
          <p className="text-[14px] text-tinta-3">{d.branchName} · {formatDate(d.workDate)}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <AttendanceBadge status={d.status} trustScore={d.trustScore} />
          {d.leftEarly && <Badge tone="warning">Pulang cepat</Badge>}
        </div>
      </div>

      {foto ? (
        <img src={foto} alt={`Foto absen ${d.name}`} className="max-h-[360px] w-full rounded-[22px] object-cover" />
      ) : (
        <div className="flex flex-col items-center gap-1 rounded-[22px] bg-sumur py-8 text-[14px] text-tinta-3"><IconCamera width={22} height={22} /> Tanpa foto</div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Info label="Masuk" nilai={d.clockInAt ? formatTime(d.clockInAt) : '-'} />
        <Info label="Keluar" nilai={d.clockOutAt ? formatTime(d.clockOutAt) : '-'} />
        {d.lateMinutes > 0 && <Info label="Terlambat" nilai={`${d.lateMinutes} menit`} />}
        {masuk?.geofenceResult && <Info label="Posisi" nilai={masuk.geofenceResult === 'inside' ? 'Di lokasi kerja' : masuk.geofenceResult === 'near' ? 'Di tepi lokasi' : 'Di luar lokasi'} />}
        {masuk?.gpsAccuracy != null && <Info label="Akurasi GPS" nilai={`${Math.round(masuk.gpsAccuracy)} m`} />}
        {d.events.some((e) => e.submittedOffline) && <Info label="Pengiriman" nilai="Tertunda (offline)" />}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <TrustMeter score={d.trustScore} />
        {masuk?.lat != null && masuk.long != null && (
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${masuk.lat},${masuk.long}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[14px] font-semibold text-aksen-teks hover:underline"
          >
            Lihat titik di peta <IconExternal width={14} height={14} />
          </a>
        )}
      </div>

      {d.reasons.length > 0 && (
        <div className="rounded-[20px] bg-perlu-lembut px-4 py-3 text-[14px] text-perlu">
          <p className="flex items-center gap-1.5 font-semibold"><IconAlert width={16} height={16} /> Kenapa ditandai</p>
          <ul className="mt-1 list-disc pl-5">{d.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      )}

      {bolehKoreksi ? (
        <form className="flex flex-col gap-3 border-t border-garis pt-4" onSubmit={(e) => { e.preventDefault(); koreksi.mutate() }}>
          <p className="text-[16px] font-semibold text-tinta">Koreksi absen</p>
          <div className="flex gap-3">
            <Field label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                <option value="">Tidak diubah</option>
                <option value="on_time">Tepat waktu</option>
                <option value="late">Terlambat</option>
                <option value="absent">Tidak hadir</option>
              </Select>
            </Field>
            <Field label="Menit telat"><Input type="number" min={0} max={1440} value={telat} onChange={(e) => setTelat(e.target.value)} placeholder="-" /></Field>
          </div>
          <Centang checked={sudahDicek} onChange={setSudahDicek}>Sudah saya cek, hapus tanda curiga</Centang>
          <Field label="Alasan koreksi" helper="Tercatat di jejak perubahan.">
            <Input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="mis. sinyal lemah, sudah dikonfirmasi" maxLength={200} required />
          </Field>
          <PesanGalat>{koreksi.isError ? pesanGalat(koreksi.error) : null}</PesanGalat>
          <Button type="submit" fullWidth loading={koreksi.isPending} disabled={!alasan.trim()}>Simpan koreksi</Button>
        </form>
      ) : (
        <p className="border-t border-garis pt-3 text-[13px] text-tinta-3">Hanya admin atau HR yang bisa mengoreksi absen.</p>
      )}
    </div>
  )
}

function Info({ label, nilai }: { label: string; nilai: string }) {
  return (
    <div className="rounded-[16px] bg-sumur px-3.5 py-2.5">
      <p className="text-[13px] text-tinta-3">{label}</p>
      <p className="text-[15px] font-semibold text-tinta">{nilai}</p>
    </div>
  )
}
