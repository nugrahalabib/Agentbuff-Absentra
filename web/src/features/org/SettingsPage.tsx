import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { Button, Card, Field, Input, Select, Skeleton } from '@/components/ui'
import type { Policy } from '@/lib/domain/types'

export function SettingsPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'company' | 'policy'>('company')
  const companyQ = useQuery({ queryKey: ['company'], queryFn: () => api.company() })
  const policyQ = useQuery({ queryKey: ['policy'], queryFn: () => api.policy() })

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-xl font-bold text-text">Pengaturan</h1>

      <div className="mb-4 flex gap-1 rounded-lg border border-border bg-surface-elevated p-1" role="tablist">
        <SettingsTab active={tab === 'company'} onClick={() => setTab('company')}>Profil Perusahaan</SettingsTab>
        <SettingsTab active={tab === 'policy'} onClick={() => setTab('policy')}>Kebijakan Absensi & Upah</SettingsTab>
      </div>

      {tab === 'company' && (
        companyQ.isLoading ? <Skeleton className="h-40" /> : companyQ.data && (
          <CompanyForm company={companyQ.data} onSaved={() => { qc.invalidateQueries({ queryKey: ['company'] }); qc.invalidateQueries({ queryKey: ['me'] }) }} />
        )
      )}
      {tab === 'policy' && (
        policyQ.isLoading ? <Skeleton className="h-40" /> : policyQ.data && (
          <PolicyForm policy={policyQ.data} onSaved={() => qc.invalidateQueries({ queryKey: ['policy'] })} />
        )
      )}
    </div>
  )
}

function SettingsTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`min-h-touch flex-1 rounded-md px-3 text-sm font-medium transition-colors ${active ? 'bg-primary text-on-primary' : 'text-text-muted hover:bg-surface hover:text-text'}`}
    >
      {children}
    </button>
  )
}

function CompanyForm({ company, onSaved }: { company: any; onSaved: () => void }) {
  const [displayName, setName] = useState(company.displayName)
  const [businessType, setType] = useState(company.businessType)
  const [timezone, setTz] = useState(company.timezone)
  const [workweekType, setWw] = useState(company.workweekType)
  const [address, setAddr] = useState(company.address ?? '')
  const [logo, setLogo] = useState<string | null>(company.logoUrl ?? null)
  const [logoErr, setLogoErr] = useState<string | null>(null)
  const m = useMutation({ mutationFn: () => api.updateCompany({ displayName, businessType, timezone, workweekType, address }), onSuccess: onSaved })
  const logoM = useMutation({ mutationFn: (data: string) => api.uploadLogo(data), onSuccess: (c) => { setLogo(c.logoUrl ?? null); onSaved() }, onError: () => setLogoErr('Format/ukuran logo tidak didukung (≤1MB, PNG/JPG/SVG/WebP).') })
  const onLogo = (f: File | undefined) => {
    if (!f) return
    setLogoErr(null)
    const r = new FileReader(); r.onload = () => logoM.mutate(String(r.result)); r.readAsDataURL(f)
  }
  return (
    <Card>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
        <div className="flex items-center gap-3">
          <span className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-md bg-surface text-text-muted">
            {logo ? <img src={logo} alt="Logo" className="h-full w-full object-contain" /> : 'Logo'}
          </span>
          <label className="cursor-pointer">
            <span className="inline-flex min-h-touch items-center rounded-md border border-border px-4 text-sm font-semibold text-text hover:bg-surface">{logo ? 'Ganti logo' : 'Unggah logo'}</span>
            <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden" onChange={(e) => onLogo(e.target.files?.[0])} />
          </label>
          {logoErr && <span className="text-xs text-danger">{logoErr}</span>}
        </div>
        <Field label="Nama usaha"><Input value={displayName} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Jenis usaha"><Input value={businessType} onChange={(e) => setType(e.target.value)} /></Field>
        <div className="flex gap-2">
          <Field label="Zona waktu"><Select value={timezone} onChange={(e) => setTz((e.target as HTMLSelectElement).value)}><option>Asia/Jakarta</option><option>Asia/Makassar</option><option>Asia/Jayapura</option></Select></Field>
          <Field label="Minggu kerja" helper="Pengali lembur PP 35/2021"><Select value={workweekType} onChange={(e) => setWw((e.target as HTMLSelectElement).value)}><option value="six_day">6 hari</option><option value="five_day">5 hari</option></Select></Field>
        </div>
        <Field label="Alamat"><Input value={address} onChange={(e) => setAddr(e.target.value)} /></Field>
        <Button type="submit" loading={m.isPending}>{m.isSuccess ? 'Tersimpan ✓' : 'Simpan perusahaan'}</Button>
      </form>
    </Card>
  )
}

