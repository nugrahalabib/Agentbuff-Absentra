import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api/client'
import { pesanMasuk, URL_MASUK_AGENTBUFF } from '@/lib/pesanMasuk'
import { Button, Card, Field, Input, Select } from '@/components/ui'
import { IconCheck, IconMapPin, IconUser, IconInbox } from '@/components/ui/icons'
import { parseLatLong } from '@/lib/geoLink'

const BUSINESS_TYPES = ['Kuliner', 'Retail / Minimarket', 'Jasa (salon, bengkel, laundry)', 'Manufaktur kecil', 'Lainnya']
const TZ = ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura']

/** Extract an invite token from a pasted link (…/invite/<token>) or a bare token. */
function inviteTokenFrom(input: string): string {
  const s = input.trim()
  const m = s.match(/\/invite\/([A-Za-z0-9]+)/)
  return m ? m[1] : s
}

export function OnboardingPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  // 'choose' = baru daftar, belum jelas pemilik/karyawan; 'owner' = lanjut wizard.
  // Datang dari /daftar (?owner=1) → langsung wizard pemilik.
  const [intent, setIntent] = useState<'choose' | 'owner'>(() => (new URLSearchParams(location.search).get('owner') ? 'owner' : 'choose'))
  const [inviteInput, setInviteInput] = useState('')
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [galatBuat, setGalatBuat] = useState<string | null>(null)

  // step 0 — company
  const [displayName, setDisplayName] = useState('')
  const [businessType, setBusinessType] = useState(BUSINESS_TYPES[0])
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jakarta')
  const [workweekType, setWorkweek] = useState<'six_day' | 'five_day'>('six_day')
  const [address, setAddress] = useState('')

  // step 1 — branch + geofence
  const [branchName, setBranchName] = useState('Cabang Pusat')
  const [lat, setLat] = useState(-6.2)
  const [long, setLong] = useState(106.8166)
  const [radiusM, setRadius] = useState(100)

  // step 2 — divisions
  const [divisions, setDivisions] = useState<string[]>([])
  const [divInput, setDivInput] = useState('')

  // step 3 — shift
  const [shiftName, setShiftName] = useState('Shift Pagi')
  const [startTime, setStart] = useState('08:00')
  const [endTime, setEnd] = useState('17:00')
  const [tolerance, setTol] = useState(10)

  const steps = ['Perusahaan', 'Cabang', 'Divisi', 'Shift', 'Selesai']

  const createCompany = async () => {
    setBusy(true)
    setGalatBuat(null)
    try {
      await api.createCompany({ displayName, businessType, timezone, address: address || undefined, workweekType })
      await qc.invalidateQueries({ queryKey: ['me'] })
      setStep(1)
    } catch (err) {
      // Hanya pemilik yang masuk lewat AgentBuff (dan berhak) boleh membuat perusahaan.
      if (err instanceof ApiError && err.body?.error === 'perlu_agentbuff') {
        setGalatBuat(pesanMasuk(String(err.body?.reason ?? 'perlu_agentbuff')))
      } else {
        throw err
      }
    } finally { setBusy(false) }
  }
  const createBranch = async () => {
    setBusy(true)
    try { await api.createBranch({ name: branchName, lat, long, radiusM }); setStep(2) } finally { setBusy(false) }
  }
  const saveDivisions = async () => {
    setBusy(true)
    try { for (const d of divisions) await api.createDivision(d); setStep(3) } finally { setBusy(false) }
  }
  const createShift = async () => {
    setBusy(true)
    try { await api.createShiftTemplate({ name: shiftName, startTime, endTime, lateToleranceMinutes: tolerance }); setStep(4) } finally { setBusy(false) }
  }

  const useMyLocation = () => {
    navigator.geolocation?.getCurrentPosition((p) => { setLat(Number(p.coords.latitude.toFixed(6))); setLong(Number(p.coords.longitude.toFixed(6))) })
  }

  // Layar pilihan: pemilik (buat perusahaan) vs karyawan (punya undangan).
  if (intent === 'choose') {
    return (
      <div className="mx-auto max-w-lg px-5 py-10">
        <h1 className="text-2xl font-bold text-text">Selamat datang di Absentra 👋</h1>
        <p className="mt-1 text-sm text-text-muted">Pilih sesuai peranmu.</p>

        <Card className="mt-5">
          <button onClick={() => setIntent('owner')} className="flex w-full items-start gap-3 text-left">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><IconUser /></span>
            <span>
              <span className="block font-semibold text-text">Saya pemilik / mendirikan usaha</span>
              <span className="block text-sm text-text-muted">Buat perusahaan baru & jadi Owner (atur cabang, shift, karyawan).</span>
            </span>
          </button>
        </Card>

        <Card className="mt-3">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent"><IconInbox /></span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-text">Saya karyawan (punya undangan)</p>
              <p className="mb-2 text-sm text-text-muted">Tempel link atau kode undangan dari admin/pemilik. Kamu <strong>tidak perlu</strong> membuat perusahaan.</p>
              <div className="flex gap-2">
                <Input value={inviteInput} onChange={(e) => setInviteInput(e.target.value)} placeholder="https://…/invite/abc123  atau  abc123" />
                <Button disabled={!inviteInput.trim()} onClick={() => navigate(`/invite/${inviteTokenFrom(inviteInput)}`)}>Gabung</Button>
              </div>
            </div>
          </div>
        </Card>

        <p className="mt-4 text-center text-xs text-text-muted">Belum punya undangan? Minta admin tempat kerjamu membuat undangan untukmu.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg px-5 py-8">
      <button onClick={() => setIntent('choose')} className="mb-2 text-sm text-text-muted hover:text-primary">← Kembali</button>
      <h1 className="text-2xl font-bold text-text">Siapkan perusahaanmu</h1>
      <p className="mt-1 text-sm text-text-muted">Beberapa langkah singkat agar karyawan bisa langsung absen.</p>

      {/* Stepper */}
      <div className="my-5 flex items-center gap-1">
        {steps.map((s, i) => (
          <div key={s} className="flex flex-1 items-center gap-1">
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${i < step ? 'bg-success text-white' : i === step ? 'bg-primary text-on-primary' : 'bg-border text-text-muted'}`}>
              {i < step ? <IconCheck width={14} height={14} /> : i + 1}
            </span>
            {i < steps.length - 1 && <span className={`h-0.5 flex-1 ${i < step ? 'bg-success' : 'bg-border'}`} />}
          </div>
        ))}
      </div>

      <Card>
        {step === 0 && (
          <div className="flex flex-col gap-3">
            <Field label="Nama usaha"><Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="mis. Warung Bu Sari" /></Field>
            <Field label="Jenis usaha"><Select value={businessType} onChange={(e) => setBusinessType((e.target as HTMLSelectElement).value)}>{BUSINESS_TYPES.map((b) => <option key={b}>{b}</option>)}</Select></Field>
            <div className="flex gap-2">
              <Field label="Zona waktu"><Select value={timezone} onChange={(e) => setTimezone((e.target as HTMLSelectElement).value)}>{TZ.map((z) => <option key={z}>{z}</option>)}</Select></Field>
              <Field label="Minggu kerja" helper="Memengaruhi pengali lembur"><Select value={workweekType} onChange={(e) => setWorkweek((e.target as HTMLSelectElement).value as any)}><option value="six_day">6 hari/minggu</option><option value="five_day">5 hari/minggu</option></Select></Field>
            </div>
            <Field label="Alamat (opsional)"><Input value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
            {galatBuat && (
              <div className="rounded-md bg-warning/10 p-3 text-sm text-warning" role="alert">
                <p>{galatBuat}</p>
                <a href={`${URL_MASUK_AGENTBUFF}?next=/onboarding%3Fowner%3D1`} className="mt-2 inline-block font-semibold text-primary hover:underline">
                  Masuk dengan AgentBuff →
                </a>
              </div>
            )}
            <Button fullWidth loading={busy} disabled={!displayName} onClick={createCompany}>Lanjut</Button>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-muted">Tetapkan lokasi cabang. Karyawan harus berada dalam radius ini saat absen (geofence).</p>
            <Field label="Nama cabang"><Input value={branchName} onChange={(e) => setBranchName(e.target.value)} /></Field>
            <Field label="Link Google Maps" helper="Tempel link/koordinat dari Google Maps — lokasi terisi otomatis">
              <Input placeholder="https://maps.google.com/...  atau  -6.2, 106.8166" onChange={(e) => { const p = parseLatLong(e.target.value); if (p) { setLat(p.lat); setLong(p.long) } }} />
            </Field>
            <div className="flex gap-2">
              <Field label="Latitude"><Input type="number" step="0.0001" value={lat} onChange={(e) => setLat(Number(e.target.value))} /></Field>
              <Field label="Longitude"><Input type="number" step="0.0001" value={long} onChange={(e) => setLong(Number(e.target.value))} /></Field>
            </div>
            <Button variant="secondary" onClick={useMyLocation}><IconMapPin width={16} height={16} /> Gunakan lokasi saya</Button>
            <Field label={`Radius geofence: ${radiusM} m`}>
              <input type="range" min={30} max={500} step={10} value={radiusM} onChange={(e) => setRadius(Number(e.target.value))} className="w-full" />
            </Field>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep(0)}>Kembali</Button>
              <Button fullWidth loading={busy} disabled={!branchName} onClick={createBranch}>Lanjut</Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-muted">Kelompok kerja (opsional), mis. Dapur, Kasir, Gudang — sesuai usahamu.</p>
            <div className="flex gap-2">
              <Input value={divInput} onChange={(e) => setDivInput(e.target.value)} placeholder="Nama divisi" onKeyDown={(e) => { if (e.key === 'Enter' && divInput.trim()) { setDivisions([...divisions, divInput.trim()]); setDivInput('') } }} />
              <Button variant="secondary" onClick={() => { if (divInput.trim()) { setDivisions([...divisions, divInput.trim()]); setDivInput('') } }}>Tambah</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {divisions.map((d, i) => (
                <span key={i} className="flex items-center gap-1 rounded-full bg-surface px-3 py-1 text-sm">
                  {d} <button onClick={() => setDivisions(divisions.filter((_, j) => j !== i))} className="text-text-muted">×</button>
                </span>
              ))}
              {divisions.length === 0 && <span className="text-sm text-text-muted">Belum ada — boleh dilewati.</span>}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep(1)}>Kembali</Button>
              <Button fullWidth loading={busy} onClick={saveDivisions}>{divisions.length ? 'Simpan & lanjut' : 'Lewati'}</Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-3">
            <Field label="Nama shift"><Input value={shiftName} onChange={(e) => setShiftName(e.target.value)} /></Field>
            <div className="flex gap-2">
              <Field label="Mulai"><Input type="time" value={startTime} onChange={(e) => setStart(e.target.value)} /></Field>
              <Field label="Selesai"><Input type="time" value={endTime} onChange={(e) => setEnd(e.target.value)} /></Field>
            </div>
            <Field label="Toleransi terlambat (menit)"><Input type="number" value={tolerance} onChange={(e) => setTol(Number(e.target.value))} /></Field>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep(2)}>Kembali</Button>
              <Button fullWidth loading={busy} onClick={createShift}>Selesai</Button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success/10 text-success"><IconCheck width={30} height={30} /></span>
            <p className="text-lg font-semibold text-text">Perusahaan siap! 🎉</p>
            <p className="text-sm text-text-muted">Langkah berikutnya: undang karyawan & atur jadwal shift.</p>
            <div className="flex w-full gap-2">
              <Button variant="secondary" fullWidth onClick={() => navigate('/karyawan')}>Undang karyawan</Button>
              <Button fullWidth onClick={() => navigate('/dashboard')}>Ke Dashboard</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
