/** Akun saya: identitas, foto profil, tampilan (terang/gelap/ikut HP), usaha, kata sandi, keluar. */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient, useMutation } from '@tanstack/react-query'
import { useActor } from '@/auth/useActor'
import { useKeluar } from '@/auth/useKeluar'
import { api } from '@/lib/api/client'
import { Button, Field, Input, KepalaHalaman, PesanGalat } from '@/components/ui'
import { IconCamera, IconCheck, IconLogout, IconMonitor, IconMoon, IconSun } from '@/components/ui/icons'
import { toast } from '@/components/Toast'
import { bacaPilihanTema, simpanPilihanTema, type PilihanTema } from '@/lib/tema'
import { kecilkanGambar } from '@/lib/gambar'
import { pesanGalat } from '@/lib/galat'

const PERAN: Record<string, string> = { owner: 'Pemilik', branch_admin: 'Admin cabang', hr: 'HR', employee: 'Karyawan' }

export default function ProfilPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user, company, role, memberships, activeCompanyId, employeeId, hasPassword, passwordAuthAllowed } = useActor()
  const [foto, setFoto] = useState<string | null>(null)
  const [tema, setTema] = useState<PilihanTema>(() => bacaPilihanTema())
  const unggah = useMutation({
    mutationFn: (d: string) => api.uploadProfilePhoto(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employees'] }); toast.berhasil('Foto profil tersimpan.') },
    onError: (e) => { setFoto(null); toast.galat(pesanGalat(e)) },
  })

  useEffect(() => {
    const ubah = () => setTema(bacaPilihanTema())
    window.addEventListener('absentra:tema', ubah)
    return () => window.removeEventListener('absentra:tema', ubah)
  }, [])

  const pilihFoto = (f?: File) => {
    if (!f) return
    void kecilkanGambar(f, 480)
      .then((d) => { setFoto(d); unggah.mutate(d) })
      .catch(() => toast.galat('Gambar tidak bisa dibaca.'))
  }
  const keluar = useKeluar()
  const pindah = async (cid: string) => {
    try {
      await api.switchTenant(cid)
      qc.clear()
      navigate('/', { replace: true })
    } catch (e) {
      toast.galat(pesanGalat(e))
    }
  }
  const inisial = (user?.name ?? '').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase()

  return (
    <div className="mx-auto max-w-2xl">
      <KepalaHalaman judul="Akun saya" />

      <section className="kaca-panel flex items-center gap-4 rounded-[28px] p-5">
        <div className="relative">
          <span className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-grafit text-[20px] font-bold text-grafit-teks">
            {foto ? <img src={foto} alt="Foto profil" className="h-full w-full object-cover" /> : inisial}
          </span>
          {employeeId && (
            <label className="absolute -bottom-1 -right-1 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-permukaan text-tinta shadow-lembut" aria-label="Ganti foto profil">
              <IconCamera width={16} height={16} />
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => pilihFoto(e.target.files?.[0])} />
            </label>
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-[19px] font-semibold text-tinta">{user?.name}</p>
          <p className="truncate text-[14px] text-tinta-3">{user?.email}</p>
          <p className="mt-1 text-[14px] text-tinta-2">{role ? PERAN[role] : ''}{company ? ` di ${company.displayName}` : ''}</p>
        </div>
      </section>

      <section className="kaca-panel mt-4 rounded-[28px] p-5">
        <h2 className="text-[17px] font-semibold text-tinta">Tampilan</h2>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {([
            ['terang', 'Terang', <IconSun key="s" width={20} height={20} />],
            ['gelap', 'Gelap', <IconMoon key="m" width={20} height={20} />],
            ['sistem', 'Ikut HP', <IconMonitor key="p" width={20} height={20} />],
          ] as const).map(([v, l, ikon]) => (
            <button key={v} type="button" aria-pressed={tema === v} onClick={() => { simpanPilihanTema(v); setTema(v) }} className="kaca-ubin flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-[18px] text-[14px] font-semibold text-tinta">
              {ikon}{l}
            </button>
          ))}
        </div>
      </section>

      {memberships.length > 1 && (
        <section className="kaca-panel mt-4 rounded-[28px] p-5">
          <h2 className="text-[17px] font-semibold text-tinta">Usahaku</h2>
          <div className="mt-3 flex flex-col gap-2">
            {memberships.map((m) => (
              <button key={m.company.id} type="button" data-aktif={m.company.id === activeCompanyId} onClick={() => pindah(m.company.id)} className="kaca-ubin flex min-h-[56px] items-center justify-between gap-3 rounded-[18px] px-4 text-left">
                <span>
                  <span className="block text-[15px] font-semibold text-tinta">{m.company.displayName}</span>
                  <span className="block text-[13px] text-tinta-3">{PERAN[m.membership.role] ?? m.membership.role}</span>
                </span>
                {m.company.id === activeCompanyId && <IconCheck width={18} height={18} className="text-tinta" />}
              </button>
            ))}
          </div>
        </section>
      )}

      {passwordAuthAllowed && <KataSandi adaSandi={hasPassword} />}

      <Button variant="secondary" fullWidth size="lg" className="mt-5 !text-galat" onClick={keluar}><IconLogout width={20} height={20} /> Keluar</Button>
    </div>
  )
}

function KataSandi({ adaSandi }: { adaSandi: boolean }) {
  const [lama, setLama] = useState('')
  const [baru, setBaru] = useState('')
  const [ulang, setUlang] = useState('')
  const [galat, setGalat] = useState<string | null>(null)
  const m = useMutation({
    mutationFn: () => api.changePassword(baru, lama || undefined),
    onSuccess: () => { setLama(''); setBaru(''); setUlang(''); toast.berhasil('Kata sandi tersimpan.') },
    onError: (e) => setGalat(pesanGalat(e)),
  })
  const kirim = (e: React.FormEvent) => {
    e.preventDefault()
    setGalat(null)
    if (baru.length < 8) return setGalat('Kata sandi baru minimal 8 karakter.')
    if (baru !== ulang) return setGalat('Ulangi kata sandi belum sama.')
    m.mutate()
  }
  return (
    <section className="kaca-panel mt-4 rounded-[28px] p-5">
      <h2 className="text-[17px] font-semibold text-tinta">{adaSandi ? 'Ganti kata sandi' : 'Buat kata sandi'}</h2>
      <form className="mt-3 flex flex-col gap-3" onSubmit={kirim}>
        {adaSandi && <Field label="Kata sandi lama"><Input type="password" value={lama} onChange={(e) => setLama(e.target.value)} required autoComplete="current-password" /></Field>}
        <Field label="Kata sandi baru"><Input type="password" value={baru} onChange={(e) => setBaru(e.target.value)} required minLength={8} autoComplete="new-password" /></Field>
        <Field label="Ulangi kata sandi baru"><Input type="password" value={ulang} onChange={(e) => setUlang(e.target.value)} required minLength={8} autoComplete="new-password" /></Field>
        <PesanGalat>{galat}</PesanGalat>
        <Button type="submit" loading={m.isPending}>Simpan</Button>
      </form>
    </section>
  )
}
