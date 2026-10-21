/** Divisi: kelompok kerja sesuai usaha (Dapur, Kasir, Gudang, ...). */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { Button, EmptyState, Input, KepalaHalaman, PesanGalat, Skeleton } from '@/components/ui'
import { IconPlus, IconTrash } from '@/components/ui/icons'
import { toast } from '@/components/Toast'
import { pesanGalat } from '@/lib/galat'

export default function DivisionsPage() {
  const qc = useQueryClient()
  const [nama, setNama] = useState('')
  const [hapusId, setHapusId] = useState<string | null>(null)
  const q = useQuery({ queryKey: ['divisions'], queryFn: () => api.divisions() })
  const segarkan = () => qc.invalidateQueries({ queryKey: ['divisions'] })
  const tambah = useMutation({ mutationFn: () => api.createDivision(nama.trim()), onSuccess: () => { setNama(''); segarkan(); toast.berhasil('Divisi ditambahkan.') } })
  const hapus = useMutation({ mutationFn: (id: string) => api.deleteDivision(id), onSuccess: () => { setHapusId(null); segarkan(); toast.berhasil('Divisi dihapus.') }, onError: (e) => toast.galat(pesanGalat(e)) })

  return (
    <div className="mx-auto max-w-2xl">
      <KepalaHalaman judul="Divisi" keterangan="Kelompok kerja di usahamu, misalnya Dapur, Kasir, Gudang. Boleh dilewati." />
      <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (nama.trim()) tambah.mutate() }}>
        <Input value={nama} onChange={(e) => setNama(e.target.value)} placeholder="Nama divisi baru" maxLength={60} aria-label="Nama divisi baru" className="rounded-full" />
        <Button type="submit" loading={tambah.isPending} disabled={!nama.trim()}><IconPlus width={18} height={18} /> Tambah</Button>
      </form>
      <PesanGalat>{tambah.isError ? pesanGalat(tambah.error) : null}</PesanGalat>

      {q.isLoading ? (
        <Skeleton className="h-24" />
      ) : !q.data?.length ? (
        <EmptyState pose="analisis" title="Belum ada divisi" keterangan="Tidak wajib. Divisi membantu memilah laporan kalau timmu mulai banyak." />
      ) : (
        <div className="kaca-panel mt-2 divide-y divide-garis overflow-hidden rounded-[24px]">
          {q.data.map((d) => (
            <div key={d.id} className="flex min-h-[56px] items-center justify-between gap-3 px-4">
              <span className="text-[15px] font-medium text-tinta">{d.name}</span>
              {hapusId === d.id ? (
                <span className="flex items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setHapusId(null)}>Batal</Button>
                  <Button size="sm" variant="danger" loading={hapus.isPending} onClick={() => hapus.mutate(d.id)}>Hapus</Button>
                </span>
              ) : (
                <button type="button" aria-label={`Hapus ${d.name}`} onClick={() => setHapusId(d.id)} className="flex h-10 w-10 items-center justify-center rounded-full text-tinta-3 hover:bg-galat-lembut hover:text-galat">
                  <IconTrash width={18} height={18} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
