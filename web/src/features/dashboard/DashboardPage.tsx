import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api/client'
import { useActor } from '@/auth/useActor'
import { Button, Card, Select, Skeleton, EmptyState, Badge } from '@/components/ui'
import { AttendanceBadge, TrustMeter } from '@/components/StatusBadge'
import { IconCheckCircle, IconClock, IconUser, IconCalendar, IconAlert, IconCheck } from '@/components/ui/icons'
import { t } from '@/i18n'
import { formatTime, formatDateShort } from '@/lib/format'
import { AttendanceDetailSheet } from './AttendanceDetailSheet'

export function DashboardPage() {
  const qc = useQueryClient()
  const { company, scopeBranchIds, role } = useActor()
  const companyId = company?.id
  const [branch, setBranch] = useState<string>('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [skipDiv, setSkipDiv] = useState(false)

  useEffect(() => {
    const onSync = () => qc.invalidateQueries({ queryKey: ['dashboard'] })
    window.addEventListener('absentra:synced', onSync)
    return () => window.removeEventListener('absentra:synced', onSync)
  }, [qc])

  const branchesQ = useQuery({ queryKey: ['branches', companyId], enabled: !!companyId, queryFn: () => api.branches() })
  const shiftsQ = useQuery({ queryKey: ['shiftTemplates', companyId], enabled: !!companyId, queryFn: () => api.shiftTemplates() })
  const empQ = useQuery({ queryKey: ['employees', companyId], enabled: !!companyId, queryFn: () => api.employees() })
  const divQ = useQuery({ queryKey: ['divisions', companyId], enabled: !!companyId, queryFn: () => api.divisions() })
  const branchId = branch || (scopeBranchIds.length === 1 ? scopeBranchIds[0] : undefined)
  const summaryQ = useQuery({ queryKey: ['dashboard', 'summary', companyId, branchId], enabled: !!companyId, queryFn: () => api.dashboardSummary(companyId, branchId) })
  const feedQ = useQuery({ queryKey: ['dashboard', 'feed', companyId, branchId], enabled: !!companyId, queryFn: () => api.liveFeed(companyId, branchId) })
  const anomQ = useQuery({ queryKey: ['dashboard', 'anom', companyId, branchId], enabled: !!companyId, queryFn: () => api.anomalies(companyId, branchId) })
  const trendsQ = useQuery({ queryKey: ['dashboard', 'trends', companyId, branchId], enabled: !!companyId, queryFn: () => api.dashboardTrends(branchId, 7) })

  const isOwner = role === 'owner'
  const s = summaryQ.data
  // Ordered setup steps; only the next incomplete one is actionable (guided flow).
  // Divisi is optional (boleh dilewati) but placed before adding employees.
  const scheduledToday = s ? (s.present + s.notYet) > 0 : false
  const setupSteps = [
    { label: 'Tambah cabang & atur titik geofence', hint: 'Lokasi tempat karyawan absen.', to: '/cabang', done: (branchesQ.data?.length ?? 0) > 0, required: true },
    { label: 'Buat template shift (jam kerja)', hint: 'mis. Shift Pagi 08:00–17:00.', to: '/shift', done: (shiftsQ.data?.length ?? 0) > 0, required: true },
    { label: 'Buat divisi (opsional)', hint: 'Kelompok kerja mis. Dapur, Kasir, Gudang — supaya karyawan bisa langsung dimasukkan ke divisinya. Boleh dilewati.', to: '/divisi', done: (divQ.data?.length ?? 0) > 0 || skipDiv, required: false },
    { label: 'Tambah / undang karyawan', hint: 'Lewat email, link/QR, atau impor CSV.', to: '/karyawan', done: (empQ.data?.length ?? 0) > 0, required: true },
    { label: 'Susun jadwal shift karyawan', hint: 'Tugaskan shift agar karyawan bisa absen.', to: '/shift', done: scheduledToday, required: true },
  ]
  const prereqMet = (i: number) => setupSteps.slice(0, i).every((x) => !x.required || x.done)
  const nextStep = setupSteps.findIndex((x, i) => !x.done && prereqMet(i))
  // Card stays until every REQUIRED step is done (optional Divisi ignored).
  const setupDone = setupSteps.every((x) => !x.required || x.done)

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-text">{t.dashboard.title}</h1>
        {scopeBranchIds.length !== 1 && (
          <Select value={branch} onChange={(e) => setBranch((e.target as HTMLSelectElement).value)} className="max-w-[12rem]">
            <option value="">{t.dashboard.filterBranch}</option>
            {branchesQ.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        )}
      </div>

      {/* Guided setup (owner, until complete) — only the next step is actionable */}
      {isOwner && !branchesQ.isLoading && !setupDone && (
        <Card className="mb-4 border-accent/40 bg-accent/5">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-semibold text-text">Penyiapan perusahaan</p>
            <span className="text-xs text-text-muted">Langkah {nextStep + 1} dari {setupSteps.length}</span>
          </div>
          <p className="mb-3 text-xs text-text-muted">Ikuti urutannya — selesaikan satu per satu agar karyawan bisa langsung absen.</p>
          <div className="flex flex-col gap-2">
            {setupSteps.map((step, i) => {
              const state = step.done ? 'done' : i === nextStep ? 'active' : 'locked'
              return (
                <div key={i} className={`flex items-center gap-3 rounded-md border p-3 ${state === 'active' ? 'border-primary bg-surface-elevated' : 'border-transparent'}`}>
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${state === 'done' ? 'bg-success text-white' : state === 'active' ? 'bg-primary text-on-primary' : 'bg-border text-text-muted'}`}>
                    {state === 'done' ? <IconCheck width={14} height={14} /> : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium ${state === 'done' ? 'text-text-muted line-through' : state === 'active' ? 'text-text' : 'text-text-muted'}`}>{step.label}</p>
                    {state === 'active' && <p className="text-xs text-text-muted">{step.hint}</p>}
                  </div>
                  {state === 'done' && <span className="text-xs font-medium text-success">{!step.required && (divQ.data?.length ?? 0) === 0 ? 'Dilewati' : 'Selesai'}</span>}
                  {state === 'active' && (
                    <div className="flex shrink-0 items-center gap-2">
                      {!step.required && <Button size="sm" variant="ghost" onClick={() => setSkipDiv(true)}>Lewati</Button>}
                      <Link to={step.to}><Button size="sm">Buka →</Button></Link>
                    </div>
                  )}
                  {state === 'locked' && <span className="shrink-0 text-xs text-text-muted">menunggu</span>}
                </div>
              )
            })}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Metric icon={<IconCheckCircle className="text-success" />} label={t.dashboard.present} value={s?.present} loading={summaryQ.isLoading} />
        <Metric icon={<IconClock className="text-warning" />} label={t.dashboard.late} value={s?.late} loading={summaryQ.isLoading} />
        <Metric icon={<IconUser className="text-text-muted" />} label={t.dashboard.notYet} value={s?.notYet} loading={summaryQ.isLoading} />
        <Metric icon={<IconCalendar className="text-accent" />} label={t.dashboard.onLeave} value={s?.onLeave} loading={summaryQ.isLoading} />
        <Metric icon={<IconClock className="text-primary" />} label={t.dashboard.overtime} value={s?.overtime} loading={summaryQ.isLoading} />
      </div>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-text-muted">Tren 7 hari (hadir / terlambat)</h2>
        {trendsQ.isLoading ? <Skeleton className="h-32" /> : <TrendChart data={trendsQ.data ?? []} />}
      </section>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 text-sm font-semibold text-text-muted">{t.dashboard.liveFeed} — masuk &amp; keluar</h2>
          <div className="flex flex-col gap-2">
            {feedQ.isLoading ? <Skeleton className="h-16" /> : feedQ.data?.length ? feedQ.data.map((r) => (
              <Card key={r.id} onClick={() => setOpenId(r.id)} className="flex items-center gap-3 py-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-text-muted"><IconUser width={18} height={18} /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text">{r.name}</p>
                  <p className="text-xs text-text-muted">
                    Masuk {r.clockInAt ? formatTime(r.clockInAt) : '—'} · {r.clockOutAt ? `Keluar ${formatTime(r.clockOutAt)}` : 'Belum keluar'}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <AttendanceBadge status={r.status} trustScore={r.trustScore} />
                  {r.leftEarly && <Badge tone="warning" icon={<IconClock width={12} height={12} />}>Pulang cepat</Badge>}
                </div>
              </Card>
            )) : <EmptyState title="Belum ada aktivitas hari ini." />}
          </div>
        </section>

        <section>
          <h2 className="mb-2 flex items-center gap-1 text-sm font-semibold text-text-muted"><IconAlert width={14} height={14} /> {t.dashboard.anomalies}</h2>
          <div className="flex flex-col gap-2">
            {anomQ.isLoading ? <Skeleton className="h-16" /> : anomQ.data?.length ? anomQ.data.map((r) => (
              <Card key={r.id} onClick={() => setOpenId(r.id)} className="py-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-text">{r.name}</p>
                  <AttendanceBadge status={r.status} trustScore={r.trustScore} />
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <TrustMeter score={r.trustScore} />
                  <span className="text-xs text-accent">Tinjau →</span>
                </div>
              </Card>
            )) : <EmptyState title={t.dashboard.noAnomalies} />}
          </div>
        </section>
      </div>

      <AttendanceDetailSheet recordId={openId} onClose={() => setOpenId(null)} />
    </div>
  )
}

function TrendChart({ data }: { data: Array<{ date: string; present: number; late: number }> }) {
  const max = Math.max(1, ...data.map((d) => d.present))
  return (
    <Card>
      <div className="flex items-end justify-between gap-2" style={{ height: 120 }}>
        {data.map((d) => {
          const h = Math.round((d.present / max) * 100)
          const lateH = d.present ? Math.round((d.late / d.present) * h) : 0
          return (
            <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex w-full flex-1 items-end justify-center">
                <div className="relative w-6 rounded-t bg-primary/30" style={{ height: `${h}%`, minHeight: d.present ? 6 : 0 }} title={`${d.present} hadir, ${d.late} telat`}>
                  <div className="absolute bottom-0 w-full rounded-t bg-warning" style={{ height: `${lateH}%` }} />
                </div>
              </div>
              <span className="text-[10px] text-text-muted">{formatDateShort(d.date + 'T00:00:00').split(' ')[0]}</span>
              <span className="text-[10px] font-medium text-text">{d.present}</span>
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex items-center gap-4 text-xs text-text-muted">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-primary/30" /> Hadir</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-warning" /> Terlambat</span>
      </div>
    </Card>
  )
}

function Metric({ icon, label, value, loading }: { icon: React.ReactNode; label: string; value?: number; loading?: boolean }) {
  return (
    <Card className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        {icon}
        {loading ? <Skeleton className="h-7 w-8" /> : <span className="text-2xl font-bold text-text">{value ?? 0}</span>}
      </div>
      <span className="text-xs text-text-muted">{label}</span>
    </Card>
  )
}
