/** Lokasi kerja (cabang) + radius tempat karyawan boleh absen. */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type BranchWithGeofence } from '@/lib/api/client'
import { BottomSheet, Button, EmptyState, Field, Input, KepalaHalaman, PesanGalat, Skeleton } from '@/components/ui'
import { Maskot } from '@/components/merek'
import { IconExternal, IconMapPin, IconPlus, IconTarget } from '@/components/ui/icons'
import { toast } from '@/components/Toast'
import { parseLatLong } from '@/lib/geoLink'
import { pesanGalat } from '@/lib/galat'

export default function BranchesPage() {
  const qc = useQueryClient()
  const [ubah, setUbah] = useState<BranchWithGeofence | 'baru' | null>(null)
  const q = useQuery({ queryKey: ['branches'], queryFn: () => api.branches() })
  const selesai = (pesan: string) => {
    qc.invalidateQueries({ queryKey: ['branches'] })
    setUbah(null)
    toast.berhasil(pesan)
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-end justify-between gap-3">
        <KepalaHalaman
          judul="Lokasi kerja"
          keterangan="Karyawan hanya dianggap di tempat kalau absen di dalam radius lokasinya."
          aksi={<Button onClick={() => setUbah('baru')}><IconPlus width={18} height={18} /> Tambah lokasi</Button>}
        />
        <Maskot pose="peta" ukuran="kecil" className="-mb-1 hidden shrink-0 sm:block" />
      </div>

      {q.isLoading ? (
        <Skeleton className="h-32" />
      ) : q.isError ? (
        <EmptyState title="Belum bisa dimuat" keterangan={pesanGalat(q.error)} />
      ) : !q.data?.length ? (
        <EmptyState pose="peta" title="Belum ada lokasi kerja" keterangan="Tempel link Google Maps tokomu atau pakai lokasimu sekarang. Hanya butuh semenit." action={<Button onClick={() => setUbah('baru')}><IconPlus width={18} height={18} /> Tambah lokasi</Button>} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {q.data.map((b) => (
            <button key={b.id} type="button" onClick={() => setUbah(b)} className="kaca-panel flex items-start gap-3 rounded-[24px] p-4 text-left transition-transform active:scale-[0.99]">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-aksen-lembut text-aksen-teks"><IconMapPin width={22} height={22} /></span>
              <span className="min-w-0">
                <span className="block text-[16px] font-semibold text-tinta">{b.name}</span>
                {b.address && <span className="mt-0.5 block truncate text-[14px] text-tinta-2">{b.address}</span>}
                <span className="mt-1 block text-[13px] text-tinta-3">Radius {b.geofence?.radiusM ?? '-'} m</span>
              </span>
            </button>
          ))}
        </div>
      )}

      <BottomSheet open={!!ubah} onClose={() => setUbah(null)} title={ubah === 'baru' ? 'Tambah lokasi kerja' : 'Ubah lokasi kerja'}>
        {ubah && <FormLokasi key={ubah === 'baru' ? 'baru' : ubah.id} awal={ubah === 'baru' ? null : ubah} onSelesai={selesai} />}
      </BottomSheet>
    </div>
  )
}

