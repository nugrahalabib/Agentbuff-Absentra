import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type EmployeeRow } from '@/lib/api/client'
import { Button, Card, EmptyState, Skeleton, BottomSheet, Field, Input, Select, Badge } from '@/components/ui'
import { IconUser, IconMapPin, IconDownload } from '@/components/ui/icons'
import { downloadCsv } from '@/lib/exporters'
import { t } from '@/i18n'
import { formatIDR } from '@/lib/format'
import type { Role } from '@/lib/domain/types'

const roleLabel: Record<string, string> = { owner: 'Owner', branch_admin: 'Branch Admin', hr: 'HR', employee: 'Karyawan' }

export function EmployeesPage() {
  const qc = useQueryClient()
  const [sheet, setSheet] = useState<null | 'add' | 'invite' | 'import' | 'export' | EmployeeRow>(null)
  const empQ = useQuery({ queryKey: ['employees'], queryFn: () => api.employees() })
  const branchesQ = useQuery({ queryKey: ['branches'], queryFn: () => api.branches() })
  const divQ = useQuery({ queryKey: ['divisions'], queryFn: () => api.divisions() })
  const branchName = (id: string) => branchesQ.data?.find((b) => b.id === id)?.name ?? '—'
  const divName = (id?: string) => divQ.data?.find((d) => d.id === id)?.name
  const inv = () => qc.invalidateQueries({ queryKey: ['employees'] })

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-text">{t.employees.title}</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <details className="group">
              <summary className="flex min-h-touch cursor-pointer list-none items-center rounded-md border border-border bg-surface-elevated px-3 text-sm font-medium text-text marker:content-none">
                Lainnya
              </summary>
              <div className="absolute right-0 z-20 mt-1 min-w-[10rem] rounded-md border border-border bg-surface-elevated py-1 shadow-lg">
                <button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-surface" onClick={() => setSheet('export')}>Export CSV</button>
                <button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-surface" onClick={() => setSheet('import')}>Import CSV</button>
                <button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-surface" onClick={() => setSheet('invite')}>Undang (link/QR)</button>
              </div>
            </details>
          </div>
          <Button onClick={() => setSheet('add')}>Tambah</Button>
        </div>
      </div>

      {empQ.isLoading ? <Skeleton className="h-24" /> : empQ.data?.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {empQ.data.map((e) => (
            <Card key={e.id} onClick={() => setSheet(e)} className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-surface text-text-muted">
                {e.photoData ? <img src={e.photoData} alt={e.name} className="h-full w-full object-cover" /> : <IconUser />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium text-text">{e.name}</p>
                  <Badge tone="accent">{roleLabel[e.role]}</Badge>
                  {e.employmentStatus === 'inactive' && <Badge tone="danger">Nonaktif</Badge>}
                </div>
                {e.email && <p className="truncate text-xs text-text-muted">{e.email}</p>}
                <p className="flex items-center gap-1 text-xs text-text-muted"><IconMapPin width={12} height={12} /> {branchName(e.branchId)}{divName(e.divisionId) && ` · ${divName(e.divisionId)}`}</p>
                {e.canSeeWage ? <p className="mt-1 text-xs text-text-muted">Upah pokok: <span className="font-medium text-text">{formatIDR(e.wageBasic ?? 0)}</span></p> : <p className="mt-1 text-xs italic text-text-muted">{t.employees.wageHidden}</p>}
              </div>
            </Card>
          ))}
        </div>
      ) : <EmptyState title={t.employees.empty} action={<Button onClick={() => setSheet('invite')}>Undang Karyawan</Button>} />}

      <BottomSheet open={sheet === 'add'} onClose={() => setSheet(null)} title="Tambah Karyawan">
        <EmployeeForm branches={branchesQ.data ?? []} divisions={divQ.data ?? []} onDone={() => { inv(); setSheet(null) }} />
      </BottomSheet>
      <BottomSheet open={!!sheet && typeof sheet === 'object'} onClose={() => setSheet(null)} title="Edit Karyawan">
        {typeof sheet === 'object' && sheet && <EmployeeForm employee={sheet} branches={branchesQ.data ?? []} divisions={divQ.data ?? []} onDone={() => { inv(); setSheet(null) }} />}
      </BottomSheet>
      <BottomSheet open={sheet === 'invite'} onClose={() => setSheet(null)} title={t.employees.invite}>
        <InviteForm branches={branchesQ.data ?? []} divisions={divQ.data ?? []} />
      </BottomSheet>
      <BottomSheet open={sheet === 'import'} onClose={() => setSheet(null)} title="Import Karyawan (CSV)">
        <ImportForm branches={branchesQ.data ?? []} divisions={divQ.data ?? []} onDone={() => { inv(); setSheet(null) }} />
      </BottomSheet>
      <BottomSheet open={sheet === 'export'} onClose={() => setSheet(null)} title="Export Data Karyawan">
        <ExportSheet rows={empQ.data ?? []} branchName={branchName} divName={divName} />
      </BottomSheet>
    </div>
  )
}

