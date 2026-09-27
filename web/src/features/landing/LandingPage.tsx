import { useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useSession } from '@/store/session'
import { t } from '@/i18n'
import {
  IconCheck, IconClock, IconMapPin, IconCamera, IconAlert, IconReceipt, IconBot,
  IconUsers, IconUser, IconGrid, IconWifiOff, IconSun, IconMoon, IconCheckCircle,
} from '@/components/ui/icons'
import { AuthModal, type AuthModalMode } from '@/features/login/AuthModal'
import { pesanMasuk } from '@/lib/pesanMasuk'

/** Public marketing landing for Absentra (shown at "/" to visitors). */
export function LandingPage() {
  const { theme, toggleTheme } = useSession()
  const [searchParams, setSearchParams] = useSearchParams()
  const [authMode, setAuthMode] = useState<AuthModalMode | null>(() => {
    const a = searchParams.get('auth')
    return a === 'login' || a === 'register' ? a : null
  })
  const oauthError = searchParams.get('error')

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme) }, [theme])

  // Sync deep-links /login → /?auth=login (and OAuth error redirects)
  useEffect(() => {
    const a = searchParams.get('auth')
    if (a === 'login' || a === 'register') setAuthMode(a)
  }, [searchParams])

  const openAuth = (mode: AuthModalMode) => {
    setAuthMode(mode)
    setSearchParams({ auth: mode }, { replace: false })
  }
  const closeAuth = () => {
    setAuthMode(null)
    setSearchParams({}, { replace: true })
  }
  const switchMode = (mode: AuthModalMode) => {
    setAuthMode(mode)
    setSearchParams({ auth: mode }, { replace: true })
  }

  return (
    <div className="min-h-full bg-surface text-text">
      <Nav theme={theme} onToggleTheme={toggleTheme} onLogin={() => openAuth('login')} onRegister={() => openAuth('register')} />
      <Hero onRegister={() => openAuth('register')} />
      <Stats />
      <Features />
      <HowItWorks />
      <Personas />
      <FreeTrust />
      <FinalCta onLogin={() => openAuth('login')} onRegister={() => openAuth('register')} />
      <Footer />

      {oauthError && authMode === 'login' && (
        <div className="fixed left-1/2 top-4 z-[60] w-[min(100%-2rem,24rem)] -translate-x-1/2 rounded-md bg-danger/10 p-3 text-center text-sm text-danger shadow-lg" role="alert">
          {pesanMasuk(oauthError)}
        </div>
      )}

      <AuthModal
        open={authMode != null}
        mode={authMode ?? 'login'}
        onClose={closeAuth}
        onSwitchMode={switchMode}
      />
    </div>
  )
}

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-on-primary"><IconCheck width={18} height={18} /></span>
      <span className="text-lg font-bold tracking-tight">{t.appName}</span>
    </div>
  )
}

function Nav({
  theme, onToggleTheme, onLogin, onRegister,
}: {
  theme: string
  onToggleTheme: () => void
  onLogin: () => void
  onRegister: () => void
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
        <Brand />
        <nav className="hidden items-center gap-6 text-sm text-text-muted md:flex">
          <a href="#fitur" className="hover:text-text">Fitur</a>
          <a href="#cara" className="hover:text-text">Cara Kerja</a>
          <a href="#untuk-siapa" className="hover:text-text">Untuk Siapa</a>
        </nav>
        <div className="flex items-center gap-2">
          <button onClick={onToggleTheme} aria-label="Tema" className="flex min-h-touch min-w-touch items-center justify-center rounded-md text-text-muted hover:bg-surface-elevated">
            {theme === 'light' ? <IconMoon width={18} height={18} /> : <IconSun width={18} height={18} />}
          </button>
          <button type="button" onClick={onLogin} className="flex min-h-touch items-center px-3 text-sm font-medium text-text hover:text-primary">Masuk</button>
          <button type="button" onClick={onRegister} className="flex min-h-touch items-center rounded-md bg-primary px-4 text-sm font-semibold text-on-primary hover:bg-primary-pressed">Daftar Gratis</button>
        </div>
      </div>
    </header>
  )
}

