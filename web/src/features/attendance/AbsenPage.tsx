/**
 * Absen (layar yang paling sering dibuka karyawan, HP dulu).
 * Alur = mesin keadaan eksplisit (lib/domain/clockInMachine): Siap → Lokasi → Foto →
 * Periksa → Kirim → Berhasil | Tersimpan (offline) | Gagal. Maskot ikut keadaan:
 * selfie saat siap/foto, peta saat cari lokasi, pulang saat tinggal absen keluar,
 * cuti saat libur.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, OfflineError, type ClockResult, type TodayContext } from '@/lib/api/client'
import { useActor } from '@/auth/useActor'
import { clockTransition, initialClockContext, type ClockContext } from '@/lib/domain/clockInMachine'
import { evaluateGeofence, isAccuracyAcceptable, type LatLong } from '@/lib/domain/geofence'
import type { GeofenceResult } from '@/lib/domain/types'
import { Button, Card, Centang, PesanGalat, Spinner, cx } from '@/components/ui'
import { Gelembung, Maskot, type PoseMaskot } from '@/components/merek'
import {
  IconAlert, IconCalendar, IconCamera, IconCheckCircle, IconChevronRight, IconClock, IconHistory, IconInbox, IconMapPin, IconRefresh, IconWifiOff,
} from '@/components/ui/icons'
import { formatTime, hariIniPanjang, sapaanWaktu, todayISODate, zonaWaktu } from '@/lib/format'
import { pesanGalat } from '@/lib/galat'

const ARAHAN_FOTO = ['Senyum sedikit ke kamera ya', 'Pastikan wajahmu kelihatan jelas', 'Hadap lurus ke kamera', 'Cari tempat yang cukup terang']

type Koordinat = LatLong & { accuracy: number }
type HasilGeo = { result: GeofenceResult; distanceM: number | null }

export default function AbsenPage() {
  const qc = useQueryClient()
  const { company, employeeId, user, consentLocation, consentPhoto } = useActor()
  const companyId = company?.id
  const hariIni = todayISODate()

  const ctxQuery = useQuery({
    queryKey: ['todayContext', companyId, employeeId],
    enabled: !!companyId && !!employeeId,
    queryFn: () => api.todayContext(),
    refetchInterval: 60_000,
  })
  const catatanHariIni = useQuery({
    queryKey: ['myAttendance', 'hari-ini', hariIni],
    enabled: !!employeeId,
    queryFn: () => api.myAttendance(hariIni, hariIni),
  })

  const [ctx, dispatch] = useReducer(clockTransition, initialClockContext)
  const [koordinat, setKoordinat] = useState<Koordinat | null>(null)
  const [geo, setGeo] = useState<HasilGeo | null>(null)
  const [kameraAda, setKameraAda] = useState(true)
  const [foto, setFoto] = useState<string | null>(null)
  const [arahan] = useState(() => ARAHAN_FOTO[Math.floor(Math.random() * ARAHAN_FOTO.length)])
  const [hasil, setHasil] = useState<ClockResult | null>(null)
  const [galatKirim, setGalatKirim] = useState<string | null>(null)
  const [videoSiap, setVideoSiap] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const hidupRef = useRef(true)
  const kameraDiminta = useRef(false)

  // Absen milik akun ini yang masih menunggu sinyal (dikirim otomatis oleh AppShell).
  const [tertunda, setTertunda] = useState(() => api.antreanSaya())
  useEffect(() => {
    const ubah = () => setTertunda(api.antreanSaya())
    window.addEventListener('absentra:antrean', ubah)
    ubah()
    return () => window.removeEventListener('absentra:antrean', ubah)
  }, [])
  const tertundaHariIni = tertunda.filter((x) => tanggalDi(x.eventTimeClient) === hariIni)
  const terakhirTertunda = tertundaHariIni[tertundaHariIni.length - 1]

  // Keadaan awal hanya ditentukan dari konteks hari ini saat sedang istirahat
  // (bukan di tengah alur), supaya kartu "berhasil" tidak hilang sendiri.
  useEffect(() => {
    const c = ctxQuery.data
    if (!c) return
    const istirahat = ctx.state === 'CheckingContext' || ctx.state === 'ReadyIn' || ctx.state === 'ReadyOut' || ctx.state === 'NoShift'
    if (!istirahat) return
    // Absen masuk yang masih di antrean dihitung sudah terjadi: berikutnya absen keluar.
    const kind = c.kind === 'in' && terakhirTertunda?.kind === 'in' ? 'out' : c.kind
    if (kind === 'none') { if (ctx.state !== 'NoShift') dispatch({ type: 'CONTEXT_NO_SHIFT' }) }
    else if (kind === 'out') { if (ctx.state !== 'ReadyOut') dispatch({ type: 'CONTEXT_READY_OUT' }) }
    else if (ctx.state !== 'ReadyIn') dispatch({ type: 'CONTEXT_READY_IN' })
  }, [ctxQuery.data, ctx.state, terakhirTertunda?.kind])

  useEffect(() => {
    const onSync = () => {
      if (ctx.state === 'Queued') dispatch({ type: 'SYNC_OK' })
      qc.invalidateQueries({ queryKey: ['todayContext'] })
    }
    window.addEventListener('absentra:synced', onSync)
    return () => window.removeEventListener('absentra:synced', onSync)
  }, [ctx.state, qc])

  const matikanKamera = useCallback(() => {
    kameraDiminta.current = false
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])
  useEffect(() => {
    hidupRef.current = true
    return () => { hidupRef.current = false; matikanKamera() }
  }, [matikanKamera])

  const konteks = ctxQuery.data
  const pagar = konteks?.geofence ?? null

  const nyalakanKamera = async () => {
    kameraDiminta.current = true
    setVideoSiap(false)
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('tidak ada kamera')
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 960 } }, audio: false })
      // Izin kamera bisa datang belakangan: kalau halaman sudah ditinggal atau pengguna
      // sudah memilih tanpa foto, langsung matikan supaya lampu kamera tidak menyala sendiri.
      if (!hidupRef.current || !kameraDiminta.current) { stream.getTracks().forEach((t) => t.stop()); return }
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = stream
      setKameraAda(true)
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          void videoRef.current.play().catch(() => undefined)
        }
      })
    } catch {
      if (hidupRef.current && kameraDiminta.current) setKameraAda(false)
    }
  }

  const selesaiLokasi = (c: Koordinat) => {
    if (!hidupRef.current) return
    setKoordinat(c)
    setGeo(pagar ? evaluateGeofence(c, pagar) : { result: 'inside', distanceM: null })
    dispatch({ type: 'LOCATION_OK' })
    if (consentPhoto === false) { setKameraAda(false) } else void nyalakanKamera()
  }

  const cariLokasi = () => {
    setGalatKirim(null)
    dispatch({ type: 'TAP_CLOCK' })
    if (!('geolocation' in navigator)) {
      if (import.meta.env.DEV && konteks?.branch) return selesaiLokasi({ lat: konteks.branch.lat, long: konteks.branch.long, accuracy: 18 })
      dispatch({ type: 'LOCATION_FAIL' })
      return
    }
    navigator.geolocation.getCurrentPosition(
      (p) => selesaiLokasi({ lat: p.coords.latitude, long: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => { if (hidupRef.current) dispatch({ type: 'LOCATION_FAIL' }) },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 },
    )
  }

  const ambilFoto = () => {
    const video = videoRef.current
    if (video && streamRef.current && video.videoWidth) {
      // Perkecil ke lebar maks 640px: cukup jelas untuk admin, ringan dikirim lewat sinyal pas-pasan.
      const skala = Math.min(1, 640 / video.videoWidth)
      const kanvas = document.createElement('canvas')
      kanvas.width = Math.round(video.videoWidth * skala)
      kanvas.height = Math.round(video.videoHeight * skala)
      const c2 = kanvas.getContext('2d')
      if (c2) {
        c2.translate(kanvas.width, 0)
        c2.scale(-1, 1) // seperti cermin, sama dengan pratinjau
        c2.drawImage(video, 0, 0, kanvas.width, kanvas.height)
      }
      setFoto(kanvas.toDataURL('image/jpeg', 0.72))
    } else {
      setFoto(null)
    }
    matikanKamera()
    dispatch({ type: 'PHOTO_CAPTURED' })
  }

  const tanpaFoto = () => {
    matikanKamera()
    setKameraAda(false)
    setFoto(null)
    dispatch({ type: 'PHOTO_CAPTURED' })
  }

  const kirim = async () => {
    if (!koordinat) return
    dispatch({ type: 'CONFIRM' })
    setGalatKirim(null)
    try {
      const res = await api.submitClock({
        kind: ctx.kind,
        geofenceResult: geo?.result ?? 'inside',
        gpsAccuracyM: koordinat.accuracy,
        lat: koordinat.lat,
        long: koordinat.long,
        livenessPassed: null,
        cameraAvailable: !!foto,
        photoData: foto ?? undefined,
      })
      setHasil(res)
      dispatch({ type: 'SUBMIT_ONLINE_OK' })
      qc.invalidateQueries({ queryKey: ['todayContext'] })
      qc.invalidateQueries({ queryKey: ['myAttendance'] })
    } catch (e) {
      if (e instanceof OfflineError) {
        dispatch({ type: 'SUBMIT_OFFLINE' })
      } else {
        setGalatKirim(pesanGalat(e, 'Absen belum terkirim. Coba lagi ya.'))
        dispatch({ type: 'SUBMIT_REJECTED' })
      }
    }
  }

  const ulangi = () => {
    setHasil(null)
    setFoto(null)
    setKoordinat(null)
    setGeo(null)
    setGalatKirim(null)
    dispatch({ type: 'RESET' })
    void ctxQuery.refetch()
    void catatanHariIni.refetch()
  }

  const namaDepan = user?.name?.split(' ')[0] ?? ''
  if (!ctxQuery.data && (ctxQuery.isLoading || !employeeId)) {
    return <div className="flex justify-center py-24 text-tinta-3"><Spinner className="h-6 w-6" /></div>
  }
  if (ctxQuery.isError || !konteks) {
    return (
      <div className="mx-auto max-w-xl">
        <Card className="text-center">
          <p className="text-[17px] font-semibold text-tinta">Jadwal hari ini belum bisa dimuat.</p>
          <p className="mt-1 text-[14px] text-tinta-3">{pesanGalat(ctxQuery.error)}</p>
          <Button variant="secondary" className="mt-4" onClick={() => ctxQuery.refetch()}><IconRefresh width={18} height={18} /> Coba lagi</Button>
        </Card>
      </div>
    )
  }

  const hariIniRow = catatanHariIni.data?.[0]
  const selesaiHariIni = konteks.kind === 'none' && !!konteks.record
  const libur = konteks.kind === 'none' && !konteks.record
  const pose: PoseMaskot =
    ctx.state === 'Locating' || ctx.state === 'LocationError' ? 'peta'
    : ctx.state === 'Success' ? 'selfie'
    : selesaiHariIni || ctx.state === 'ReadyOut' ? 'pulang'
    : libur ? 'cuti'
    : 'selfie'
  const kalimat = kalimatMaskot(ctx, konteks, selesaiHariIni, libur, hariIniRow?.clockInAt ?? konteks.record?.createdAt ?? null, hariIniRow?.clockOutAt ?? null)
  const perluPersetujuan = consentLocation === false
  const dalamAlur = ['Locating', 'LocationError', 'Capturing', 'Reviewing', 'Submitting', 'SubmitError'].includes(ctx.state)

  return (
    <div className="mx-auto max-w-xl lg:max-w-5xl">
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8">
        <div className="min-w-0">
          {/* Sapaan + maskot */}
          <section className="relative flex items-end gap-3">
            <div className="min-w-0 flex-1 pb-2">
              <p className="text-[14px] font-medium text-tinta-3">{hariIniPanjang()}</p>
              <h1 className="mt-1 text-[32px] font-bold leading-[1.05] tracking-[-0.035em] text-tinta sm:text-[38px]">
                {sapaanWaktu()},<br className="sm:hidden" /> {namaDepan}.
              </h1>
            </div>
            <div className="relative -mb-2 shrink-0 lg:hidden">
              <div className="cahaya-aksen absolute -inset-4" />
              <Maskot pose={pose} ukuran="kecil" prioritas className="relative" />
            </div>
          </section>

          <Gelembung className="mt-4">{kalimat}</Gelembung>

          {/* Info shift */}
          {konteks.template && (
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="kaca-pil inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[14px] font-medium text-tinta">
                <IconClock width={16} height={16} className="text-tinta-3" /> {konteks.template.name} · {konteks.template.startTime} sampai {konteks.template.endTime}
                {konteks.template.crossesMidnight && ' (besok)'}
              </span>
              {konteks.branch && (
                <span className="kaca-pil inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[14px] font-medium text-tinta">
                  <IconMapPin width={16} height={16} className="text-tinta-3" /> {konteks.branch.name}
                </span>
              )}
            </div>
          )}

          <section className="kaca-panel mt-4 rounded-[28px] p-5 sm:p-6" aria-live="polite">
            {dalamAlur && <LangkahAbsen state={ctx.state} />}

            {perluPersetujuan && (ctx.state === 'ReadyIn' || ctx.state === 'ReadyOut') ? (
              <Persetujuan onSelesai={() => qc.invalidateQueries({ queryKey: ['me'] })} />
            ) : (
              <>
                {(ctx.state === 'ReadyIn' || ctx.state === 'ReadyOut') && terakhirTertunda && (
                  <div className="mb-4 flex items-start gap-3 rounded-[20px] bg-perlu-lembut px-4 py-3">
                    <IconWifiOff width={20} height={20} className="mt-0.5 shrink-0 text-perlu" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-semibold text-tinta">
                        {terakhirTertunda.kind === 'out' ? 'Absen keluarmu' : 'Absen masukmu'} jam {formatTime(terakhirTertunda.eventTimeClient)} menunggu sinyal
                      </p>
                      <p className="mt-0.5 text-[13px] text-tinta-2">Terkirim otomatis begitu online, dengan jam aslinya.</p>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => window.dispatchEvent(new CustomEvent('absentra:kirim-antrean'))}>Kirim</Button>
                  </div>
                )}
                {(ctx.state === 'ReadyIn' || ctx.state === 'ReadyOut') && terakhirTertunda?.kind !== 'out' && (
                  <TombolAbsen kind={ctx.kind} onClick={cariLokasi} masukJam={hariIniRow?.clockInAt ?? konteks.record?.createdAt ?? (terakhirTertunda?.kind === 'in' ? terakhirTertunda.eventTimeClient : null)} />
                )}

                {ctx.state === 'NoShift' && (
                  selesaiHariIni ? (
                    <Selesai masuk={hariIniRow?.clockInAt ?? konteks.record?.createdAt ?? null} keluar={hariIniRow?.clockOutAt ?? null} />
                  ) : (
                    <div className="py-2 text-center">
                      <p className="text-[18px] font-semibold text-tinta">Tidak ada shift hari ini</p>
                      <p className="mt-1 text-[14px] text-tinta-3">Kalau seharusnya kamu masuk, minta atasanmu menambahkan jadwal.</p>
                      <Link to="/jadwal" className="tombol-kaca mt-4 inline-flex min-h-[46px] items-center gap-2 rounded-full px-5 text-[15px] font-semibold">
                        <IconCalendar width={18} height={18} /> Lihat jadwalku
                      </Link>
                    </div>
                  )
                )}

                {ctx.state === 'Locating' && (
                  <div className="flex flex-col items-center py-6 text-center">
                    <span className="relative flex h-16 w-16 items-center justify-center">
                      <span className="cincin-denyut absolute inset-0 rounded-full bg-aksen/30" />
                      <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-aksen-lembut text-aksen-teks"><IconMapPin width={26} height={26} /></span>
                    </span>
                    <p className="mt-4 text-[17px] font-semibold text-tinta">Mencari lokasimu...</p>
                    <p className="mt-1 text-[14px] text-tinta-3">Biasanya kurang dari 10 detik. Pastikan GPS menyala.</p>
                  </div>
                )}

                {ctx.state === 'LocationError' && (
                  <div className="flex flex-col gap-4">
                    <div className="flex gap-3">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-perlu-lembut text-perlu"><IconAlert width={22} height={22} /></span>
                      <div>
                        <p className="text-[17px] font-semibold text-tinta">Lokasimu belum terbaca</p>
                        <p className="mt-1 text-[14px] text-tinta-2">Nyalakan GPS dan izinkan lokasi untuk Absentra di pengaturan peramban, lalu coba lagi.</p>
                      </div>
                    </div>
                    <details className="rounded-2xl bg-sumur px-4 py-3 text-[14px] text-tinta-2">
                      <summary className="cursor-pointer font-semibold text-tinta">Cara mengizinkan lokasi</summary>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        <li>Android (Chrome): ketuk ikon gembok di samping alamat, pilih Izin, lalu Lokasi: Izinkan.</li>
                        <li>iPhone (Safari): Pengaturan, Safari, Lokasi, pilih Tanyakan atau Izinkan.</li>
                        <li>Pastikan mode hemat baterai tidak mematikan GPS.</li>
                      </ul>
                    </details>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button size="lg" fullWidth onClick={() => { dispatch({ type: 'RETRY' }); setTimeout(cariLokasi, 0) }}><IconRefresh width={20} height={20} /> Coba lagi</Button>
                      {import.meta.env.DEV && konteks.branch && (
                        <Button variant="ghost" onClick={() => selesaiLokasi({ lat: konteks.branch!.lat, long: konteks.branch!.long, accuracy: 18 })}>Lokasi uji (dev)</Button>
                      )}
                    </div>
                  </div>
                )}

                {ctx.state === 'Capturing' && (
                  <div>
                    <p className="text-[17px] font-semibold text-tinta">Foto wajahmu</p>
                    <p className="mt-1 text-[14px] text-tinta-3">{arahan}.</p>
                    {kameraAda ? (
                      <>
                        <div className="relative mt-4 overflow-hidden rounded-[24px] bg-[#111]">
                          <video ref={videoRef} playsInline muted onLoadedData={() => setVideoSiap(true)} className="aspect-[3/4] w-full -scale-x-100 object-cover" />
                          <div className="pointer-events-none absolute inset-x-[16%] inset-y-[12%] rounded-[50%] ring-2 ring-[rgba(255,255,255,0.75)]" />
                        </div>
                        <Button variant="aksen" size="lg" fullWidth className="mt-4" onClick={ambilFoto} disabled={!videoSiap}>
                          {videoSiap ? <><IconCamera width={20} height={20} /> Ambil foto</> : <><Spinner className="h-5 w-5" /> Menyiapkan kamera...</>}
                        </Button>
                        <button type="button" onClick={tanpaFoto} className="mt-2 w-full py-2 text-[14px] font-medium text-tinta-3 hover:text-tinta">Kamera bermasalah? Lanjut tanpa foto</button>
                      </>
                    ) : (
                      <div className="mt-4 flex flex-col gap-3">
                        <div className="rounded-2xl bg-perlu-lembut px-4 py-3 text-[14px] text-perlu">
                          {consentPhoto === false
                            ? 'Kamu belum menyetujui pengambilan foto, jadi absen dikirim tanpa foto.'
                            : 'Kamera tidak bisa dibuka. Absen tetap bisa dikirim tanpa foto, tapi akan ditandai untuk dicek atasanmu.'}
                        </div>
                        <Button size="lg" fullWidth onClick={tanpaFoto}>Lanjut tanpa foto</Button>
                        {consentPhoto !== false && <Button variant="secondary" fullWidth onClick={() => void nyalakanKamera()}><IconRefresh width={18} height={18} /> Coba buka kamera lagi</Button>}
                      </div>
                    )}
                  </div>
                )}

                {ctx.state === 'Reviewing' && (
                  <div>
                    <p className="text-[17px] font-semibold text-tinta">Cek dulu sebelum dikirim</p>
                    <div className="mt-4 flex gap-4">
                      {foto ? (
                        <img src={foto} alt="Foto absen" className="h-36 w-28 shrink-0 rounded-[20px] object-cover" />
                      ) : (
                        <div className="flex h-36 w-28 shrink-0 flex-col items-center justify-center rounded-[20px] bg-sumur text-center text-[13px] text-tinta-3"><IconCamera width={22} height={22} /> Tanpa foto</div>
                      )}
                      <div className="flex min-w-0 flex-col justify-center gap-2">
                        <BarisGeo geo={geo} koordinat={koordinat} />
                        <p className="text-[14px] text-tinta-2">{ctx.kind === 'in' ? 'Absen masuk' : 'Absen keluar'} · sekarang</p>
                      </div>
                    </div>
                    <div className="mt-5 flex gap-2">
                      {kameraAda && <Button variant="secondary" onClick={() => { dispatch({ type: 'RETAKE' }); void nyalakanKamera() }}>Ulangi</Button>}
                      <Button variant="aksen" size="lg" fullWidth onClick={kirim}>Kirim absen</Button>
                    </div>
                  </div>
                )}

                {ctx.state === 'Submitting' && (
                  <div className="flex items-center justify-center gap-3 py-8 text-[16px] font-medium text-tinta-2"><Spinner className="h-5 w-5" /> Mengirim absen...</div>
                )}

                {ctx.state === 'Success' && <Berhasil hasil={hasil} kind={ctx.kind} onTutup={ulangi} />}

                {ctx.state === 'Queued' && (
                  <div className="py-4 text-center">
                    <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-perlu-lembut text-perlu"><IconWifiOff width={26} height={26} /></span>
                    <p className="mt-3 text-[18px] font-semibold text-tinta">Absen tersimpan di HP-mu</p>
                    <p className="mx-auto mt-1 max-w-sm text-[14px] text-tinta-2">Sinyal sedang hilang. Absen akan terkirim otomatis begitu online, dengan jam aslinya. Jangan hapus data peramban dulu ya.</p>
                    <Button variant="secondary" className="mt-4" onClick={ulangi}>Oke</Button>
                  </div>
                )}

                {ctx.state === 'SubmitError' && (
                  <div className="flex flex-col gap-4">
                    <PesanGalat>{galatKirim ?? 'Absen belum terkirim.'}</PesanGalat>
                    <Button size="lg" fullWidth onClick={() => dispatch({ type: 'RETRY' })}><IconRefresh width={20} height={20} /> Coba lagi</Button>
                  </div>
                )}
              </>
            )}
          </section>

          {/* Pintas */}
          <nav aria-label="Pintasan" className="mt-5 grid grid-cols-3 gap-2.5">
            <Pintas to="/jadwal" ikon={<IconCalendar />} label="Jadwal" ket="Shift ke depan" />
            <Pintas to="/riwayat" ikon={<IconHistory />} label="Riwayat" ket="Absenku" />
            <Pintas to="/pengajuan" ikon={<IconInbox />} label="Cuti" ket="& lembur" />
          </nav>
        </div>

        {/* Maskot laptop: berdiri bebas di kanan */}
        <aside className="relative hidden items-end justify-center lg:flex" aria-hidden>
          <div className="sticky top-10 flex flex-col items-center">
            <div className="cahaya-aksen absolute -inset-10" />
            <Maskot pose={pose} ukuran="hero" prioritas className="anim-ayun relative" />
          </div>
        </aside>
      </div>
    </div>
  )
}

