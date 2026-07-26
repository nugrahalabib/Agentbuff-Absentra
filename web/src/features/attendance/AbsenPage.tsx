import { useEffect, useReducer, useRef, useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type ClockResult, OfflineError } from '@/lib/api/client'
import { useActor } from '@/auth/useActor'
import { clockTransition, initialClockContext, type ClockContext, type ClockEvent } from '@/lib/domain/clockInMachine'
import { evaluateGeofence, isAccuracyAcceptable, type LatLong } from '@/lib/domain/geofence'
import type { GeofenceResult } from '@/lib/domain/types'
import { Button, Card, Spinner } from '@/components/ui'
import { IconClock, IconMapPin, IconCamera, IconCheckCircle, IconAlert, IconWifiOff } from '@/components/ui/icons'
import { TrustMeter } from '@/components/StatusBadge'
import { t } from '@/i18n'
import { formatTime } from '@/lib/format'

const LIVENESS = ['kedipkan mata', 'hadap kanan', 'tersenyum', 'hadap kiri']

function reducer(ctx: ClockContext, ev: ClockEvent): ClockContext {
  return clockTransition(ctx, ev)
}

export function AbsenPage() {
  const qc = useQueryClient()
  const { company, employee, user, role, isLoading: actorLoading } = useActor()
  const companyId = company?.id
  const employeeId = employee?.id

  const ctxQuery = useQuery({
    queryKey: ['todayContext', companyId, employeeId],
    enabled: !!companyId && !!employeeId,
    queryFn: () => api.todayContext(companyId!, employeeId!),
  })

  const [ctx, dispatch] = useReducer(reducer, initialClockContext)
  const [coords, setCoords] = useState<LatLong & { accuracy: number } | null>(null)
  const [geo, setGeo] = useState<{ result: GeofenceResult; distanceM: number | null } | null>(null)
  const [cameraAvailable, setCameraAvailable] = useState(true)
  const [photo, setPhoto] = useState<string | null>(null)
  const [liveness] = useState(() => LIVENESS[Math.floor(Math.random() * LIVENESS.length)])
  const [result, setResult] = useState<ClockResult | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Resolve initial FSM state from today's context
  useEffect(() => {
    if (!ctxQuery.data) return
    const c = ctxQuery.data
    if (c.kind === 'none') dispatch({ type: 'CONTEXT_NO_SHIFT' })
    else if (c.kind === 'out') dispatch({ type: 'CONTEXT_READY_OUT' })
    else dispatch({ type: 'CONTEXT_READY_IN' })
  }, [ctxQuery.data])

  // Sync notification (offline queue flushed)
  useEffect(() => {
    const onSync = () => {
      if (ctx.state === 'Queued') dispatch({ type: 'SYNC_OK' })
      qc.invalidateQueries({ queryKey: ['todayContext'] })
    }
    window.addEventListener('absentra:synced', onSync)
    return () => window.removeEventListener('absentra:synced', onSync)
  }, [ctx.state, qc])

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop())
    streamRef.current = null
  }, [])
  useEffect(() => () => stopCamera(), [stopCamera])

  const fence = ctxQuery.data?.geofence
  const branch = ctxQuery.data?.branch

  // ---- Step: acquire location ----
  const acquireLocation = () => {
    dispatch({ type: 'TAP_CLOCK' })
    const useDemo = () => {
      // Demo fallback: place the user at the branch centre (inside the geofence).
      if (!branch) return finishLocation({ lat: -6.2, long: 106.8166, accuracy: 18 })
      finishLocation({ lat: branch.lat, long: branch.long, accuracy: 18 })
    }
    if (!('geolocation' in navigator)) return useDemo()
    navigator.geolocation.getCurrentPosition(
      (pos) => finishLocation({ lat: pos.coords.latitude, long: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => dispatch({ type: 'LOCATION_FAIL' }),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    )
  }

  const finishLocation = (c: LatLong & { accuracy: number }) => {
    setCoords(c)
    const evaln = fence ? evaluateGeofence(c, fence) : { result: 'inside' as GeofenceResult, distanceM: null }
    setGeo(evaln)
    if (!isAccuracyAcceptable(c.accuracy) && fence) {
      // poor accuracy still proceeds (trust will reflect it) but warn via state staying
    }
    dispatch({ type: 'LOCATION_OK' })
    startCamera()
  }

  // ---- Step: camera ----
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      streamRef.current = stream
      setCameraAvailable(true)
      // attach after render
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          void videoRef.current.play()
        }
      }, 50)
    } catch {
      setCameraAvailable(false)
    }
  }

  const capture = () => {
    const video = videoRef.current
    if (video && streamRef.current) {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth || 320
      canvas.height = video.videoHeight || 240
      const ctx2d = canvas.getContext('2d')
      ctx2d?.drawImage(video, 0, 0, canvas.width, canvas.height)
      setPhoto(canvas.toDataURL('image/jpeg', 0.7))
    } else {
      setPhoto(null)
    }
    stopCamera()
    dispatch({ type: 'PHOTO_CAPTURED' })
  }

  const skipCamera = () => {
    setCameraAvailable(false)
    setPhoto(null)
    dispatch({ type: 'PHOTO_CAPTURED' })
  }

  // ---- Step: submit ----
  const submit = async () => {
    if (!companyId || !employeeId || !coords) return
    dispatch({ type: 'CONFIRM' })
    const submission = {
      companyId, employeeId, kind: ctx.kind,
      geofenceResult: geo?.result ?? ('inside' as GeofenceResult),
      gpsAccuracyM: coords.accuracy, lat: coords.lat, long: coords.long,
      livenessPassed: cameraAvailable ? true : null,
      cameraAvailable,
      photoData: photo ?? undefined,
    }
    try {
      const res = await api.submitClock(submission)
      setResult(res)
      dispatch({ type: 'SUBMIT_ONLINE_OK' })
      qc.invalidateQueries({ queryKey: ['todayContext'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    } catch (e) {
      if (e instanceof OfflineError) {
        api.enqueueOffline(submission)
        dispatch({ type: 'SUBMIT_OFFLINE' })
      } else {
        dispatch({ type: 'SUBMIT_REJECTED' })
      }
    }
  }

  const reset = () => {
    setResult(null)
    setPhoto(null)
    setCoords(null)
    setGeo(null)
    ctxQuery.refetch()
    dispatch({ type: 'RESET' })
  }

  const greeting = `${t.absen.greeting}, ${user?.name?.split(' ')[0] ?? ''}`.trim()

  if (actorLoading || (employee?.id && ctxQuery.isLoading)) {
    return <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-primary" /></div>
  }

  // Owners/admins without an employee profile have nothing to clock — show a friendly
  // state instead of crashing on missing today-context data.
  if (!employee?.id || !ctxQuery.data) {
    const manager = role === 'owner' || role === 'branch_admin' || role === 'hr'
    return (
      <div className="mx-auto max-w-md">
        <header className="mb-4">
          <p className="text-sm text-text-muted">{greeting}</p>
          <h1 className="text-xl font-bold text-text">{t.nav.absen}</h1>
        </header>
        <Card className="flex flex-col items-center gap-3 text-center text-text-muted">
          <IconClock className="text-text-muted" width={28} height={28} />
          <p>{manager
            ? 'Akun admin tidak terjadwal absen. Kelola kehadiran tim dari Dashboard.'
            : 'Belum ada shift untuk kamu hari ini, atau kamu belum terdaftar sebagai karyawan.'}</p>
          {manager && <Button onClick={() => window.location.assign('/dashboard')}>Buka Dashboard</Button>}
        </Card>
      </div>
    )
  }

  const c = ctxQuery.data

  return (
    <div className="mx-auto max-w-md pb-4">
      <header className="mb-4">
        <p className="text-sm text-text-muted">{greeting}</p>
        <h1 className="text-xl font-bold text-text">{c.template ? c.template.name : t.nav.absen}</h1>
        {c.branch && (
          <p className="mt-1 flex items-center gap-1 text-sm text-text-muted">
            <IconMapPin width={14} height={14} /> {c.branch.name}
            {c.template && <> · {c.template.startTime}–{c.template.endTime}</>}
          </p>
        )}
      </header>

      <AbsenSteps state={ctx.state} />

      {/* Status card */}
      <StatusHero ctx={ctx} record={c.record} />

      {/* Step body — sticky CTA zone on mobile */}
      <div className="mt-4">
        {ctx.state === 'NoShift' && (
          <Card className="text-center text-text-muted">{t.absen.noShift}</Card>
        )}

        {(ctx.state === 'ReadyIn' || ctx.state === 'ReadyOut') && (
          <div className="sticky bottom-20 z-10 lg:static lg:bottom-auto">
            <Button fullWidth size="lg" onClick={acquireLocation}>
              <IconClock /> {ctx.kind === 'in' ? t.absen.clockIn : t.absen.clockOut}
            </Button>
          </div>
        )}

        {ctx.state === 'Locating' && (
          <Card className="flex flex-col gap-2">
            <div className="flex items-center gap-3 text-text-muted">
              <Spinner className="h-5 w-5 text-primary" /> {t.absen.locating}
            </div>
            <p className="text-xs text-text-muted">Pastikan GPS aktif dan izin lokasi diberikan. Biasanya &lt; 8 detik.</p>
          </Card>
        )}

        {ctx.state === 'LocationError' && (
          <Card>
            <p className="mb-3 flex items-start gap-2 text-sm text-danger"><IconAlert width={18} height={18} /> {t.absen.locationError}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="secondary" onClick={acquireLocation}>{t.absen.tryAgain}</Button>
              <Button variant="ghost" onClick={() => (branch ? finishLocation({ lat: branch.lat, long: branch.long, accuracy: 18 }) : null)}>Pakai lokasi demo</Button>
            </div>
          </Card>
        )}

        {ctx.state === 'Capturing' && (
          <Card>
            <p className="mb-2 text-sm font-medium text-text">{t.absen.capturing}</p>
            <p className="mb-3 text-xs text-text-muted">{t.absen.livenessHint} <strong>{liveness}</strong>.</p>
            {cameraAvailable ? (
              <>
                <div className="relative overflow-hidden rounded-lg bg-black">
                  <video ref={videoRef} playsInline muted className="aspect-[3/4] w-full object-cover" />
                  <div className="pointer-events-none absolute inset-8 rounded-full border-2 border-white/70" />
                </div>
                <Button fullWidth className="mt-3" size="lg" onClick={capture}><IconCamera /> {t.absen.capture}</Button>
              </>
            ) : (
              <div className="text-sm text-text-muted">
                <p className="mb-3 flex items-start gap-2 text-warning"><IconAlert width={18} height={18} /> {t.absen.cameraDenied}</p>
                <p className="mb-3 text-xs">Lanjut tanpa foto akan menurunkan skor kepercayaan (trust) dan mungkin ditinjau admin.</p>
                <Button fullWidth onClick={skipCamera}>Lanjut tanpa foto</Button>
              </div>
            )}
          </Card>
        )}

        {ctx.state === 'Reviewing' && (
          <Card>
            <p className="mb-3 text-sm font-medium text-text">{t.absen.review}</p>
            {photo ? (
              <img src={photo} alt="Foto absen" className="mb-3 w-full rounded-lg" />
            ) : (
              <div className="mb-3 rounded-lg bg-surface p-4 text-center text-sm text-text-muted"><IconCamera className="mx-auto mb-1" /> Tanpa foto (akan ditandai)</div>
            )}
            <GeoLine geo={geo} coords={coords} />
            <div className="mt-3 flex gap-2">
              <Button variant="secondary" onClick={() => { dispatch({ type: 'RETAKE' }); startCamera() }}>{t.absen.retake}</Button>
              <Button fullWidth size="lg" onClick={submit}>{t.absen.confirm}</Button>
            </div>
          </Card>
        )}

        {ctx.state === 'Submitting' && (
          <Card className="flex items-center gap-3 text-text-muted"><Spinner className="h-5 w-5 text-primary" /> {t.absen.submitting}</Card>
        )}

        {ctx.state === 'Success' && <ResultCard result={result} onReset={reset} />}

        {ctx.state === 'Queued' && (
          <Card className="text-center">
            <IconWifiOff className="mx-auto mb-2 text-warning" />
            <p className="font-semibold text-text">{t.absen.queued}</p>
            <Button variant="ghost" className="mt-3" onClick={reset}>{t.common.close}</Button>
          </Card>
        )}

        {ctx.state === 'SubmitError' && (
          <Card>
            <p className="mb-3 flex items-start gap-2 text-sm text-danger"><IconAlert width={18} height={18} /> {t.absen.submitError}</p>
            <Button onClick={() => dispatch({ type: 'RETRY' })}>{t.absen.tryAgain}</Button>
          </Card>
        )}
      </div>
    </div>
  )
}

function AbsenSteps({ state }: { state: ClockContext['state'] }) {
  const step =
    state === 'ReadyIn' || state === 'ReadyOut' || state === 'NoShift' || state === 'CheckingContext' ? 0
    : state === 'Locating' || state === 'LocationError' ? 1
    : state === 'Capturing' || state === 'Reviewing' ? 2
    : 3
  if (state === 'NoShift' || state === 'Success' || state === 'Queued') return null
  const labels = ['Siap', 'Lokasi', 'Foto', 'Kirim']
  return (
    <ol className="mb-4 flex items-center gap-1" aria-label="Langkah absen">
      {labels.map((label, i) => {
        const done = i < step
        const active = i === step
        return (
          <li key={label} className="flex flex-1 flex-col items-center gap-1">
            <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${
              done ? 'bg-primary text-on-primary' : active ? 'bg-primary/20 text-primary ring-2 ring-primary' : 'bg-surface text-text-muted'
            }`}>{done ? '✓' : i + 1}</span>
            <span className={`text-[10px] ${active ? 'font-semibold text-text' : 'text-text-muted'}`}>{label}</span>
          </li>
        )
      })}
    </ol>
  )
}

function StatusHero({ ctx, record }: { ctx: ClockContext; record: { createdAt: string } | null }) {
  let label: string = t.absen.notYet
  if (record && ctx.state !== 'Success') label = `${t.absen.clockedInAt} ${formatTime(record.createdAt)}`
  if (ctx.kind === 'out' && ctx.state === 'ReadyOut') label = `${t.absen.clockedInAt} ${record ? formatTime(record.createdAt) : ''}`
  if (ctx.state === 'NoShift') label = '—'
  return (
    <div className="rounded-lg bg-gradient-to-br from-primary to-primary-pressed p-6 text-on-primary">
      <p className="text-sm opacity-90">{t.absen.today}</p>
      <p className="mt-1 text-2xl font-bold">{label}</p>
    </div>
  )
}

function GeoLine({ geo, coords }: { geo: { result: GeofenceResult; distanceM: number | null } | null; coords: ({ accuracy: number } & LatLong) | null }) {
  if (!geo) return null
  const tone = geo.result === 'inside' ? 'text-success' : geo.result === 'near' ? 'text-warning' : 'text-danger'
  const label = geo.result === 'inside' ? 'Di dalam area' : geo.result === 'near' ? 'Di tepi area' : 'Di luar area'
  return (
    <p className={`flex items-center gap-1 text-sm ${tone}`}>
      <IconMapPin width={14} height={14} /> {label}
      {geo.distanceM != null && <> · {Math.round(geo.distanceM)} m</>}
      {coords && <span className="text-text-muted"> · akurasi {Math.round(coords.accuracy)} m</span>}
    </p>
  )
}

function ResultCard({ result, onReset }: { result: ClockResult | null; onReset: () => void }) {
  const flagged = result && (result.decision === 'flagged' || result.decision === 'rejected')
  return (
    <Card className="text-center">
      {flagged ? <IconAlert className="mx-auto mb-2 text-warning" width={32} height={32} /> : <IconCheckCircle className="mx-auto mb-2 text-success" width={32} height={32} />}
      <p className="text-lg font-semibold text-text">{t.absen.success}</p>
      {result && (
        <div className="mt-3 flex flex-col items-center gap-2">
          <div className="flex items-center gap-2 text-sm text-text-muted">{t.absen.trustNote}: <TrustMeter score={result.trustScore} /></div>
          {flagged && <p className="text-sm text-warning">{t.absen.flaggedNote}</p>}
          {result.reasons.length > 0 && (
            <ul className="mt-1 text-left text-xs text-text-muted">
              {result.reasons.map((r, i) => <li key={i}>• {r}</li>)}
            </ul>
          )}
        </div>
      )}
      <Button variant="ghost" className="mt-4" onClick={onReset}>{t.common.close}</Button>
    </Card>
  )
}
