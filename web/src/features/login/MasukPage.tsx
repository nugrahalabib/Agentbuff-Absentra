/**
 * Masuk & Daftar (pola halaman Masuk AgentBuff): maskot berdiri bebas di kiri,
 * kartu kaca di kanan. Dua jalan yang jelas: pemilik usaha lewat AgentBuff,
 * karyawan lewat Google sesuai email/undangan dari atasannya.
 */
import { useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { useActor } from '@/auth/useActor'
import { Button, Field, Input, PesanGalat, Spinner } from '@/components/ui'
import { Gelembung, LogoAbsentra, LogoAgentBuff, Maskot } from '@/components/merek'
import { IconArrowRight, IconChevronLeft, IconLock } from '@/components/ui/icons'
import { pesanMasuk, URL_MASUK_AGENTBUFF } from '@/lib/pesanMasuk'
import { pesanGalat } from '@/lib/galat'

export default function MasukPage({ mode }: { mode: 'masuk' | 'daftar' }) {
  const [params] = useSearchParams()
  const { isSignedIn, isLoading } = useActor()
  const cfg = useQuery({ queryKey: ['authConfig'], queryFn: () => api.authConfig(), staleTime: 60_000 })
  const kodeGalat = params.get('error') ?? params.get('gate')
  const daftar = mode === 'daftar'

  if (!isLoading && isSignedIn) return <Navigate to="/" replace />

  const ab = !!cfg.data?.agentbuffEnabled
  const google = !!cfg.data?.googleEnabled
  const hrefAgentBuff = daftar ? `${URL_MASUK_AGENTBUFF}?next=${encodeURIComponent('/onboarding?owner=1')}` : URL_MASUK_AGENTBUFF
  const hrefGoogle = '/api/auth/google/start'

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="flex items-center justify-between px-5 py-4 lg:px-10 lg:py-6">
        <Link to="/" aria-label="Beranda Absentra"><LogoAbsentra ukuran={32} /></Link>
        <Link to="/" className="kaca-pil flex h-10 items-center gap-1.5 rounded-full px-4 text-[14px] font-medium text-tinta-2 hover:text-tinta">
          <IconChevronLeft width={16} height={16} /> Beranda
        </Link>
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-6 px-5 pb-10 lg:grid-cols-[1fr_480px] lg:gap-12 lg:px-10">
        {/* Maskot (laptop): berdiri bebas, bicara dari gelembung */}
        <section className="relative hidden flex-col items-center lg:flex" aria-hidden>
          <Gelembung arah="bawah" className="mb-4 max-w-[300px] self-center">
            {daftar ? 'Siapkan usahamu sekali, karyawan langsung bisa absen dari HP.' : 'Halo lagi! Siap absen hari ini?'}
          </Gelembung>
          <div className="relative">
            <div className="cahaya-aksen absolute -inset-x-16 bottom-0 top-10" />
            <Maskot pose="selfie" ukuran="hero" prioritas className="relative" />
          </div>
          <p className="mt-2 text-[24px] font-bold tracking-[-0.03em] text-tinta">Absen cukup dari HP.</p>
          <p className="mt-1 text-[15px] text-tinta-3">Lokasi dan foto, tanpa mesin absen.</p>
        </section>

        <section className="kaca-panel rounded-[32px] p-6 sm:p-8">
          <div className="mb-5 flex items-center gap-3 lg:hidden">
            <Maskot pose="selfie" ukuran="kecil" prioritas />
            <Gelembung className="flex-1 text-[15px]">{daftar ? 'Siapkan usahamu, karyawan langsung bisa absen.' : 'Halo! Siap absen hari ini?'}</Gelembung>
          </div>

          <h1 className="text-[30px] font-bold leading-tight tracking-[-0.03em] text-tinta sm:text-[36px]">
            {daftar ? 'Daftarkan usahamu' : 'Masuk ke Absentra'}
          </h1>
          <p className="mt-2 text-[15px] text-tinta-2">
            {daftar ? 'Khusus pemilik usaha. Karyawan tidak perlu daftar.' : 'Pilih sesuai peranmu.'}
          </p>

          {kodeGalat && <div className="mt-5"><PesanGalat>{pesanMasuk(kodeGalat)}</PesanGalat></div>}

          {cfg.isLoading ? (
            <div className="flex justify-center py-10 text-tinta-3"><Spinner className="h-6 w-6" /></div>
          ) : (
            <div className="mt-6 flex flex-col gap-5">
              {(ab || !google) && (
                <div>
                  <p className="mb-2 text-[14px] font-semibold text-tinta-2">Pemilik usaha</p>
                  {ab ? (
                    <a href={hrefAgentBuff} className="tombol-grafit flex min-h-[54px] w-full items-center justify-center gap-2.5 rounded-full text-[16px] font-semibold">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#fff]"><LogoAgentBuff ukuran={20} /></span>
                      {daftar ? 'Daftar dengan AgentBuff' : 'Masuk dengan AgentBuff'}
                    </a>
                  ) : (
                    <p className="rounded-2xl bg-perlu-lembut p-3 text-[14px] text-perlu">Masuk pemilik belum disiapkan di server ini.</p>
                  )}
                  <p className="mt-2 text-[13px] text-tinta-3">
                    Pakai akun AgentBuff-mu. Belum punya?{' '}
                    <a href="https://agentbuff.id" target="_blank" rel="noopener noreferrer" className="font-semibold text-aksen-teks hover:underline">
                      Daftar di agentbuff.id
                    </a>
                    , lalu ambil Absentra di Marketplace.
                  </p>
                </div>
              )}

              {daftar ? (
                <ol className="flex flex-col gap-2.5 rounded-[20px] bg-sumur p-4 text-[14px] text-tinta-2">
                  {['Punya akun AgentBuff (bisa coba gratis).', 'Ambil Absentra di Marketplace AgentBuff.', 'Siapkan usahamu di sini, sekitar 5 menit.'].map((x, i) => (
                    <li key={x} className="flex gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-grafit text-[12px] font-bold text-grafit-teks">{i + 1}</span>
                      <span className="pt-0.5">{x}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                google && (
                  <div>
                    {ab && (
                      <div className="mb-4 flex items-center gap-3 text-[13px] text-tinta-3">
                        <span className="h-px flex-1 bg-garis" /> atau <span className="h-px flex-1 bg-garis" />
                      </div>
                    )}
                    <p className="mb-2 text-[14px] font-semibold text-tinta-2">Karyawan</p>
                    <a href={hrefGoogle} className="tombol-kaca flex min-h-[54px] w-full items-center justify-center gap-2.5 rounded-full text-[16px] font-semibold">
                      <LogoGoogle /> Masuk dengan Google
                    </a>
                    <p className="mt-2 text-[13px] text-tinta-3">Pakai email yang didaftarkan atasanmu. Baru diundang? Buka link undangannya dulu.</p>
                  </div>
                )
              )}

              {!daftar && cfg.data?.passwordAuthEnabled && <MasukSandi />}

              <p className="flex items-center justify-center gap-1.5 text-[13px] text-tinta-3">
                <IconLock width={14} height={14} /> Kata sandi Google dan AgentBuff-mu tidak pernah kami lihat.
              </p>
            </div>
          )}

          <div className="mt-6 border-t border-garis pt-5 text-center text-[14px] text-tinta-2">
            {daftar ? (
              <>Sudah pernah daftar? <Link to="/masuk" className="font-semibold text-aksen-teks hover:underline">Masuk</Link></>
            ) : (
              <>Punya usaha dan belum daftar? <Link to="/daftar" className="inline-flex items-center gap-1 font-semibold text-aksen-teks hover:underline">Daftarkan usaha <IconArrowRight width={14} height={14} /></Link></>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}

function MasukSandi() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [buka, setBuka] = useState(false)
  const [email, setEmail] = useState('')
  const [sandi, setSandi] = useState('')
  const [proses, setProses] = useState(false)
  const [galat, setGalat] = useState<string | null>(null)

  if (!buka) {
    return (
      <button type="button" onClick={() => setBuka(true)} className="text-[14px] font-medium text-tinta-3 underline-offset-4 hover:text-tinta hover:underline">
        Masuk dengan kata sandi (khusus admin)
      </button>
    )
  }
  const kirim = async (e: React.FormEvent) => {
    e.preventDefault()
    setGalat(null)
    setProses(true)
    try {
      const me = await api.signin(email, undefined, false, sandi)
      await qc.invalidateQueries({ queryKey: ['me'] })
      navigate(me.activeCompanyId ? '/' : '/onboarding')
    } catch (err) {
      setGalat(pesanGalat(err, 'Belum bisa masuk. Coba lagi.'))
    } finally {
      setProses(false)
    }
  }
  return (
    <form onSubmit={kirim} className="flex flex-col gap-3 rounded-[20px] bg-sumur p-4">
      <Field label="Email" htmlFor="m-email"><Input id="m-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></Field>
      <Field label="Kata sandi" htmlFor="m-sandi"><Input id="m-sandi" type="password" value={sandi} onChange={(e) => setSandi(e.target.value)} required autoComplete="current-password" /></Field>
      <PesanGalat>{galat}</PesanGalat>
      <Button type="submit" variant="secondary" loading={proses} fullWidth>Masuk</Button>
    </form>
  )
}

function LogoGoogle() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z" />
      <path fill="#34A853" d="M12 22c2.7 0 4.9-.9 6.6-2.4l-3.2-2.5c-.9.6-2 .9-3.4.9-2.6 0-4.8-1.7-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z" />
      <path fill="#FBBC05" d="M6.4 13.9a6 6 0 0 1 0-3.8V7.5H3.1a10 10 0 0 0 0 9z" />
      <path fill="#EA4335" d="M12 6.1c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3.1 7.5l3.3 2.6C7.2 7.8 9.4 6.1 12 6.1z" />
    </svg>
  )
}