/** Tanggal 'YYYY-MM-DD' sebuah waktu ISO di zona usaha aktif. */
function tanggalDi(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: zonaWaktu() }).format(new Date(iso))
}

function kalimatMaskot(ctx: ClockContext, k: TodayContext, selesai: boolean, libur: boolean, masuk: string | null, keluar: string | null): string {
  const shift = k.template ? `${k.template.name} mulai ${k.template.startTime.replace(':', '.')}` : 'Shift-mu'
  switch (ctx.state) {
    case 'Locating': return 'Sebentar, aku cek dulu kamu sudah di lokasi kerja atau belum.'
    case 'LocationError': return 'Lokasimu belum ketemu. Coba nyalakan GPS dulu ya.'
    case 'Capturing': return 'Sekarang foto wajahmu, biar atasanmu tahu ini memang kamu.'
    case 'Reviewing': return 'Sudah pas? Kalau iya, langsung kirim.'
    case 'Submitting': return 'Lagi kukirim...'
    case 'Success': return ctx.kind === 'in' ? 'Absen masuk tercatat. Semangat kerjanya!' : 'Absen keluar tercatat. Hati-hati di jalan!'
    case 'Queued': return 'Sinyalnya hilang, tapi tenang, absenmu sudah kusimpan.'
    case 'SubmitError': return 'Ada yang belum beres waktu dikirim. Coba sekali lagi ya.'
    default:
      if (selesai) return keluar ? `Absen hari ini lengkap: masuk ${formatTime(masuk ?? keluar).replace(':', '.')}, keluar ${formatTime(keluar).replace(':', '.')}. Terima kasih!` : 'Absen hari ini sudah lengkap. Terima kasih!'
      if (libur) return 'Hari ini kamu tidak ada jadwal. Selamat istirahat!'
      if (ctx.state === 'ReadyOut') return masuk ? `Kamu masuk jam ${formatTime(masuk).replace(':', '.')}. Jangan lupa absen keluar sebelum pulang ya.` : 'Jangan lupa absen keluar sebelum pulang ya.'
      return `${shift}${k.branch ? ` di ${k.branch.name}` : ''}. Yuk absen masuk.`
  }
}

