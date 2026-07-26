import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient, useMutation } from '@tanstack/react-query'
import { useActor } from '@/auth/useActor'
import { api } from '@/lib/api/client'
import { Button, Card, Badge, Field, Input } from '@/components/ui'
import { IconUser, IconLogout, IconSwitch, IconCamera } from '@/components/ui/icons'
import { t } from '@/i18n'

const roleLabel: Record<string, string> = { owner: 'Owner / Super Admin', branch_admin: 'Branch Admin', hr: 'HR / Approver', employee: 'Karyawan' }

export function ProfilPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user, company, role, memberships, activeCompanyId, employeeId, hasPassword, passwordAuthAllowed } = useActor()
  const [photo, setPhoto] = useState<string | null>(null)
  const uploadPhoto = useMutation({ mutationFn: (dataUrl: string) => api.uploadProfilePhoto(dataUrl), onSuccess: () => qc.invalidateQueries({ queryKey: ['employees'] }) })

  const onPhoto = (file: File | undefined) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => { const url = String(reader.result); setPhoto(url); uploadPhoto.mutate(url) }
    reader.readAsDataURL(file)
  }

  const doLogout = async () => { await api.signout(); await qc.invalidateQueries({ queryKey: ['me'] }); navigate('/') }
  const doSwitch = async (cid: string) => { await api.switchTenant(cid); await qc.invalidateQueries(); navigate('/absen') }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-4 text-xl font-bold text-text">{t.nav.profil}</h1>

      <Card className="mb-3 flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"><IconUser width={26} height={26} /></span>
        <div>
          <p className="font-semibold text-text">{user?.name}</p>
          <p className="text-xs text-text-muted">{user?.email}</p>
          {role && <Badge tone="accent">{roleLabel[role]}</Badge>}
        </div>
      </Card>

      {employeeId && (
        <Card className="mb-3">
          <p className="mb-2 text-sm font-medium text-text">Foto profil</p>
          <p className="mb-3 text-xs text-text-muted">Agar admin & HR mudah mengenalimu.</p>
          <div className="flex items-center gap-3">
            <span className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-surface text-text-muted">
              {photo ? <img src={photo} alt="Foto profil" className="h-full w-full object-cover" /> : <IconUser width={28} height={28} />}
            </span>
            <label className="cursor-pointer">
              <span className="inline-flex min-h-touch items-center gap-2 rounded-md border border-border px-4 text-sm font-semibold text-text hover:bg-surface">
                <IconCamera width={18} height={18} /> {photo ? 'Ganti foto' : 'Unggah foto'}
              </span>
              <input type="file" accept="image/*" capture="user" className="hidden" onChange={(e) => onPhoto(e.target.files?.[0])} />
            </label>
            {uploadPhoto.isSuccess && <span className="text-sm text-success">Tersimpan ✓</span>}
          </div>
        </Card>
      )}

      <Card className="mb-3">
        <p className="text-sm text-text-muted">Perusahaan aktif</p>
        <p className="font-medium text-text">{company?.displayName}</p>
        <p className="text-xs text-text-muted">Zona waktu: {company?.timezone} · Minggu kerja: {company?.workweekType === 'six_day' ? '6 hari' : '5 hari'}</p>
      </Card>

      {memberships.length > 1 && (
        <Card className="mb-3">
          <p className="mb-2 text-sm font-medium text-text">{t.common.switchTenant}</p>
          <div className="flex flex-col gap-2">
            {memberships.map((m) => (
              <Button key={m.company.id} variant={m.company.id === activeCompanyId ? 'primary' : 'secondary'} fullWidth onClick={() => doSwitch(m.company.id)}>
                <IconSwitch width={16} height={16} /> {m.company.displayName} · {roleLabel[m.membership.role]}
              </Button>
            ))}
          </div>
        </Card>
      )}

      {passwordAuthAllowed && <PasswordCard hasPassword={hasPassword} />}

      <Button variant="ghost" fullWidth onClick={doLogout}><IconLogout width={18} height={18} /> {t.nav.keluar}</Button>
    </div>
  )
}

function PasswordCard({ hasPassword }: { hasPassword: boolean }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const m = useMutation({
    mutationFn: () => api.changePassword(next, current || undefined),
    onSuccess: () => { setCurrent(''); setNext(''); setConfirm(''); setErr(null) },
    onError: (e: any) => setErr(e?.body?.error === 'invalid_current' ? 'Password lama salah.' : 'Gagal mengubah password.'),
  })
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setErr(null)
    if (next.length < 6) return setErr('Password baru minimal 6 karakter.')
    if (next !== confirm) return setErr('Konfirmasi password tidak cocok.')
    m.mutate()
  }
  return (
    <Card className="mb-3">
      <p className="mb-2 text-sm font-medium text-text">{hasPassword ? 'Ubah password' : 'Atur password'}</p>
      {!hasPassword && <p className="mb-2 text-xs text-text-muted">Akun kamu login via Google. Set password agar bisa masuk tanpa Google bila perlu.</p>}
      <form className="flex flex-col gap-2" onSubmit={submit}>
        {hasPassword && <Field label="Password lama"><Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" /></Field>}
        <Field label="Password baru" error={err ?? undefined}><Input type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={6} autoComplete="new-password" /></Field>
        <Field label="Konfirmasi password baru"><Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={6} autoComplete="new-password" /></Field>
        <Button type="submit" loading={m.isPending}>{m.isSuccess ? 'Tersimpan ✓' : 'Simpan password'}</Button>
      </form>
    </Card>
  )
}