function ExportSheet({ rows, branchName, divName }: { rows: EmployeeRow[]; branchName: (id: string) => string; divName: (id?: string) => string | undefined }) {
  const exportCsv = () => downloadCsv('karyawan.csv',
    ['Nama', 'Email', 'Cabang', 'Divisi', 'Peran', 'Status', 'UpahPokok'],
    rows.map((e) => [e.name, e.email ?? '', branchName(e.branchId), divName(e.divisionId) ?? '', roleLabel[e.role] ?? e.role, e.employmentStatus, e.canSeeWage ? (e.wageBasic ?? 0) : '']))
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-text-muted">Pratinjau {rows.length} karyawan. Kolom upah hanya muncul bila kamu berhak melihatnya.</p>
      <div className="print-area max-h-60 overflow-auto rounded-md border border-border">
        <div className="print-only mb-2"><h2 className="text-lg font-bold">Data Karyawan</h2></div>
        <table className="w-full text-sm">
          <thead className="bg-surface text-left text-text-muted"><tr><th className="p-2">Nama</th><th className="p-2">Cabang</th><th className="p-2">Peran</th><th className="p-2">Status</th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="border-t border-border">
                <td className="p-2 text-text">{e.name}</td>
                <td className="p-2 text-text-muted">{branchName(e.branchId)}</td>
                <td className="p-2 text-text-muted">{roleLabel[e.role] ?? e.role}</td>
                <td className="p-2 text-text-muted">{e.employmentStatus === 'active' ? 'Aktif' : 'Nonaktif'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <Button fullWidth variant="secondary" onClick={exportCsv}><IconDownload width={16} height={16} /> CSV / Excel</Button>
        <Button fullWidth variant="secondary" onClick={() => window.print()}>Cetak PDF</Button>
      </div>
    </div>
  )
}

interface ParsedRow { name: string; email: string; wageBasic: number; wageFixedAllowance: number }
function parseCsv(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (!lines.length) return []
  const header = lines[0].toLowerCase()
  const hasHeader = header.includes('nama') || header.includes('name') || header.includes('email')
  const rows = (hasHeader ? lines.slice(1) : lines).map((line) => {
    const c = line.split(/[,;\t]/).map((x) => x.trim())
    return { name: c[0] ?? '', email: c[1] ?? '', wageBasic: Number(c[2] ?? 0) || 0, wageFixedAllowance: Number(c[3] ?? 0) || 0 }
  })
  return rows.filter((r) => r.name && /.+@.+/.test(r.email))
}