function TombolAbsen({ kind, onClick, masukJam }: { kind: 'in' | 'out'; onClick: () => void; masukJam: string | null }) {
  return (
    <div className="flex flex-col items-center py-2">
      <div className="relative w-full">
        <span aria-hidden className="cincin-denyut pointer-events-none absolute inset-0 rounded-full bg-aksen/35" />
        <button
          type="button"
          onClick={onClick}
          className="tombol-aksen relative flex min-h-[64px] w-full items-center justify-center gap-2.5 rounded-full text-[19px] font-bold tracking-[-0.01em]"
        >
          <IconClock width={24} height={24} /> {kind === 'in' ? 'Absen masuk' : 'Absen keluar'}
        </button>
      </div>
      <p className="mt-3 text-center text-[13px] text-tinta-3">
        {kind === 'out' && masukJam ? `Masuk tadi jam ${formatTime(masukJam).replace(':', '.')}. ` : ''}Lokasi dicek dulu, lalu foto wajah.
      </p>
    </div>
  )
}

function LangkahAbsen({ state }: { state: ClockContext['state'] }) {
  const langkah = state === 'Locating' || state === 'LocationError' ? 0 : state === 'Capturing' || state === 'Reviewing' ? 1 : 2
  const label = ['Lokasi', 'Foto', 'Kirim']
  return (
    <ol className="mb-5 flex items-center gap-2" aria-label="Langkah absen">
      {label.map((l, i) => (
        <li key={l} className="flex flex-1 items-center gap-2">
          <span className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold', i < langkah ? 'bg-grafit text-grafit-teks' : i === langkah ? 'bg-aksen-lembut text-aksen-teks ring-2 ring-aksen' : 'bg-sumur text-tinta-3')}>
            {i < langkah ? '✓' : i + 1}
          </span>
          <span className={cx('text-[13px]', i === langkah ? 'font-semibold text-tinta' : 'text-tinta-3')}>{l}</span>
          {i < label.length - 1 && <span className={cx('h-px flex-1', i < langkah ? 'bg-grafit' : 'bg-garis')} />}
        </li>
      ))}
    </ol>
  )
}

