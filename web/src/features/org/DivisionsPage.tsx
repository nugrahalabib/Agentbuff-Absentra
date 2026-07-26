import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { Button, Card, Input, EmptyState, Skeleton } from '@/components/ui'

export function DivisionsPage() {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const q = useQuery({ queryKey: ['divisions'], queryFn: () => api.divisions() })
  const inv = () => qc.invalidateQueries({ queryKey: ['divisions'] })
  const add = useMutation({ mutationFn: () => api.createDivision(name.trim()), onSuccess: () => { setName(''); inv() } })
  const del = useMutation({ mutationFn: (id: string) => api.deleteDivision(id), onSuccess: inv })

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-1 text-xl font-bold text-text">Divisi</h1>
      <p className="mb-4 text-sm text-text-muted">Kelompok kerja fungsional sesuai usahamu (mis. Dapur, Kasir, Gudang).</p>

      <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) add.mutate() }}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama divisi baru" />
        <Button type="submit" loading={add.isPending} disabled={!name.trim()}>Tambah</Button>
      </form>

      {q.isLoading ? <Skeleton className="h-20" /> : q.data?.length ? (
        <div className="flex flex-col gap-2">
          {q.data.map((d) => (
            <Card key={d.id} className="flex items-center justify-between py-3">
              <span className="text-text">{d.name}</span>
              <Button size="sm" variant="ghost" onClick={() => del.mutate(d.id)}>Hapus</Button>
            </Card>
          ))}
        </div>
      ) : <EmptyState title="Belum ada divisi." />}
    </div>
  )
}