function ImportForm({ branches, divisions, onDone }: { branches: { id: string; name: string }[]; divisions: { id: string; name: string }[]; onDone: () => void }) {
  const [branchId, setBranch] = useState(branches[0]?.id ?? '')
  const [divisionId, setDivision] = useState('')
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [result, setResult] = useState<{ created: number; skipped: string[] } | null>(null)
  const m = useMutation({ mutationFn: () => api.importEmployees({ branchId, divisionId: divisionId || undefined, rows }), onSuccess: (r) => setResult(r) })

  const onFile = (f: File | undefined) => {
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => setRows(parseCsv(String(reader.result)))
    reader.readAsText(f)
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-text-muted">Format kolom: <code>nama, email, upah_pokok, tunjangan_tetap</code> (baris header opsional). Semua diimpor ke cabang & divisi terpilih.</p>
      <div className="flex gap-2">
        <Field label="Cabang"><Select value={branchId} onChange={(e) => setBranch((e.target as HTMLSelectElement).value)}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
        <Field label="Divisi"><Select value={divisionId} onChange={(e) => setDivision((e.target as HTMLSelectElement).value)}><option value="">—</option>{divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
      </div>
      <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="text-sm text-text" />
      {rows.length > 0 && !result && (
        <div className="max-h-40 overflow-y-auto rounded-md border border-border text-sm">
          {rows.map((r, i) => (
            <div key={i} className="flex justify-between border-b border-border px-3 py-1.5 last:border-0">
              <span className="text-text">{r.name}</span>
              <span className="text-text-muted">{r.email}</span>
            </div>
          ))}
        </div>
      )}
      {result ? (
        <>
          <div className="rounded-md bg-success/10 p-3 text-sm text-success">
            {result.created} karyawan ditambahkan{result.skipped.length ? `, ${result.skipped.length} dilewati (sudah ada)` : ''}.
          </div>
          <Button fullWidth onClick={onDone}>Selesai</Button>
        </>
      ) : (
        <Button fullWidth disabled={!rows.length || !branchId} loading={m.isPending} onClick={() => m.mutate()}>Import {rows.length || ''} karyawan</Button>
      )}
    </div>
  )
}

function EmployeeForm({ employee, branches, divisions, onDone }: { employee?: EmployeeRow; branches: { id: string; name: string }[]; divisions: { id: string; name: string }[]; onDone: () => void }) {
  const editing = !!employee
  const [name, setName] = useState(employee?.name ?? '')
  const [email, setEmail] = useState(employee?.email ?? '')
  const [branchId, setBranch] = useState(employee?.branchId ?? branches[0]?.id ?? '')
  const [divisionId, setDivision] = useState(employee?.divisionId ?? '')
  const [role, setRole] = useState<Role>((employee?.role as Role) ?? 'employee')
  const [wageBasic, setBasic] = useState(employee?.wageBasic ?? 0)
  const [wageFixedAllowance, setFixed] = useState(employee?.wageFixedAllowance ?? 0)
  const canWage = employee ? employee.canSeeWage : true

  const m = useMutation({
    mutationFn: () => editing
      ? api.updateEmployee(employee!.id, { name, branchId, divisionId: divisionId || null, role, ...(canWage ? { wageBasic, wageFixedAllowance } : {}), scopeBranchIds: role === 'branch_admin' ? [branchId] : [] })
      : api.createEmployee({ name, email, branchId, divisionId: divisionId || undefined, role, scopeBranchIds: role === 'branch_admin' ? [branchId] : [], wageBasic, wageFixedAllowance }),
    onSuccess: onDone,
  })
  const deactivate = useMutation({ mutationFn: () => api.updateEmployee(employee!.id, { employmentStatus: 'inactive' }), onSuccess: onDone })
  const reactivate = useMutation({ mutationFn: () => api.updateEmployee(employee!.id, { employmentStatus: 'active' }), onSuccess: onDone })
  const remove = useMutation({ mutationFn: () => api.deleteEmployee(employee!.id), onSuccess: onDone })

  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
      <Field label="Nama"><Input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
      {!editing && <Field label="Email Google" helper="Karyawan login dengan email ini"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>}
      <div className="flex gap-2">
        <Field label="Cabang"><Select value={branchId} onChange={(e) => setBranch((e.target as HTMLSelectElement).value)}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
        <Field label="Divisi"><Select value={divisionId} onChange={(e) => setDivision((e.target as HTMLSelectElement).value)}><option value="">—</option>{divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
      </div>
      <Field label="Peran" helper="Branch Admin/HR bisa menyetujui & melihat data cabangnya">
        <Select value={role} onChange={(e) => setRole((e.target as HTMLSelectElement).value as Role)}>
          <option value="employee">Karyawan</option>
          <option value="hr">HR / Approver</option>
          <option value="branch_admin">Branch Admin</option>
        </Select>
      </Field>
      {canWage && (
        <div className="flex gap-2">
          <Field label="Upah pokok (Rp)"><Input type="number" value={wageBasic} onChange={(e) => setBasic(Number(e.target.value))} /></Field>
          <Field label="Tunjangan tetap (Rp)"><Input type="number" value={wageFixedAllowance} onChange={(e) => setFixed(Number(e.target.value))} /></Field>
        </div>
      )}
      {editing && employee!.employmentStatus === 'inactive' && (
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={() => reactivate.mutate()} loading={reactivate.isPending}>Aktifkan kembali</Button>
          <Button type="button" variant="danger" onClick={() => { if (confirm(`Hapus permanen ${employee!.name}? Riwayat absensi tetap tersimpan.`)) remove.mutate() }} loading={remove.isPending}>Hapus permanen</Button>
        </div>
      )}
      <div className="flex gap-2">
        {editing && employee!.employmentStatus === 'active' && <Button type="button" variant="danger" onClick={() => deactivate.mutate()} loading={deactivate.isPending}>Nonaktifkan</Button>}
        <Button type="submit" fullWidth loading={m.isPending} disabled={!name || (!editing && !email)}>Simpan</Button>
      </div>
    </form>
  )
}

function InviteForm({ branches, divisions }: { branches: { id: string; name: string }[]; divisions: { id: string; name: string }[] }) {
  const [branchId, setBranch] = useState(branches[0]?.id ?? '')
  const [divisionId, setDivision] = useState('')
  const [role, setRole] = useState<Role>('employee')
  const [result, setResult] = useState<{ token: string } | null>(null)
  const m = useMutation({ mutationFn: () => api.createInvite({ branchId, divisionId: divisionId || undefined, role }), onSuccess: (r) => setResult(r) })
  const link = result ? `${location.origin}/invite/${result.token}` : ''

  return (
    <div className="flex flex-col gap-3">
      {!result ? (
        <>
          <Field label="Cabang"><Select value={branchId} onChange={(e) => setBranch((e.target as HTMLSelectElement).value)}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
          <Field label="Divisi"><Select value={divisionId} onChange={(e) => setDivision((e.target as HTMLSelectElement).value)}><option value="">—</option>{divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
          <Field label="Peran"><Select value={role} onChange={(e) => setRole((e.target as HTMLSelectElement).value as Role)}><option value="employee">Karyawan</option><option value="hr">HR</option><option value="branch_admin">Branch Admin</option></Select></Field>
          <Button fullWidth loading={m.isPending} disabled={!branchId} onClick={() => m.mutate()}>Buat link undangan</Button>
        </>
      ) : (
        <div className="rounded-md border border-border bg-surface p-3 text-center">
          <div className="mx-auto mb-2 grid h-28 w-28 grid-cols-8 gap-px bg-text p-1" aria-label="QR undangan">
            {Array.from({ length: 64 }).map((_, i) => (
              <span key={i} className={(i * 7 + result.token.charCodeAt(i % result.token.length)) % 3 === 0 ? 'bg-surface-elevated' : 'bg-text'} />
            ))}
          </div>
          <p className="mb-2 break-all text-xs text-text-muted">{link}</p>
          <Button size="sm" variant="secondary" onClick={() => navigator.clipboard?.writeText(link)}>Salin link</Button>
        </div>
      )}
    </div>
  )
}
