/**
 * Agen AI: agen AgentBuff (atau agen lain) bisa membaca dan mengurus Absentra atas
 * nama pemilik, dengan izin yang dibatasi. Koneksi AgentBuff dibuat otomatis dari
 * Marketplace; koneksi manual untuk pengguna teknis.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import type { McpConnection } from '@/lib/domain/types'
import { Badge, BottomSheet, Button, Field, Input, KepalaHalaman, PesanGalat, Skeleton, cx } from '@/components/ui'
import { LogoAgentBuff, Maskot } from '@/components/merek'
import { IconCopy, IconExternal, IconPlus } from '@/components/ui/icons'
import { toast } from '@/components/Toast'
import { salin } from '@/lib/salin'
import { formatDate } from '@/lib/format'
import { pesanGalat } from '@/lib/galat'

/** Katalog izin, harus sama dengan server (server/src/routes/mcpServer.ts). */
const KELOMPOK_IZIN: { label: string; izin: { id: string; label: string }[] }[] = [
  { label: 'Kehadiran', izin: [{ id: 'attendance:read', label: 'Lihat absen' }, { id: 'attendance:write', label: 'Koreksi absen' }] },
  { label: 'Shift', izin: [{ id: 'shift:read', label: 'Lihat jadwal' }, { id: 'shift:write', label: 'Atur jadwal' }] },
  { label: 'Karyawan', izin: [{ id: 'employee:read', label: 'Lihat karyawan' }, { id: 'employee:write', label: 'Tambah karyawan & upah' }] },
  { label: 'Usaha', izin: [{ id: 'org:read', label: 'Lihat lokasi & divisi' }, { id: 'org:write', label: 'Ubah lokasi & divisi' }] },
  { label: 'Aturan', izin: [{ id: 'policy:read', label: 'Lihat aturan' }, { id: 'policy:write', label: 'Ubah aturan' }] },
  { label: 'Cuti & lembur', izin: [{ id: 'request:read', label: 'Lihat pengajuan' }, { id: 'request:write', label: 'Setujui / tolak' }] },
  { label: 'Lainnya', izin: [{ id: 'payroll:read', label: 'Rekap gaji' }, { id: 'audit:read', label: 'Jejak perubahan' }] },
]
const LABEL_IZIN = new Map(KELOMPOK_IZIN.flatMap((k) => k.izin.map((i) => [i.id, i.label] as const)))
const CONTOH = ['Siapa yang belum absen hari ini?', 'Rekap lembur bulan ini', 'Ada cuti yang menunggu?', 'Siapa yang paling sering telat minggu ini?']

function alamatMcp() {
  return `${window.location.origin}/mcp`
}

export default function McpPage() {
  const qc = useQueryClient()
  const [buat, setBuat] = useState(false)
  const [cabut, setCabut] = useState<McpConnection | null>(null)
  const q = useQuery({ queryKey: ['mcp'], queryFn: () => api.mcpConnections() })
  const hapus = useMutation({
    mutationFn: (id: string) => api.revokeMcp(undefined, id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['mcp'] }); setCabut(null); toast.berhasil('Akses agen dicabut.') },
    onError: (e) => toast.galat(pesanGalat(e)),
  })
  const aktif = (q.data ?? []).filter((m) => m.status === 'active')
  const agentBuff = aktif.find((m) => /agentbuff/i.test(m.agentName))

  return (
    <div className="mx-auto max-w-3xl">
      <KepalaHalaman judul="Agen AI" keterangan="Tanya atau suruh agenmu soal absen karyawan, tanpa membuka aplikasi ini." />

      <section className="kaca-panel relative overflow-hidden rounded-[28px] p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <Maskot pose="analisis" ukuran="kecil" className="hidden shrink-0 sm:block" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <LogoAgentBuff ukuran={24} />
              <h2 className="text-[19px] font-semibold tracking-[-0.02em] text-tinta">Agen AgentBuff-mu</h2>
              {agentBuff ? <Badge tone="success"><span className="titik-hidup mr-1 h-1.5 w-1.5 rounded-full" />Tersambung</Badge> : <Badge>Belum tersambung</Badge>}
            </div>
            <p className="mt-2 text-[15px] text-tinta-2">
              {agentBuff
                ? 'Agenmu di AgentBuff sudah bisa membaca dan mengurus absensi usahamu. Coba tanya dari chat atau WhatsApp:'
                : 'Ambil Absentra di Marketplace AgentBuff, lalu agenmu tersambung sendiri. Setelah itu kamu bisa tanya dari chat atau WhatsApp:'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {CONTOH.map((c) => <span key={c} className="kaca-pil rounded-full px-3.5 py-2 text-[14px] text-tinta-2">&ldquo;{c}&rdquo;</span>)}
            </div>
            {!agentBuff && (
              <a href="https://agentbuff.id/marketplace?produk=absentra" target="_blank" rel="noopener noreferrer" className="tombol-grafit mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-full px-5 text-[15px] font-semibold">
                Buka AgentBuff <IconExternal width={16} height={16} />
              </a>
            )}
            <p className="mt-3 text-[13px] text-tinta-3">Perubahan penting seperti upah dan persetujuan selalu dikonfirmasi dulu, dan semuanya tercatat.</p>
          </div>
        </div>
      </section>

      <div className="mb-3 mt-8 flex items-center justify-between gap-3">
        <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-tinta">Akses yang aktif</h2>
        <Button variant="secondary" size="sm" onClick={() => setBuat(true)}><IconPlus width={16} height={16} /> Agen lain</Button>
      </div>
      {q.isLoading ? (
        <Skeleton className="h-24" />
      ) : aktif.length === 0 ? (
        <p className="kaca-panel rounded-[22px] px-4 py-6 text-center text-[14px] text-tinta-3">Belum ada agen yang punya akses.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {aktif.map((m) => (
            <article key={m.id} className="kaca-panel rounded-[24px] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[16px] font-semibold text-tinta">{m.agentName}</p>
                  <p className="text-[13px] text-tinta-3">{m.lastUsedAt ? `Terakhir dipakai ${formatDate(m.lastUsedAt)}` : 'Belum pernah dipakai'}{m.scopeBranchIds?.length ? ` · ${m.scopeBranchIds.length} lokasi saja` : ''}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setCabut(m)}>Cabut</Button>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">{m.scopes.map((s) => <Badge key={s}>{LABEL_IZIN.get(s) ?? s}</Badge>)}</div>
            </article>
          ))}
        </div>
      )}

      <BottomSheet open={buat} onClose={() => setBuat(false)} title="Hubungkan agen lain" keterangan="Untuk agen AI selain AgentBuff yang mendukung MCP." lebar="lg">
        <FormKoneksi onSelesai={() => qc.invalidateQueries({ queryKey: ['mcp'] })} />
      </BottomSheet>
      <BottomSheet open={!!cabut} onClose={() => setCabut(null)} title="Cabut akses agen ini?">
        <p className="text-[15px] text-tinta-2"><span className="font-semibold text-tinta">{cabut?.agentName}</span> tidak bisa lagi membaca atau mengubah data absensi.</p>
        <div className="mt-5 flex gap-2">
          <Button variant="secondary" fullWidth onClick={() => setCabut(null)}>Batal</Button>
          <Button variant="danger" fullWidth loading={hapus.isPending} onClick={() => cabut && hapus.mutate(cabut.id)}>Ya, cabut</Button>
        </div>
      </BottomSheet>
    </div>
  )
}

