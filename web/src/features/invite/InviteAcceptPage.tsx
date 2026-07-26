import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api/client'
import { useActor } from '@/auth/useActor'
import { Button, Card, Spinner } from '@/components/ui'
import { IconCheck } from '@/components/ui/icons'
import { t } from '@/i18n'

/** Open invite link → Google sign-in → consent (PDP) → join company (PRD §6.3). */
export function InviteAcceptPage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { isSignedIn, isLoading: meLoading } = useActor()

  const info = useQuery({ queryKey: ['invite', token], queryFn: () => api.inviteInfo(token) })
  const cfg = useQuery({ queryKey: ['authConfig'], queryFn: () => api.authConfig() })
  const [consentLocation, setCL] = useState(false)
  const [consentPhoto, setCP] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (info.isLoading || meLoading) return <div className="flex h-full items-center justify-center"><Spinner className="h-6 w-6 text-primary" /></div>
  if (!info.data?.valid) {
    return <div className="mx-auto max-w-md px-5 py-16 text-center text-text-muted">Undangan tidak valid atau sudah kedaluwarsa.</div>
  }

  const accept = async () => {
    setError(null); setBusy(true)
    try {
      await api.acceptInvite(token, { consentLocation, consentPhoto })
      await qc.invalidateQueries({ queryKey: ['me'] })
      navigate('/')
    } catch (e) {
      setError(e instanceof ApiError && e.body?.error === 'already_member' ? 'Kamu sudah menjadi anggota perusahaan ini.' : 'Gagal menerima undangan.')
    } finally { setBusy(false) }
  }

  const googleHref = `/api/auth/google/start?next=${encodeURIComponent(`/invite/${token}`)}`

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-5 text-center">
        <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-lg bg-primary text-on-primary"><IconCheck width={30} height={30} /></span>
        <h1 className="text-xl font-bold text-text">Bergabung dengan {info.data.companyName}</h1>
        <p className="mt-1 text-sm text-text-muted">Cabang {info.data.branchName} · sebagai {info.data.role === 'employee' ? 'Karyawan' : info.data.role}</p>
      </div>
      <Card>
        <div className="flex flex-col gap-3">
          {!isSignedIn && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-text-muted">Masuk dengan Google untuk menerima undangan.</p>
              {cfg.data?.googleEnabled ? (
                <a href={googleHref} className="flex min-h-touch w-full items-center justify-center gap-2 rounded-md bg-primary font-semibold text-on-primary hover:bg-primary-pressed">
                  Masuk dengan Google
                </a>
              ) : (
                <p className="rounded-md bg-warning/10 p-2 text-sm text-warning">Login Google belum dikonfigurasi di server.</p>
              )}
            </div>
          )}
          {isSignedIn && (
            <>
              <div className="rounded-md bg-surface p-3 text-sm">
                <p className="mb-2 font-medium text-text">Persetujuan data (UU PDP)</p>
                <label className="mb-1 flex items-start gap-2 text-text-muted"><input type="checkbox" checked={consentLocation} onChange={(e) => setCL(e.target.checked)} /> Saya setuju lokasi saya direkam saat absen.</label>
                <label className="flex items-start gap-2 text-text-muted"><input type="checkbox" checked={consentPhoto} onChange={(e) => setCP(e.target.checked)} /> Saya setuju foto saya diambil saat absen.</label>
              </div>
              {error && <p className="text-sm text-danger" aria-live="polite">{error}</p>}
              <Button fullWidth loading={busy} disabled={!consentLocation || !consentPhoto} onClick={accept}>
                Terima & gabung
              </Button>
            </>
          )}
        </div>
      </Card>
      <p className="mt-3 text-center text-xs text-text-muted">{t.tagline}</p>
    </div>
  )
}