function BarisGeo({ geo, koordinat }: { geo: HasilGeo | null; koordinat: Koordinat | null }) {
  if (!geo) return null
  const teks = geo.result === 'inside' ? 'Di lokasi kerja' : geo.result === 'near' ? 'Di tepi lokasi kerja' : 'Di luar lokasi kerja'
  const nada = geo.result === 'inside' ? 'bg-inti-lembut text-inti-teks' : geo.result === 'near' ? 'bg-perlu-lembut text-perlu' : 'bg-galat-lembut text-galat'
  const lemah = koordinat && !isAccuracyAcceptable(koordinat.accuracy)
  return (
    <div className="flex flex-col gap-1.5">
      <span className={cx('inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-semibold', nada)}>
        <IconMapPin width={14} height={14} /> {teks}
      </span>
      <span className="text-[13px] text-tinta-3">
        {geo.distanceM != null && `${Math.round(geo.distanceM)} m dari titik · `}akurasi {koordinat ? Math.round(koordinat.accuracy) : 0} m
        {lemah && ' (sinyal GPS lemah)'}
      </span>
      {geo.result === 'outside' && <span className="text-[13px] text-tinta-2">Tetap bisa dikirim, nanti ditandai untuk dicek atasanmu.</span>}
    </div>
  )
}