function FormKoneksi({ onSelesai }: { onSelesai: () => void }) {
  const [nama, setNama] = useState('')
  const [izin, setIzin] = useState<string[]>(['attendance:read', 'org:read', 'employee:read'])
  const [lokasi, setLokasi] = useState<string[]>([])
  const [hasil, setHasil] = useState<{ accessToken: string } | null>(null)
  const cabangQ = useQuery({ queryKey: ['branches'], queryFn: () => api.branches() })
  const m = useMutation({ mutationFn: () => api.createMcp({ agentName: nama.trim(), scopes: izin, scopeBranchIds: lokasi }), onSuccess: (r) => { setHasil(r); onSelesai() } })
  const balik = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])

  if (hasil) {
    const konfig = JSON.stringify({ mcpServers: { absentra: { url: alamatMcp(), headers: { Authorization: `Bearer ${hasil.accessToken}` } } } }, null, 2)
    return (
      <div className="flex flex-col gap-4">
        <p className="rounded-[16px] bg-perlu-lembut px-4 py-3 text-[14px] text-perlu">Token ini hanya tampil sekali. Salin dan simpan di tempat aman.</p>
        <code className="block break-all rounded-[16px] bg-sumur p-3 text-[13px] text-tinta">{hasil.accessToken}</code>
        <Button variant="secondary" onClick={() => void salin(hasil.accessToken, 'Token disalin.')}><IconCopy width={16} height={16} /> Salin token</Button>
        <div>
          <p className="mb-1.5 text-[14px] font-semibold text-tinta-2">Contoh pengaturan klien MCP</p>
          <pre className="max-h-48 overflow-auto rounded-[16px] bg-sumur p-3 text-[12px] text-tinta">{konfig}</pre>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => void salin(konfig, 'Pengaturan disalin.')}><IconCopy width={16} height={16} /> Salin pengaturan</Button>
        </div>
      </div>
    )
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (nama.trim() && izin.length) m.mutate() }}>
      <Field label="Nama agen"><Input value={nama} onChange={(e) => setNama(e.target.value)} placeholder="mis. Asisten toko" required maxLength={60} /></Field>
      {(cabangQ.data?.length ?? 0) > 1 && (
        <div>
          <p className="text-[14px] font-medium text-tinta-2">Batasi ke lokasi tertentu (opsional)</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {cabangQ.data!.map((b) => (
              <button key={b.id} type="button" aria-pressed={lokasi.includes(b.id)} onClick={() => setLokasi(balik(lokasi, b.id))} className="kaca-chip min-h-[40px] rounded-full px-4 text-[14px] font-medium">{b.name}</button>
            ))}
          </div>
        </div>
      )}
      <div>
        <p className="text-[14px] font-medium text-tinta-2">Izin</p>
        <p className="text-[13px] text-tinta-3">Beri seperlunya saja. Izin mengubah membuat agen bisa mengubah data.</p>
        <div className="mt-3 flex flex-col gap-3">
          {KELOMPOK_IZIN.map((k) => (
            <div key={k.label}>
              <p className="mb-1.5 text-[13px] font-semibold text-tinta-3">{k.label}</p>
              <div className="flex flex-wrap gap-2">
                {k.izin.map((i) => (
                  <button key={i.id} type="button" aria-pressed={izin.includes(i.id)} onClick={() => setIzin(balik(izin, i.id))} className={cx('kaca-chip min-h-[40px] rounded-full px-4 text-[14px] font-medium')}>{i.label}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="text-[13px] text-tinta-3">Alamat MCP: <code className="text-tinta-2">{alamatMcp()}</code></p>
      <PesanGalat>{m.isError ? pesanGalat(m.error) : null}</PesanGalat>
      <Button type="submit" size="lg" fullWidth loading={m.isPending} disabled={!nama.trim() || !izin.length}>Buat token akses</Button>
    </form>
  )
}
