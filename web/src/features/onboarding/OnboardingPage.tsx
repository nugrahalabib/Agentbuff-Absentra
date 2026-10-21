/**
 * Penyiapan pertama (pola Onboarding AgentBuff): maskot berhadapan dengan SATU kartu
 * pertanyaan. Pemilik: Usaha → Lokasi kerja → Jam kerja → Selesai. Karyawan yang
 * nyasar ke sini diarahkan ke link undangan.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api/client'
import { useActor } from '@/auth/useActor'
import { Button, Field, Input, PesanGalat, Select, cx } from '@/components/ui'
import { Gelembung, LogoAbsentra, Maskot, type PoseMaskot } from '@/components/merek'
import { IconArrowRight, IconBriefcase, IconCheck, IconChevronLeft, IconUser } from '@/components/ui/icons'
import { pesanMasuk, URL_MASUK_AGENTBUFF } from '@/lib/pesanMasuk'
import { pesanGalat } from '@/lib/galat'
import { FormLokasi } from '@/features/org/BranchesPage'
import { FormShift } from '@/features/org/ShiftsPage'
import { mulaiWizard, selesaiWizard } from './wizard'

const JENIS_USAHA = ['Kuliner (warung, kafe, resto)', 'Toko / minimarket', 'Jasa (salon, bengkel, laundry)', 'Klinik / apotek', 'Produksi / pabrik kecil', 'Kantor / agensi', 'Lainnya']
const ZONA = [
  { v: 'Asia/Jakarta', l: 'WIB' },
  { v: 'Asia/Makassar', l: 'WITA' },
  { v: 'Asia/Jayapura', l: 'WIT' },
]
const LANGKAH = ['Usaha', 'Lokasi kerja', 'Jam kerja', 'Selesai'] as const
const POSE: PoseMaskot[] = ['analisis', 'peta', 'jadwal', 'selfie']
const KATA: string[] = [
  'Halo! Aku bantu siapkan usahamu. Pertama, kenalan dulu.',
  'Di mana karyawanmu biasa kerja? Mereka absen dari titik ini.',
  'Jam kerjanya kapan? Nanti bisa ditambah shift lain.',
  'Beres! Tinggal undang karyawanmu.',
]

function tokenUndangan(teks: string): string {
  const t = teks.trim()
  const m = t.match(/\/invite\/([A-Za-z0-9_-]+)/)
  return m ? m[1] : t.replace(/[^A-Za-z0-9_-]/g, '')
}

export default function OnboardingPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user, activeCompanyId } = useActor()
  const pemilikLangsung = new URLSearchParams(window.location.search).has('owner')
  const [peran, setPeran] = useState<'pilih' | 'pemilik'>(pemilikLangsung || activeCompanyId ? 'pemilik' : 'pilih')
  const [langkah, setLangkah] = useState(0)
  const [undangan, setUndangan] = useState('')

  // Muat ulang di tengah wizard: perusahaan sudah ada, lanjutkan dari langkah yang belum.
  const cabangQ = useQuery({ queryKey: ['branches', 'wizard'], enabled: !!activeCompanyId, queryFn: () => api.branches() })
  const shiftQ = useQuery({ queryKey: ['shiftTemplates', 'wizard'], enabled: !!activeCompanyId, queryFn: () => api.shiftTemplates() })
  useEffect(() => {
    if (!activeCompanyId || langkah !== 0 || !cabangQ.data || !shiftQ.data) return
    setLangkah(cabangQ.data.length === 0 ? 1 : shiftQ.data.length === 0 ? 2 : 3)
  }, [activeCompanyId, langkah, cabangQ.data, shiftQ.data])

  const selesai = async (tujuan: string) => {
    selesaiWizard()
    await qc.invalidateQueries()
    navigate(tujuan, { replace: true })
  }

  const kepala = (
    <header className="flex items-center justify-between px-5 py-4 lg:px-10 lg:py-6">
      <LogoAbsentra ukuran={32} />
      {peran === 'pemilik' && <span className="text-[14px] font-medium text-tinta-3">Langkah {langkah + 1} dari {LANGKAH.length}</span>}
    </header>
  )

  if (peran === 'pilih') {
    return (
      <div className="flex min-h-[100dvh] flex-col">
        {kepala}
        <main className="mx-auto w-full max-w-xl flex-1 px-5 pb-10">
          <div className="flex items-end gap-3">
            <Maskot pose="selfie" ukuran="kecil" prioritas />
            <Gelembung className="mb-3 flex-1">Halo{user?.name ? `, ${user.name.split(' ')[0]}` : ''}! Kamu datang sebagai siapa?</Gelembung>
          </div>
          <div className="mt-5 flex flex-col gap-3">
            <button type="button" onClick={() => setPeran('pemilik')} className="kaca-panel flex items-start gap-4 rounded-[24px] p-5 text-left transition-transform active:scale-[0.99]">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-grafit text-grafit-teks"><IconBriefcase width={22} height={22} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[17px] font-semibold text-tinta">Saya pemilik usaha</span>
                <span className="mt-0.5 block text-[14px] text-tinta-2">Siapkan usahamu supaya karyawan bisa absen dari HP.</span>
              </span>
              <IconArrowRight width={20} height={20} className="mt-3 shrink-0 text-tinta-3" />
            </button>
            <div className="kaca-panel rounded-[24px] p-5">
              <div className="flex items-start gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sumur text-tinta"><IconUser width={22} height={22} /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-[17px] font-semibold text-tinta">Saya karyawan</p>
                  <p className="mt-0.5 text-[14px] text-tinta-2">Buka link undangan dari atasanmu, atau tempel di sini.</p>
                </div>
              </div>
              <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); const t = tokenUndangan(undangan); if (t) navigate(`/invite/${t}`) }}>
                <Input value={undangan} onChange={(e) => setUndangan(e.target.value)} placeholder="Tempel link undangan" aria-label="Link undangan" className="rounded-full" />
                <Button type="submit" disabled={!tokenUndangan(undangan)}>Gabung</Button>
              </form>
            </div>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-[100dvh] flex-col">
      {kepala}
      <main className="mx-auto grid w-full max-w-5xl flex-1 content-start items-start gap-6 px-5 pb-10 lg:grid-cols-[340px_minmax(0,1fr)] lg:content-center lg:items-center lg:gap-12 lg:px-10">
        <section className="flex items-end gap-3 lg:flex-col lg:items-center lg:gap-4" aria-live="polite">
          <div className="relative shrink-0">
            <div className="cahaya-aksen absolute -inset-8 hidden lg:block" />
            <span className="lg:hidden"><Maskot key={`k-${langkah}`} pose={POSE[langkah]} ukuran="kecil" prioritas className="anim-naik" /></span>
            <span className="hidden lg:block"><Maskot key={`b-${langkah}`} pose={POSE[langkah]} ukuran="besar" prioritas className="anim-naik relative" /></span>
          </div>
          <Gelembung className="mb-3 flex-1 lg:mb-0 lg:max-w-[300px]">{KATA[langkah]}</Gelembung>
        </section>

        <section className="kaca-panel rounded-[32px] p-5 sm:p-7">
          <ol className="mb-6 flex gap-1.5" aria-label="Kemajuan">
            {LANGKAH.map((l, i) => (
              <li key={l} className={cx('h-1.5 flex-1 rounded-full transition-colors', i <= langkah ? 'bg-grafit' : 'bg-sumur')} aria-label={`${l}${i < langkah ? ' selesai' : ''}`} />
            ))}
          </ol>

          {langkah === 0 && <LangkahUsaha onLanjut={() => setLangkah(1)} onKembali={pemilikLangsung ? undefined : () => setPeran('pilih')} />}
          {langkah === 1 && (
            <>
              <h1 className="mb-1 text-[26px] font-bold tracking-[-0.03em] text-tinta">Lokasi kerja</h1>
              <p className="mb-5 text-[15px] text-tinta-2">Kalau punya beberapa cabang, tambahkan yang lain nanti.</p>
              <FormLokasi awal={null} tombol="Simpan dan lanjut" onSelesai={() => setLangkah(2)} />
            </>
          )}
          {langkah === 2 && (
            <>
              <h1 className="mb-1 text-[26px] font-bold tracking-[-0.03em] text-tinta">Jam kerja</h1>
              <p className="mb-5 text-[15px] text-tinta-2">Lewat dari toleransi, absen dihitung terlambat.</p>
              <FormShift tombol="Simpan dan lanjut" onSelesai={() => setLangkah(3)} />
              <button type="button" onClick={() => setLangkah(1)} className="mt-3 inline-flex items-center gap-1 text-[14px] font-medium text-tinta-3 hover:text-tinta"><IconChevronLeft width={16} height={16} /> Kembali</button>
            </>
          )}
          {langkah === 3 && (
            <div className="text-center">
              <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-aksen-isi text-aksen-isi-teks"><IconCheck width={30} height={30} /></span>
              <h1 className="mt-4 text-[26px] font-bold tracking-[-0.03em] text-tinta">Usahamu siap</h1>
              <p className="mx-auto mt-2 max-w-sm text-[15px] text-tinta-2">Undang karyawanmu lewat link WhatsApp. Setelah itu susun jadwalnya, dan mereka bisa langsung absen.</p>
              <div className="mt-6 flex flex-col gap-2 sm:flex-row">
                <Button variant="secondary" fullWidth onClick={() => selesai('/dashboard')}>Ke beranda</Button>
                <Button fullWidth onClick={() => selesai('/karyawan')}>Undang karyawan <IconArrowRight width={18} height={18} /></Button>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

function LangkahUsaha({ onLanjut, onKembali }: { onLanjut: () => void; onKembali?: () => void }) {
  const [nama, setNama] = useState('')
  const [jenis, setJenis] = useState(JENIS_USAHA[0])
  const [zona, setZona] = useState(() => {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone
    return ZONA.some((x) => x.v === z) ? z : 'Asia/Jakarta'
  })
  const [minggu, setMinggu] = useState<'six_day' | 'five_day'>('six_day')
  const [proses, setProses] = useState(false)
  const [galat, setGalat] = useState<string | null>(null)
  const [perluAb, setPerluAb] = useState(false)

  const buat = async (e: React.FormEvent) => {
    e.preventDefault()
    setProses(true)
    setGalat(null)
    setPerluAb(false)
    try {
      mulaiWizard()
      await api.createCompany({ displayName: nama.trim(), businessType: jenis, timezone: zona, workweekType: minggu })
      onLanjut()
    } catch (err) {
      if (err instanceof ApiError && err.body?.error === 'perlu_agentbuff') {
        setGalat(pesanMasuk(String(err.body?.reason ?? 'perlu_agentbuff')))
        setPerluAb(true)
      } else {
        setGalat(pesanGalat(err))
      }
    } finally {
      setProses(false)
    }
  }

  return (
    <form onSubmit={buat} className="flex flex-col gap-4">
      <div>
        <h1 className="text-[26px] font-bold tracking-[-0.03em] text-tinta">Tentang usahamu</h1>
        <p className="mt-1 text-[15px] text-tinta-2">Butuh sekitar 5 menit untuk semua langkah.</p>
      </div>
      <Field label="Nama usaha"><Input value={nama} onChange={(e) => setNama(e.target.value)} placeholder="mis. Warung Bu Sari" required maxLength={80} autoFocus /></Field>
      <Field label="Jenis usaha"><Select value={jenis} onChange={(e) => setJenis(e.target.value)}>{JENIS_USAHA.map((j) => <option key={j}>{j}</option>)}</Select></Field>
      <div>
        <p className="mb-1.5 text-[14px] font-medium text-tinta-2">Karyawan kerja berapa hari seminggu?</p>
        <div className="grid grid-cols-2 gap-2">
          {([['six_day', '6 hari'], ['five_day', '5 hari']] as const).map(([v, l]) => (
            <button key={v} type="button" aria-pressed={minggu === v} onClick={() => setMinggu(v)} className="kaca-ubin min-h-[52px] rounded-[18px] text-[16px] font-semibold text-tinta">{l}</button>
          ))}
        </div>
        <p className="mt-1.5 text-[13px] text-tinta-3">Dipakai untuk menghitung upah lembur di hari libur.</p>
      </div>
      <Field label="Zona waktu"><Select value={zona} onChange={(e) => setZona(e.target.value)}>{ZONA.map((z) => <option key={z.v} value={z.v}>{z.l}</option>)}</Select></Field>
      <PesanGalat>{galat}</PesanGalat>
      {perluAb && (
        <a href={`${URL_MASUK_AGENTBUFF}?next=${encodeURIComponent('/onboarding?owner=1')}`} className="tombol-kaca inline-flex min-h-[46px] items-center justify-center rounded-full text-[15px] font-semibold">
          Masuk dengan AgentBuff
        </a>
      )}
      <Button type="submit" size="lg" fullWidth loading={proses} disabled={!nama.trim()}>Lanjut <IconArrowRight width={18} height={18} /></Button>
      {onKembali && <button type="button" onClick={onKembali} className="inline-flex items-center gap-1 self-start text-[14px] font-medium text-tinta-3 hover:text-tinta"><IconChevronLeft width={16} height={16} /> Kembali</button>}
    </form>
  )
}
