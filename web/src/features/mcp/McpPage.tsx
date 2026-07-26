import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { useActor } from '@/auth/useActor'
import { Button, Card, EmptyState, Skeleton, Badge, BottomSheet, Field, Input } from '@/components/ui'
import { IconBot } from '@/components/ui/icons'
import { t } from '@/i18n'
import { formatDate } from '@/lib/format'

/** Scope catalog — must mirror the MCP server (server/src/routes/mcpServer.ts). */
const SCOPE_GROUPS: { label: string; scopes: { id: string; label: string }[] }[] = [
  { label: 'Kehadiran', scopes: [{ id: 'attendance:read', label: 'Lihat kehadiran' }, { id: 'attendance:write', label: 'Ubah kehadiran' }] },
  { label: 'Shift', scopes: [{ id: 'shift:read', label: 'Lihat shift' }, { id: 'shift:write', label: 'Atur/tugaskan shift' }] },
  { label: 'Karyawan', scopes: [{ id: 'employee:read', label: 'Lihat karyawan' }, { id: 'employee:write', label: 'Tambah/undang/upah' }] },
  { label: 'Organisasi', scopes: [{ id: 'org:read', label: 'Lihat cabang/divisi' }, { id: 'org:write', label: 'Buat cabang/divisi' }] },
  { label: 'Kebijakan', scopes: [{ id: 'policy:read', label: 'Lihat kebijakan' }, { id: 'policy:write', label: 'Ubah kebijakan' }] },
  { label: 'Pengajuan', scopes: [{ id: 'request:read', label: 'Lihat cuti/lembur' }, { id: 'request:write', label: 'Setujui cuti/lembur' }] },
  { label: 'Lainnya', scopes: [{ id: 'payroll:read', label: 'Rekap payroll' }, { id: 'audit:read', label: 'Lihat audit' }] },
]

function mcpEndpointUrl() {
  if (typeof window === 'undefined') return '/mcp'
  return `${window.location.origin}/mcp`
}