function Hero({ onRegister }: { onRegister: () => void }) {
  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent" />
      <div className="relative mx-auto max-w-5xl px-5 pb-10 pt-16 text-center sm:pt-20">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-elevated px-4 py-1.5 text-xs font-medium text-text-muted">
          <IconCheckCircle width={14} height={14} className="text-success" /> 100% Gratis · Tanpa Hardware · Patuh PP 35/2021
        </span>
        <h1 className="mt-6 font-serif text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
          Absensi enterprise-grade,<br className="hidden sm:block" /> gratis untuk setiap <span className="text-primary">UMKM</span>.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base text-text-muted sm:text-lg">
          Ganti buku absen & mesin fingerprint mahal dengan absensi berbasis browser: geofence, foto, anti-fraud, dan rekap payroll otomatis sesuai hukum. Bisa dijalankan agen AI lewat <span className="font-medium text-text">MCP</span>.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <button type="button" onClick={onRegister} className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-md bg-primary px-6 font-semibold text-on-primary hover:bg-primary-pressed sm:w-auto">
            Daftar & Buat Perusahaan <span aria-hidden>→</span>
          </button>
          <a href="#cara" className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-md border border-border bg-surface-elevated px-6 font-semibold text-text hover:bg-surface sm:w-auto">
            Lihat Cara Kerja
          </a>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-text-muted">
          <span className="flex items-center gap-1"><IconClock width={14} height={14} /> Aktif &lt; 10 menit</span>
          <span className="flex items-center gap-1"><IconMapPin width={14} height={14} /> Geofence + foto</span>
          <span className="flex items-center gap-1"><IconWifiOff width={14} height={14} /> Tahan koneksi buruk</span>
        </div>
        <HeroMockup />
      </div>
    </section>
  )
}
function HeroMockup() {
  return (
    <div className="mx-auto mt-12 flex max-w-4xl items-end justify-center gap-4">
      {/* Dashboard browser frame */}
      <div className="hidden flex-1 overflow-hidden rounded-xl border border-border bg-surface-elevated shadow-lg sm:block">
        <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
          <span className="h-2.5 w-2.5 rounded-full bg-danger/60" /><span className="h-2.5 w-2.5 rounded-full bg-warning/60" /><span className="h-2.5 w-2.5 rounded-full bg-success/60" />
          <span className="ml-2 truncate rounded bg-surface px-2 py-0.5 text-[10px] text-text-muted">absentra.app/dashboard</span>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-3 gap-2">
            {[['Hadir', '18', 'text-success'], ['Telat', '2', 'text-warning'], ['Belum', '4', 'text-text-muted']].map(([l, v, c]) => (
              <div key={l} className="rounded-lg border border-border p-3">
                <div className={`text-2xl font-bold ${c}`}>{v}</div>
                <div className="text-[10px] text-text-muted">{l}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-end gap-1.5" style={{ height: 64 }}>
            {[40, 70, 55, 85, 60, 95, 75].map((h, i) => (
              <div key={i} className="flex-1 rounded-t bg-primary/30" style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>
      </div>
      {/* Phone — Absen */}
      <div className="w-44 shrink-0 overflow-hidden rounded-[1.5rem] border-4 border-text/80 bg-surface-elevated shadow-xl">
        <div className="bg-gradient-to-br from-primary to-primary-pressed p-4 text-on-primary">
          <p className="text-[10px] opacity-90">Halo, Andi</p>
          <p className="text-xs opacity-90">Shift Pagi · 08:00</p>
          <p className="mt-3 text-lg font-bold">Belum Absen</p>
        </div>
        <div className="p-3">
          <div className="flex items-center justify-center rounded-lg bg-primary py-3 text-sm font-semibold text-on-primary">
            <IconClock width={16} height={16} /> <span className="ml-1">Absen Masuk</span>
          </div>
          <div className="mt-2 flex items-center gap-1 text-[10px] text-success"><IconMapPin width={10} height={10} /> Di dalam area · trust 100</div>
        </div>
      </div>
    </div>
  )
}

function Stats() {
  const items = [['1/173', 'rumus upah/jam PP 35/2021'], ['0', 'biaya hardware'], ['100%', 'isolasi antar-tenant'], ['MCP', 'siap untuk agen AI']]
  return (
    <section className="border-y border-border bg-surface-elevated">
      <div className="mx-auto grid max-w-5xl grid-cols-2 gap-6 px-5 py-8 md:grid-cols-4">
        {items.map(([v, l]) => (
          <div key={l} className="text-center">
            <div className="font-serif text-2xl font-bold text-primary">{v}</div>
            <div className="mt-1 text-xs text-text-muted">{l}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

const FEATURES: { icon: ReactNode; title: string; desc: string }[] = [
  { icon: <IconMapPin />, title: 'Absen browser, zero-hardware', desc: 'Karyawan absen dari HP: deteksi lokasi (geofence Haversine/poligon) + foto kamera depan. Tak perlu mesin fingerprint.' },
  { icon: <IconAlert />, title: 'Anti-fraud yang jujur', desc: 'Trust score multi-sinyal (geofence, akurasi GPS, impossible travel, liveness) menandai anomali untuk ditinjau — bukan memblokir karyawan jujur.' },
  { icon: <IconReceipt />, title: 'Rekap payroll PP 35/2021', desc: 'Lembur, potongan telat, dan uang makan dihitung otomatis & presisi sesuai hukum. Ekspor CSV/PDF siap-payroll.' },
  { icon: <IconGrid />, title: 'Multi-tenant terisolasi', desc: 'Ribuan UMKM berbagi satu platform dengan isolasi data mutlak per perusahaan. Satu akun bisa di banyak perusahaan.' },
  { icon: <IconBot />, title: 'Agentic-native (MCP)', desc: 'Hubungkan agen AI lewat Model Context Protocol — “rekap absen Cabang A minggu ini” dijalankan headless, ber-scope & teraudit.' },
  { icon: <IconCamera />, title: 'PWA, tahan koneksi buruk', desc: 'Mobile-first, ringan, hemat data. Absen offline masuk antrean lalu tersinkron otomatis saat online.' },
]

function Features() {
  return (
    <section id="fitur" className="mx-auto max-w-6xl px-5 py-16">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Fitur</p>
        <h2 className="mt-2 font-serif text-3xl font-bold sm:text-4xl">Bukan sekadar absen — sistem kehadiran yang utuh</h2>
      </div>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-xl border border-border bg-surface-elevated p-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">{f.icon}</span>
            <h3 className="mt-3 font-semibold text-text">{f.title}</h3>
            <p className="mt-1 text-sm text-text-muted">{f.desc}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

const STEPS = [
  { n: 1, title: 'Daftar & buat perusahaan', desc: 'Pemilik daftar dengan Google, isi profil usaha — zona waktu, minggu kerja 5/6 hari.' },
  { n: 2, title: 'Atur cabang, shift & karyawan', desc: 'Tetapkan geofence cabang, template shift, lalu undang karyawan via link/QR atau impor CSV.' },
  { n: 3, title: 'Karyawan absen 2 ketukan', desc: 'Buka link, beri consent, lalu absen masuk/keluar dari HP — lokasi + foto otomatis terverifikasi.' },
  { n: 4, title: 'Pantau & rekap payroll', desc: 'Dashboard real-time + anomaly inbox, lalu hasilkan rekap payroll PP 35/2021 siap ekspor.' },
]

function HowItWorks() {
  return (
    <section id="cara" className="border-y border-border bg-surface-elevated">
      <div className="mx-auto max-w-6xl px-5 py-16">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Cara Kerja</p>
          <h2 className="mt-2 font-serif text-3xl font-bold sm:text-4xl">Dari nol ke karyawan-pertama-absen dalam menit</h2>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <div key={s.n} className="relative rounded-xl border border-border bg-surface p-5">
              <span className="absolute right-4 top-3 font-serif text-3xl font-bold text-border">{s.n}</span>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-on-primary">{s.n}</span>
              <h3 className="mt-3 font-semibold text-text">{s.title}</h3>
              <p className="mt-1 text-sm text-text-muted">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

const PERSONAS = [
  { icon: <IconUser />, title: 'Pemilik UMKM', desc: 'Tahu “siapa hadir hari ini” & “berapa lembur bulan ini” dalam sekali lihat. Rekap benar, tanpa ribet.' },
  { icon: <IconUsers />, title: 'Admin Cabang / HR', desc: 'Susun jadwal shift, setujui cuti/lembur, dan koreksi anomali — terbatas pada cabang yang diampu.' },
  { icon: <IconClock />, title: 'Karyawan', desc: 'Absen dua ketukan walau sinyal pas-pasan, tanpa instal aplikasi. Lihat jadwal & riwayat sendiri.' },
  { icon: <IconBot />, title: 'Agen AI', desc: 'Driver MCP yang menjalankan tugas headless dengan izin & audit setara pengguna manusia.' },
]

function Personas() {
  return (
    <section id="untuk-siapa" className="mx-auto max-w-6xl px-5 py-16">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Untuk Siapa</p>
        <h2 className="mt-2 font-serif text-3xl font-bold sm:text-4xl">Satu platform, semua peran</h2>
      </div>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PERSONAS.map((p) => (
          <div key={p.title} className="rounded-xl border border-border bg-surface-elevated p-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">{p.icon}</span>
            <h3 className="mt-3 font-semibold text-text">{p.title}</h3>
            <p className="mt-1 text-sm text-text-muted">{p.desc}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function FreeTrust() {
  return (
    <section className="mx-auto max-w-6xl px-5 pb-4">
      <div className="grid gap-4 rounded-2xl border border-border bg-surface-elevated p-6 sm:grid-cols-2 sm:p-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Kenapa gratis?</p>
          <h2 className="mt-2 font-serif text-2xl font-bold">Gratis selamanya untuk UMKM</h2>
          <p className="mt-2 text-sm text-text-muted">Model shared-schema yang hemat membuat kami bisa melayani ribuan UMKM tanpa biaya per-karyawan. Tanpa paywall, tanpa biaya tersembunyi.</p>
        </div>
        <ul className="flex flex-col justify-center gap-2 text-sm">
          {['Login frictionless via Google', 'Data lokasi & foto terenkripsi, patuh UU PDP (consent + retensi)', 'Audit setiap aksi sensitif — termasuk oleh agen AI', 'Bisa dipasang di HP sebagai PWA, tanpa app store'].map((x) => (
            <li key={x} className="flex items-start gap-2 text-text-muted"><IconCheckCircle width={16} height={16} className="mt-0.5 shrink-0 text-success" /> {x}</li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function FinalCta({ onLogin, onRegister }: { onLogin: () => void; onRegister: () => void }) {
  return (
    <section className="mx-auto max-w-6xl px-5 py-16">
      <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-primary-pressed px-6 py-12 text-center text-on-primary sm:px-10">
        <h2 className="font-serif text-3xl font-bold sm:text-4xl">Siap menggantikan buku absen?</h2>
        <p className="mx-auto mt-3 max-w-xl text-on-primary/90">Mulai gratis hari ini. Tanpa kartu kredit, tanpa biaya tersembunyi — karyawan pertama bisa absen kurang dari 10 menit.</p>
        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <button type="button" onClick={onRegister} className="flex min-h-[52px] w-full items-center justify-center rounded-md bg-surface px-6 font-semibold text-primary hover:opacity-90 sm:w-auto">Daftar & Buat Perusahaan</button>
          <button type="button" onClick={onLogin} className="flex min-h-[52px] w-full items-center justify-center rounded-md border border-on-primary/30 px-6 font-semibold text-on-primary hover:bg-on-primary/10 sm:w-auto">Sudah punya akun? Masuk</button>
        </div>
        <p className="mt-4 text-xs text-on-primary/80">Karyawan? Buka link undangan dari admin tempat kerjamu.</p>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 text-sm text-text-muted sm:flex-row">
        <div className="flex items-center gap-2"><Brand /></div>
        <p className="text-center">Absensi enterprise-grade, gratis, untuk setiap UMKM Indonesia.</p>
        <p>© 2026 {t.appName}</p>
      </div>
    </footer>
  )
}
