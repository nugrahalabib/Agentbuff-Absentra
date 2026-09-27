import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api/client'
import { BottomSheet, Button, Field, Input } from '@/components/ui'
import { t } from '@/i18n'
import { URL_MASUK_AGENTBUFF } from '@/lib/pesanMasuk'

export type AuthModalMode = 'login' | 'register'

/**
 * Auth dialog for landing (and deep-link pages). OWNERS sign in / register with
 * "Masuk dengan AgentBuff"; invited STAFF sign in with Google (the email their
 * owner/admin invited).
 */
export function AuthModal({
  open,
  mode,
  onClose,
  onSwitchMode,
}: {
  open: boolean
  mode: AuthModalMode
  onClose: () => void
  onSwitchMode: (mode: AuthModalMode) => void
}) {
  const isRegister = mode === 'register'
  const title = isRegister ? 'Daftar & Buat Perusahaan' : `Masuk ke ${t.appName}`
  const cfg = useQuery({ queryKey: ['authConfig'], queryFn: () => api.authConfig(), enabled: open })
  const showPassword = !isRegister && !!cfg.data?.passwordAuthEnabled

  const googleHref = isRegister
    ? '/api/auth/google/start?next=/onboarding%3Fowner%3D1'
    : '/api/auth/google/start'
  const agentbuffHref = isRegister ? `${URL_MASUK_AGENTBUFF}?next=/onboarding%3Fowner%3D1` : URL_MASUK_AGENTBUFF
  const ab = !!cfg.data?.agentbuffEnabled

  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-muted">
          {ab
            ? isRegister
              ? 'Khusus pemilik usaha. Lanjut dengan akun AgentBuff, lalu kami pandu menyiapkan perusahaan.'
              : 'Pemilik usaha masuk dengan akun AgentBuff. Karyawan masuk dengan Google sesuai email undangan.'
            : isRegister
              ? 'Khusus pemilik usaha. Lanjut dengan Google, lalu kami pandu menyiapkan perusahaan.'
              : 'Masuk dengan akun Google. Karyawan: buka link undangan dari admin.'}
        </p>

        {cfg.isLoading ? (
          <p className="text-sm text-text-muted">Memuat…</p>
        ) : ab ? (
          <>
            <a
              href={agentbuffHref}
              className="flex min-h-touch w-full items-center justify-center gap-2 rounded-md bg-primary font-semibold text-on-primary transition-colors hover:bg-primary-pressed"
            >
              <img src="/agentbuff-logo.png" alt="" width={20} height={20} className="rounded bg-white p-0.5" />
              {isRegister ? 'Daftar dengan AgentBuff' : 'Masuk dengan AgentBuff'}
            </a>
            <p className="text-center text-xs text-text-muted">
              Belum punya akun AgentBuff? Daftar gratis di{' '}
              <a href="https://agentbuff.id" target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">agentbuff.id</a>
              , lalu ambil Absentra di Marketplace.
            </p>
            {!isRegister && cfg.data?.googleEnabled && (
              <a
                href={googleHref}
                className="flex min-h-touch w-full items-center justify-center gap-2 rounded-md border border-border font-semibold text-text transition-colors hover:bg-surface"
              >
                <GoogleG /> Karyawan: masuk dengan Google
              </a>
            )}
          </>
        ) : cfg.data?.googleEnabled ? (
          <a
            href={googleHref}
            className="flex min-h-touch w-full items-center justify-center gap-2 rounded-md bg-primary font-semibold text-on-primary transition-colors hover:bg-primary-pressed"
          >
            <GoogleG /> {isRegister ? 'Daftar dengan Google' : 'Masuk dengan Google'}
          </a>
        ) : (
          <p className="rounded-md bg-warning/10 p-3 text-sm text-warning">
            Login Google belum dikonfigurasi di server.
          </p>
        )}

        {showPassword && <AllowlistPasswordForm onSuccess={onClose} />}

        <p className="text-center text-sm text-text-muted">
          {isRegister ? (
            <>
              Sudah punya akun?{' '}
              <button type="button" className="font-semibold text-primary hover:underline" onClick={() => onSwitchMode('login')}>
                Masuk
              </button>
            </>
          ) : (
            <>
              Belum punya akun?{' '}
              <button type="button" className="font-semibold text-primary hover:underline" onClick={() => onSwitchMode('register')}>
                Daftar gratis
              </button>
            </>
          )}
        </p>
      </div>
    </BottomSheet>
  )
}

function AllowlistPasswordForm({ onSuccess }: { onSuccess: () => void }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null); setLoading(true)
    try {
      const me = await api.signin(email, undefined, false, password)
      await qc.invalidateQueries({ queryKey: ['me'] })
      onSuccess()
      navigate(me.activeCompanyId ? '/' : '/onboarding')
    } catch (err) {
      const code = err instanceof ApiError ? err.body?.error : null
      if (code === 'password_auth_forbidden') setError('Email ini harus masuk dengan Google.')
      else if (code === 'not_registered') setError('Email belum terdaftar.')
      else if (code === 'invalid_credentials') setError('Email atau password salah.')
      else setError('Gagal masuk. Coba lagi.')
    } finally { setLoading(false) }
  }

  return (
    <>
      <div className="flex items-center gap-2 text-xs text-text-muted">
        <span className="h-px flex-1 bg-border" /> admin / allowlist <span className="h-px flex-1 bg-border" />
      </div>
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <Field label="Email" htmlFor="auth-email" error={error ?? undefined}>
          <Input id="auth-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </Field>
        <Field label="Password" htmlFor="auth-password">
          <Input id="auth-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </Field>
        <Button type="submit" fullWidth loading={loading} variant="secondary">Masuk dengan password</Button>
      </form>
    </>
  )
}

function GoogleG() {
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white">
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z"/><path fill="#34A853" d="M12 22c2.7 0 4.9-.9 6.6-2.4l-3.2-2.5c-.9.6-2 .9-3.4.9-2.6 0-4.8-1.7-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"/><path fill="#FBBC05" d="M6.4 13.9a6 6 0 0 1 0-3.8V7.5H3.1a10 10 0 0 0 0 9z"/><path fill="#EA4335" d="M12 6.1c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3.1 7.5l3.3 2.6C7.2 7.8 9.4 6.1 12 6.1z"/></svg>
    </span>
  )
}