export function McpPage() {
  const qc = useQueryClient()
  const { company } = useActor()
  const companyId = company?.id
  const [connect, setConnect] = useState(false)

  const q = useQuery({ queryKey: ['mcp', companyId], enabled: !!companyId, queryFn: () => api.mcpConnections(companyId!) })
  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeMcp(companyId!, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp'] }),
  })

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-xl font-bold text-text"><IconBot /> {t.mcp.title}</h1>
        <Button onClick={() => setConnect(true)}>Hubungkan Agen</Button>
      </div>
      <p className="mb-3 text-sm text-text-muted">{t.mcp.note}</p>

      <Card className="mb-4">
        <p className="mb-1 text-sm font-medium text-text">Endpoint MCP</p>
        <code className="block break-all rounded-md bg-surface p-2 text-xs text-text">{mcpEndpointUrl()}</code>
        <p className="mt-2 text-xs text-text-muted">
          Method <strong>POST</strong>, header <code>Authorization: Bearer &lt;token&gt;</code>, body JSON-RPC 2.0
          (<code>initialize</code>, <code>tools/list</code>, <code>tools/call</code>).
        </p>
        <Button size="sm" variant="secondary" className="mt-2" onClick={() => navigator.clipboard?.writeText(mcpEndpointUrl())}>
          Salin URL endpoint
        </Button>
      </Card>

      <BottomSheet open={connect} onClose={() => setConnect(false)} title="Hubungkan Agen AI (MCP)">
        <ConnectForm onDone={() => qc.invalidateQueries({ queryKey: ['mcp'] })} />
      </BottomSheet>

      {q.isLoading ? (
        <Skeleton className="h-24" />
      ) : q.data?.length ? (
        <div className="flex flex-col gap-2">
          {q.data.map((m) => (
            <Card key={m.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-text">{m.agentName}</p>
                  <p className="text-xs text-text-muted">client: {m.oauthClientId}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <span className="text-xs text-text-muted">{t.mcp.scopes}:</span>
                    {m.scopes.map((s) => <Badge key={s} tone="accent">{s}</Badge>)}
                  </div>
                  {m.scopeBranchIds?.length > 0 && (
                    <p className="mt-1 text-xs text-text-muted">Cabang terbatas: {m.scopeBranchIds.length} cabang</p>
                  )}
                  {m.lastUsedAt && <p className="mt-2 text-xs text-text-muted">{t.mcp.lastUsed}: {formatDate(m.lastUsedAt)}</p>}
                </div>
                <div className="flex flex-col items-end gap-2">
                  {m.status === 'active' ? <Badge tone="success">Aktif</Badge> : <Badge tone="danger">Dicabut</Badge>}
                  {m.status === 'active' && (
                    <Button size="sm" variant="danger" onClick={() => revoke.mutate(m.id)} loading={revoke.isPending}>{t.mcp.revoke}</Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title={t.mcp.empty} />
      )}
    </div>
  )
}

function ConnectForm({ onDone }: { onDone: () => void }) {
  const [agentName, setName] = useState('')
  const [scopes, setScopes] = useState<string[]>(['attendance:read', 'org:read', 'employee:read'])
  const [scopeBranchIds, setBranchIds] = useState<string[]>([])
  const [result, setResult] = useState<{ accessToken: string } | null>(null)
  const branchesQ = useQuery({ queryKey: ['branches'], queryFn: () => api.branches() })
  const m = useMutation({
    mutationFn: () => api.createMcp({ agentName, scopes, scopeBranchIds }),
    onSuccess: (r) => { setResult(r); onDone() },
  })
  const toggle = (s: string) => setScopes((p) => p.includes(s) ? p.filter((x) => x !== s) : [...p, s])
  const toggleBranch = (id: string) => setBranchIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id])

  if (result) {
    const endpoint = mcpEndpointUrl()
    const snippet = JSON.stringify({
      mcpServers: {
        absentra: {
          url: endpoint,
          headers: { Authorization: `Bearer ${result.accessToken}` },
        },
      },
    }, null, 2)
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text">Token akses agen (tampil sekali — salin & simpan):</p>
        <code className="block break-all rounded-md bg-surface p-3 text-xs text-text">{result.accessToken}</code>
        <Button fullWidth variant="secondary" onClick={() => navigator.clipboard?.writeText(result.accessToken)}>Salin token</Button>

        <div>
          <p className="mb-1 text-sm font-medium text-text">Cara pakai</p>
          <ul className="list-inside list-disc text-xs text-text-muted">
            <li>Endpoint: <code>POST {endpoint}</code></li>
            <li>Header: <code>Authorization: Bearer …</code></li>
            <li>Contoh config Cursor / klien MCP:</li>
          </ul>
          <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-surface p-2 text-[11px] text-text">{snippet}</pre>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => navigator.clipboard?.writeText(snippet)}>Salin config JSON</Button>
        </div>
      </div>
    )
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (agentName && scopes.length) m.mutate() }}>
      <Field label="Nama agen"><Input value={agentName} onChange={(e) => setName(e.target.value)} placeholder="mis. Asisten Bu Sari" required /></Field>

      <div>
        <p className="mb-1 text-sm font-medium text-text">Batasi ke cabang (opsional)</p>
        <p className="mb-2 text-xs text-text-muted">Kosong = semua cabang. Centang untuk membatasi agen ke cabang tertentu.</p>
        <div className="flex flex-wrap gap-2">
          {(branchesQ.data ?? []).map((b) => (
            <label key={b.id} className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${scopeBranchIds.includes(b.id) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text-muted'}`}>
              <input type="checkbox" className="hidden" checked={scopeBranchIds.includes(b.id)} onChange={() => toggleBranch(b.id)} /> {b.name}
            </label>
          ))}
          {!branchesQ.data?.length && <p className="text-xs text-text-muted">Belum ada cabang.</p>}
        </div>
      </div>

      <div>
        <p className="mb-1 text-sm font-medium text-text">Izin (scope) — least privilege</p>
        <p className="mb-2 text-xs text-text-muted">Beri hanya yang perlu. Izin tulis membuat agen bisa mengubah data (selalu minta konfirmasi sebelum eksekusi).</p>
        <div className="flex flex-col gap-3">
          {SCOPE_GROUPS.map((g) => (
            <div key={g.label}>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">{g.label}</p>
              <div className="flex flex-wrap gap-2">
                {g.scopes.map((s) => (
                  <label key={s.id} className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${scopes.includes(s.id) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text-muted'}`}>
                    <input type="checkbox" className="hidden" checked={scopes.includes(s.id)} onChange={() => toggle(s.id)} /> {s.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <Button type="submit" fullWidth loading={m.isPending} disabled={!agentName || !scopes.length}>Buat koneksi & token</Button>
    </form>
  )
}
