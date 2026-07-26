import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type BranchWithGeofence } from '@/lib/api/client'
import { Button, Card, Field, Input, BottomSheet, EmptyState, Skeleton } from '@/components/ui'
import { IconMapPin } from '@/components/ui/icons'
import { parseLatLong } from '@/lib/geoLink'

export function BranchesPage() {
  const qc = useQueryClient()
  const [edit, setEdit] = useState<BranchWithGeofence | 'new' | null>(null)
  const q = useQuery({ queryKey: ['branches'], queryFn: () => api.branches() })

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text">Cabang & Geofence</h1>
          <p className="text-sm text-text-muted">Lokasi kerja + radius absen.</p>
        </div>
        <Button onClick={() => setEdit('new')}>Tambah Cabang</Button>
      </div>

      {q.isLoading ? <Skeleton className="h-24" /> : q.data?.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {q.data.map((b) => (
            <Card key={b.id} onClick={() => setEdit(b)}>
              <p className="font-medium text-text">{b.name}</p>
              <p className="flex items-center gap-1 text-xs text-text-muted"><IconMapPin width={12} height={12} /> {b.lat.toFixed(4)}, {b.long.toFixed(4)} · radius {b.geofence?.radiusM ?? '—'} m</p>
              {b.address && <p className="mt-1 text-xs text-text-muted">{b.address}</p>}
            </Card>
          ))}
        </div>
      ) : <EmptyState title="Belum ada cabang." action={<Button onClick={() => setEdit('new')}>Tambah Cabang</Button>} />}

      <BottomSheet open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? 'Tambah Cabang' : 'Edit Cabang'}>
        {edit && <BranchForm initial={edit === 'new' ? null : edit} onDone={() => { qc.invalidateQueries({ queryKey: ['branches'] }); setEdit(null) }} />}
      </BottomSheet>
    </div>
  )
}

function BranchForm({ initial, onDone }: { initial: BranchWithGeofence | null; onDone: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [address, setAddress] = useState(initial?.address ?? '')
  const [lat, setLat] = useState(initial?.lat ?? -6.2)
  const [long, setLong] = useState(initial?.long ?? 106.8166)
  const [radiusM, setRadius] = useState(initial?.geofence?.radiusM ?? 100)

  const m = useMutation({
    mutationFn: () => initial ? api.updateBranch(initial.id, { name, address, lat, long, radiusM }) : api.createBranch({ name, address, lat, long, radiusM }),
    onSuccess: onDone,
  })
  const archive = useMutation({ mutationFn: () => api.archiveBranch(initial!.id), onSuccess: onDone })

  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
      <Field label="Nama cabang"><Input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
      <Field label="Alamat"><Input value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
      <Field label="Link Google Maps" helper="Tempel link/koordinat dari Google Maps — lokasi terisi otomatis">
        <Input placeholder="https://maps.google.com/...  atau  -6.2, 106.8166" onChange={(e) => { const p = parseLatLong(e.target.value); if (p) { setLat(p.lat); setLong(p.long) } }} />
      </Field>
      <div className="flex gap-2">
        <Field label="Latitude"><Input type="number" step="0.0001" value={lat} onChange={(e) => setLat(Number(e.target.value))} /></Field>
        <Field label="Longitude"><Input type="number" step="0.0001" value={long} onChange={(e) => setLong(Number(e.target.value))} /></Field>
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={() => navigator.geolocation?.getCurrentPosition((p) => { setLat(Number(p.coords.latitude.toFixed(6))); setLong(Number(p.coords.longitude.toFixed(6))) })}>
          <IconMapPin width={16} height={16} /> Lokasi saya
        </Button>
        <Button type="button" variant="ghost" onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${lat},${long}`, '_blank')}>Lihat di Maps</Button>
      </div>
      <Field label={`Radius geofence: ${radiusM} m`}>
        <input type="range" min={30} max={500} step={10} value={radiusM} onChange={(e) => setRadius(Number(e.target.value))} className="w-full" />
      </Field>
      <div className="flex gap-2">
        {initial && <Button type="button" variant="danger" onClick={() => archive.mutate()} loading={archive.isPending}>Arsipkan</Button>}
        <Button type="submit" fullWidth loading={m.isPending} disabled={!name}>Simpan</Button>
      </div>
    </form>
  )
}