function Berhasil({ hasil, kind, onTutup }: { hasil: ClockResult | null; kind: 'in' | 'out'; onTutup: () => void }) {
  const ditandai = hasil && (hasil.decision === 'flagged' || hasil.decision === 'review')
  return (
    <div className="py-2 text-center">
      <span className="relative mx-auto flex h-20 w-20 items-center justify-center">
        <span className="cincin-denyut absolute inset-0 rounded-full bg-aksen/30" />
        <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-aksen-isi text-aksen-isi-teks"><IconCheckCircle width={34} height={34} /></span>
      </span>
      <p className="mt-3 text-[22px] font-bold tracking-[-0.02em] text-tinta">{kind === 'in' ? 'Absen masuk tercatat' : 'Absen keluar tercatat'}</p>
      <p className="mt-1 text-[15px] text-tinta-2">Jam {formatTime(new Date().toISOString()).replace(':', '.')}</p>
      {ditandai && (
        <div className="mx-auto mt-4 max-w-sm rounded-2xl bg-perlu-lembut px-4 py-3 text-left text-[14px] text-perlu">
          <p className="font-semibold">Absen ini akan dicek atasanmu</p>
          {hasil.reasons.length > 0 && <ul className="mt-1 list-disc pl-5">{hasil.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
        </div>
      )}
      <Button variant="secondary" className="mt-5" onClick={onTutup}>Selesai</Button>
    </div>
  )
}

function Selesai({ masuk, keluar }: { masuk: string | null; keluar: string | null }) {
  return (
    <div className="py-2">
      <p className="text-center text-[18px] font-semibold text-tinta">Absen hari ini lengkap</p>
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <div className="rounded-[20px] bg-sumur px-4 py-3">
          <p className="text-[13px] text-tinta-3">Masuk</p>
          <p className="text-[24px] font-bold tabular-nums tracking-[-0.02em] text-tinta">{masuk ? formatTime(masuk).replace(':', '.') : '-'}</p>
        </div>
        <div className="rounded-[20px] bg-sumur px-4 py-3">
          <p className="text-[13px] text-tinta-3">Keluar</p>
          <p className="text-[24px] font-bold tabular-nums tracking-[-0.02em] text-tinta">{keluar ? formatTime(keluar).replace(':', '.') : '-'}</p>
        </div>
      </div>
    </div>
  )
}

function Persetujuan({ onSelesai }: { onSelesai: () => void }) {
  const [lokasi, setLokasi] = useState(false)
  const [foto, setFoto] = useState(false)
  const [proses, setProses] = useState(false)
  const [galat, setGalat] = useState<string | null>(null)
  const simpan = async () => {
    setProses(true)
    setGalat(null)
    try {
      await api.giveConsent({ consentLocation: lokasi, consentPhoto: foto })
      onSelesai()
    } catch (e) {
      setGalat(pesanGalat(e))
    } finally {
      setProses(false)
    }
  }
  return (
    <div>
      <p className="text-[17px] font-semibold text-tinta">Sebelum absen pertama</p>
      <p className="mt-1 text-[14px] text-tinta-2">Absentra mencatat lokasi dan foto hanya saat kamu absen, dan hanya bisa dilihat atasanmu.</p>
      <div className="mt-3 rounded-[20px] bg-sumur px-4 py-1">
        <Centang checked={lokasi} onChange={setLokasi}>Saya setuju lokasi saya dicatat saat absen <span className="text-tinta-3">(wajib)</span></Centang>
        <Centang checked={foto} onChange={setFoto}>Saya setuju foto wajah saya diambil saat absen</Centang>
      </div>
      <div className="mt-3"><PesanGalat>{galat}</PesanGalat></div>
      <Button size="lg" fullWidth className="mt-3" disabled={!lokasi} loading={proses} onClick={simpan}>Setuju dan lanjut</Button>
    </div>
  )
}

function Pintas({ to, ikon, label, ket }: { to: string; ikon: React.ReactNode; label: string; ket: string }) {
  return (
    <Link to={to} className="kaca-panel flex flex-col gap-2 rounded-[22px] p-3.5 transition-transform active:scale-[0.98]">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-permukaan text-tinta shadow-lembut [&>svg]:h-5 [&>svg]:w-5">{ikon}</span>
      <span>
        <span className="flex items-center gap-1 text-[15px] font-semibold text-tinta">{label} <IconChevronRight width={14} height={14} className="text-tinta-3" /></span>
        <span className="block text-[12px] text-tinta-3">{ket}</span>
      </span>
    </Link>
  )
}