function PolicyForm({ policy, onSaved }: { policy: Policy; onSaved: () => void }) {
  const [mode, setMode] = useState(policy.lateDeductionMode)
  const [perMinuteRate, setRate] = useState(policy.lateDeductionConfig.perMinuteRate ?? 500)
  const [graceMinutes, setGrace] = useState(policy.lateDeductionConfig.graceMinutes ?? 10)
  const [flatAmount, setFlat] = useState(policy.lateDeductionConfig.flatAmount ?? 20000)
  const [mealOnOt, setMealOt] = useState(policy.mealAllowanceConfig.onOvertimeAmount ?? 25000)
  const [mealPerDay, setMealDay] = useState(policy.mealAllowanceConfig.perPresentDay ?? 0)
  const [strictGeofence, setStrict] = useState(policy.strictGeofence)
  const [accept, setAccept] = useState(policy.trustThresholds.accept)
  const [review, setReview] = useState(policy.trustThresholds.review)
  const [retention, setRetention] = useState(policy.photoRetentionDays)
  const [minRest, setMinRest] = useState((policy as any).minRestHours ?? 0)

  const [saved, setSaved] = useState(false)
  useEffect(() => { if (saved) { const t = setTimeout(() => setSaved(false), 1500); return () => clearTimeout(t) } }, [saved])

  const m = useMutation({
    mutationFn: () => api.updatePolicy({
      lateDeductionMode: mode,
      lateDeductionConfig: mode === 'per_minute' ? { perMinuteRate } : mode === 'grace_flat' ? { graceMinutes, flatAmount } : { tiers: [] },
      mealAllowanceConfig: { perPresentDay: mealPerDay, onOvertimeMinHours: 4, onOvertimeAmount: mealOnOt },
      strictGeofence,
      trustThresholds: { accept, review },
      photoRetentionDays: retention,
      minRestHours: minRest,
    }),
    onSuccess: () => { setSaved(true); onSaved() },
  })

  return (
    <Card>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
        <Field label="Mode potongan keterlambatan">
          <Select value={mode} onChange={(e) => setMode((e.target as HTMLSelectElement).value as any)}>
            <option value="per_minute">Per menit</option>
            <option value="grace_flat">Toleransi + potongan tetap</option>
            <option value="tiered">Berjenjang</option>
          </Select>
        </Field>
        {mode === 'per_minute' && <Field label="Tarif per menit (Rp)"><Input type="number" value={perMinuteRate} onChange={(e) => setRate(Number(e.target.value))} /></Field>}
        {mode === 'grace_flat' && (
          <div className="flex gap-2">
            <Field label="Toleransi (mnt)"><Input type="number" value={graceMinutes} onChange={(e) => setGrace(Number(e.target.value))} /></Field>
            <Field label="Potongan (Rp)"><Input type="number" value={flatAmount} onChange={(e) => setFlat(Number(e.target.value))} /></Field>
          </div>
        )}
        <div className="flex gap-2">
          <Field label="Uang makan / hari hadir (Rp)"><Input type="number" value={mealPerDay} onChange={(e) => setMealDay(Number(e.target.value))} /></Field>
          <Field label="Uang makan lembur ≥4 jam (Rp)"><Input type="number" value={mealOnOt} onChange={(e) => setMealOt(Number(e.target.value))} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-text"><input type="checkbox" checked={strictGeofence} onChange={(e) => setStrict(e.target.checked)} /> Mode ketat: tolak absen di luar geofence</label>
        <div className="flex gap-2">
          <Field label="Ambang diterima"><Input type="number" value={accept} onChange={(e) => setAccept(Number(e.target.value))} /></Field>
          <Field label="Ambang review"><Input type="number" value={review} onChange={(e) => setReview(Number(e.target.value))} /></Field>
          <Field label="Retensi foto (hari)"><Input type="number" value={retention} onChange={(e) => setRetention(Number(e.target.value))} /></Field>
          <Field label="Min. jeda antar-shift (jam)"><Input type="number" value={minRest} onChange={(e) => setMinRest(Number(e.target.value))} /></Field>
        </div>
        <Button type="submit" loading={m.isPending}>{saved ? 'Tersimpan ✓' : 'Simpan kebijakan'}</Button>
      </form>
    </Card>
  )
}