/** Dipakai juga oleh wizard penyiapan. */
export function FormLokasi({ awal, onSelesai, tombol = 'Simpan' }: { awal: BranchWithGeofence | null; onSelesai: (pesan: string) => void; tombol?: string }) {
  const [nama, setNama] = useState(awal?.name ?? '')
  const [alamat, setAlamat] = useState(awal?.address ?? '')
  const [lat, setLat] = useState<number | null>(awal?.lat ?? null)
  const [long, setLong] = useState<number | null>(awal?.long ?? null)
  const [radius, setRadius] = useState(awal?.geofence?.radiusM ?? 100)
  const [link, setLink] = useState('')
  const [galatLink, setGalatLink] = useState<string | null>(null)
  const [mencari, setMencari] = useState(false)
  const [konfirmArsip, setKonfirmArsip] = useState(false)

  const simpan = useMutation({
    mutationFn: () => {
      const data = { name: nama.trim(), address: alamat.trim() || undefined, lat: lat!, long: long!, radiusM: radius }
      return awal ? api.updateBranch(awal.id, data) : api.createBranch(data)
    },
    onSuccess: () => onSelesai(awal ? 'Lokasi kerja tersimpan.' : 'Lokasi kerja ditambahkan.'),
  })
  const arsip = useMutation({ mutationFn: () => api.archiveBranch(awal!.id), onSuccess: () => onSelesai('Lokasi diarsipkan.') })

  const dariLink = (v: string) => {
    setLink(v)
    if (!v.trim()) { setGalatLink(null); return }
    const p = parseLatLong(v)
    if (p) { setLat(p.lat); setLong(p.long); setGalatLink(null) } else setGalatLink('Titiknya belum terbaca. Di Google Maps, tekan lama titik tokomu, lalu salin angka koordinatnya.')
  }
  const lokasiSaya = () => {
    if (!navigator.geolocation) return
    setMencari(true)
    navigator.geolocation.getCurrentPosition(
      (p) => { setLat(Number(p.coords.latitude.toFixed(6))); setLong(Number(p.coords.longitude.toFixed(6))); setMencari(false) },
      () => { setMencari(false); toast.galat('Lokasimu belum terbaca. Izinkan lokasi atau tempel link Google Maps.') },
      { enableHighAccuracy: true, timeout: 12_000 },
    )
  }
  const adaTitik = lat != null && long != null

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (adaTitik) simpan.mutate() }}>
      <Field label="Nama lokasi"><Input value={nama} onChange={(e) => setNama(e.target.value)} placeholder="mis. Toko Pusat" required maxLength={80} /></Field>
      <Field label="Alamat (opsional)"><Input value={alamat} onChange={(e) => setAlamat(e.target.value)} maxLength={200} /></Field>

      <div className="rounded-[20px] bg-sumur p-4">
        <p className="text-[15px] font-semibold text-tinta">Titik lokasi</p>
        <p className="mt-0.5 text-[13px] text-tinta-3">Paling mudah: kalau kamu sedang di toko, ketuk tombol di bawah.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Button variant="secondary" onClick={lokasiSaya} loading={mencari} className="sm:flex-1"><IconTarget width={18} height={18} /> Pakai lokasiku sekarang</Button>
        </div>
        <Field label="Atau tempel link Google Maps" className="mt-3" error={galatLink}>
          <Input value={link} onChange={(e) => dariLink(e.target.value)} placeholder="https://maps.app.goo.gl/... atau -6.2, 106.81" />
        </Field>
        {adaTitik && (
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-tinta-2">
            <span className="font-medium tabular-nums text-tinta">{lat!.toFixed(5)}, {long!.toFixed(5)}</span>
            <a href={`https://www.google.com/maps/search/?api=1&query=${lat},${long}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-aksen-teks hover:underline">
              Cek di peta <IconExternal width={14} height={14} />
            </a>
          </p>
        )}
      </div>

      <Field label={`Radius absen: ${radius} meter`} helper={radius <= 60 ? 'Ketat. Cocok untuk toko kecil di area ramai.' : radius >= 300 ? 'Longgar. Cocok untuk area luas seperti gudang atau kebun.' : 'Pas untuk kebanyakan toko dan kantor.'}>
        <input type="range" min={30} max={500} step={10} value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="mt-2 w-full" />
      </Field>

      <PesanGalat>{simpan.isError ? pesanGalat(simpan.error) : arsip.isError ? pesanGalat(arsip.error) : null}</PesanGalat>
      <Button type="submit" size="lg" fullWidth loading={simpan.isPending} disabled={!nama.trim() || !adaTitik}>{adaTitik ? tombol : 'Tentukan titik lokasi dulu'}</Button>

      {awal && (
        konfirmArsip ? (
          <div className="rounded-[18px] bg-galat-lembut p-3">
            <p className="text-[14px] text-galat">Arsipkan {awal.name}? Karyawan di lokasi ini tidak bisa absen di sini lagi. Riwayatnya tetap tersimpan.</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setKonfirmArsip(false)}>Batal</Button>
              <Button size="sm" variant="danger" loading={arsip.isPending} onClick={() => arsip.mutate()}>Ya, arsipkan</Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" onClick={() => setKonfirmArsip(true)}>Arsipkan lokasi ini</Button>
        )
      )}
    </form>
  )
}
