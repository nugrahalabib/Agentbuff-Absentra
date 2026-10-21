/** Buka link undangan → masuk Google → setuju data (UU PDP) → bergabung. */
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { useActor } from '@/auth/useActor'
import { Button, Centang, PesanGalat, Spinner } from '@/components/ui'
import { Gelembung, LogoAbsentra, Maskot } from '@/components/merek'
import { IconLock, IconMapPin } from '@/components/ui/icons'
import { pesanGalat } from '@/lib/galat'

const PERAN: Record<string, string> = { employee: 'karyawan', hr: 'HR', branch_admin: 'admin cabang' }

export default function InviteAcceptPage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { isSignedIn, isLoading, user } = useActor()
  const info = useQuery({ queryKey: ['invite', token], queryFn: () => api.inviteInfo(token), retry: false })
  const cfg = useQuery({ queryKey: ['authConfig'], queryFn: () => api.authConfig() })
  const [lokasi, setLokasi] = useState(false)
  const [foto, setFoto] = useState(false)
  const [proses, setProses] = useState(false)
  const [galat, setGalat] = useState<string | null>(null)

  const terima = async () => {
    setGalat(null)
    setProses(true)
    try {
      await api.acceptInvite(token, { consentLocation: lokasi, consentPhoto: foto })
      qc.clear()
      navigate('/', { replace: true })
    } catch (e) {
      setGalat(pesanGalat(e, 'Belum bisa bergabung. Coba lagi.'))
    } finally {
      setProses(false)
    }
  }

  const masukGoogle = `/api/auth/google/start?next=${encodeURIComponent(`/invite/${token}`)}`
  const valid = info.data?.valid

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="px-5 py-4 lg:px-10 lg:py-6"><LogoAbsentra ukuran={32} /></header>
      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-10">
        {info.isLoading || isLoading ? (
          <div className="flex justify-center py-24 text-tinta-3"><Spinner className="h-6 w-6" /></div>
        ) : !valid ? (
          <div className="kaca-panel flex flex-col items-center rounded-[28px] p-6 text-center">
            <Maskot pose="cuti" ukuran="sedang" />
            <h1 className="mt-3 text-[22px] font-bold tracking-[-0.02em] text-tinta">Undangannya sudah tidak berlaku</h1>
            <p className="mt-1 text-[15px] text-tinta-2">Mungkin sudah kedaluwarsa atau dicabut. Minta link baru ke atasanmu ya.</p>
          </div>
        ) : (
          <>
            <div className="flex items-end gap-3">
              <Maskot pose="selfie" ukuran="kecil" prioritas />
              <Gelembung className="mb-3 flex-1">
                {isSignedIn ? `Halo ${user?.name?.split(' ')[0] ?? ''}! Satu langkah lagi.` : 'Halo! Kamu diundang bergabung.'}
              </Gelembung>
            </div>
            <section className="kaca-panel mt-4 rounded-[28px] p-5 sm:p-6">
              <p className="text-[14px] font-medium text-tinta-3">Kamu diundang ke</p>
              <h1 className="mt-1 text-[26px] font-bold leading-tight tracking-[-0.03em] text-tinta">{info.data?.companyName}</h1>
              <p className="mt-2 flex items-center gap-1.5 text-[15px] text-tinta-2">
                <IconMapPin width={16} height={16} /> {info.data?.branchName} · sebagai {PERAN[info.data?.role ?? 'employee'] ?? info.data?.role}
              </p>

              {!isSignedIn ? (
                <div className="mt-5 flex flex-col gap-3">
                  {cfg.data?.googleEnabled ? (
                    <a href={masukGoogle} className="tombol-grafit flex min-h-[54px] items-center justify-center gap-2 rounded-full text-[16px] font-semibold">Masuk dengan Google untuk bergabung</a>
                  ) : (
                    <p className="rounded-[16px] bg-perlu-lembut px-4 py-3 text-[14px] text-perlu">Masuk dengan Google belum disiapkan di server ini.</p>
                  )}
                  <p className="text-[13px] text-tinta-3">Tidak perlu instal aplikasi. Setelah bergabung, kamu bisa menambahkan Absentra ke layar utama HP.</p>
                </div>
              ) : (
                <div className="mt-5 flex flex-col gap-3">
                  <div className="rounded-[20px] bg-sumur px-4 py-1">
                    <Centang checked={lokasi} onChange={setLokasi}>Saya setuju lokasi saya dicatat saat absen <span className="text-tinta-3">(wajib)</span></Centang>
                    <Centang checked={foto} onChange={setFoto}>Saya setuju foto wajah saya diambil saat absen</Centang>
                  </div>
                  <p className="flex items-start gap-2 text-[13px] text-tinta-3"><IconLock width={14} height={14} className="mt-0.5 shrink-0" /> Lokasi dan foto hanya diambil saat kamu absen, dan hanya bisa dilihat atasanmu.</p>
                  <PesanGalat>{galat}</PesanGalat>
                  <Button size="lg" fullWidth loading={proses} disabled={!lokasi} onClick={terima}>Gabung sekarang</Button>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  )
}
