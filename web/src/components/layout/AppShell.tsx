/**
 * Kerangka aplikasi (gaya AgentBuff /app): menu samping kaca mengambang di laptop,
 * bilah atas menyatu dengan latar, dan bilah tab bawah + menu "Lainnya" di HP.
 */
import { type ReactNode, Suspense, useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useActor } from '@/auth/useActor'
import { useKeluar } from '@/auth/useKeluar'
import { can, isManager } from '@/lib/domain/rbac'
import { api } from '@/lib/api/client'
import { BottomSheet, Spinner, cx } from '@/components/ui'
import { LogoAbsentra } from '@/components/merek'
import { toast } from '@/components/Toast'
import { pesanGalat } from '@/lib/galat'
import { bacaPilihanTema, simpanPilihanTema, temaEfektif } from '@/lib/tema'
import {
  IconBot, IconCalendar, IconCheck, IconChevronRight, IconClock, IconGrid, IconHistory, IconInbox, IconLayers,
  IconLogout, IconMapPin, IconMenu, IconMoon, IconReceipt, IconSettings, IconSun, IconSwitch, IconUser, IconUsers, IconWifiOff,
} from '@/components/ui/icons'

interface ItemNav {
  to: string
  label: string
  ikon: ReactNode
  hitung?: number
}
interface KelompokNav {
  judul?: string
  item: ItemNav[]
}

const PERAN: Record<string, string> = { owner: 'Pemilik', branch_admin: 'Admin cabang', hr: 'HR', employee: 'Karyawan' }

function inisial(nama?: string | null): string {
  const bagian = (nama ?? '').trim().split(/\s+/).filter(Boolean)
  return ((bagian[0]?.[0] ?? '') + (bagian[1]?.[0] ?? '')).toUpperCase() || 'A'
}

export function AppShell() {
  const navigate = useNavigate()
  const lokasi = useLocation()
  const qc = useQueryClient()
  const { actor, role, company, memberships, user, activeCompanyId, employeeId, isLoading } = useActor()
  const [laci, setLaci] = useState(false)
  const [gantiUsaha, setGantiUsaha] = useState(false)
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false))
  const [antrean, setAntrean] = useState(() => api.antreanSaya().length)
  const [tema, setTema] = useState(() => temaEfektif(bacaPilihanTema()))

  const manager = role ? isManager(role) : false
  const bolehSetujui = !!actor && can(actor, 'leave.approve')
  const tertunda = useQuery({
    queryKey: ['approvals', 'hitung', activeCompanyId],
    enabled: bolehSetujui,
    refetchInterval: 60_000,
    queryFn: () => api.pendingApprovals(),
    select: (d) => d.leaves.length + d.overtimes.length,
  })

  // Antrean absen offline: kirim saat online, saat aplikasi dibuka, dan berkala selama masih ada.
  const kirimAntrean = useCallback(async () => {
    if (api.antreanSaya().length === 0) return
    const h = await api.flushQueue()
    setAntrean(h.tersisa)
    if (h.terkirim > 0) {
      toast.berhasil(h.terkirim === 1 ? 'Absen yang tertunda sudah terkirim.' : `${h.terkirim} absen yang tertunda sudah terkirim.`)
      qc.invalidateQueries({ queryKey: ['todayContext'] })
      qc.invalidateQueries({ queryKey: ['myAttendance'] })
      window.dispatchEvent(new CustomEvent('absentra:synced'))
    }
    if (h.ditolak.length > 0) toast.galat('Ada absen tertunda yang ditolak server. Minta admin mencatat manual.')
  }, [qc])

  useEffect(() => {
    const naik = () => { setOnline(true); void kirimAntrean() }
    const turun = () => setOnline(false)
    const ubahAntrean = () => setAntrean(api.antreanSaya().length)
    const ubahTema = () => setTema(temaEfektif(bacaPilihanTema()))
    const kirimManual = () => {
      if (!api.online) { toast.galat('Belum ada sinyal. Absen akan terkirim otomatis begitu online.'); return }
      void kirimAntrean()
    }
    window.addEventListener('online', naik)
    window.addEventListener('absentra:kirim-antrean', kirimManual)
    window.addEventListener('offline', turun)
    window.addEventListener('absentra:antrean', ubahAntrean)
    window.addEventListener('absentra:tema', ubahTema)
    void kirimAntrean()
    const t = window.setInterval(() => { if (api.antreanSaya().length) void kirimAntrean() }, 30_000)
    return () => {
      window.removeEventListener('online', naik)
      window.removeEventListener('absentra:kirim-antrean', kirimManual)
      window.removeEventListener('offline', turun)
      window.removeEventListener('absentra:antrean', ubahAntrean)
      window.removeEventListener('absentra:tema', ubahTema)
      window.clearInterval(t)
    }
  }, [kirimAntrean])

  useEffect(() => { setLaci(false) }, [lokasi.pathname])

  if (isLoading || !actor || !role) {
    return <div className="flex min-h-[100dvh] items-center justify-center text-tinta-3"><Spinner className="h-6 w-6" /></div>
  }

  const kelompok: KelompokNav[] = []
  if (manager) {
    kelompok.push({
      item: [
        { to: '/dashboard', label: 'Beranda', ikon: <IconGrid /> },
        ...(bolehSetujui ? [{ to: '/persetujuan', label: 'Persetujuan', ikon: <IconCheck />, hitung: tertunda.data ?? 0 }] : []),
      ],
    })
    const tim: ItemNav[] = []
    if (can(actor, 'employee.manage')) tim.push({ to: '/karyawan', label: 'Karyawan', ikon: <IconUsers /> })
    if (can(actor, 'shift_template.manage')) tim.push({ to: '/shift', label: 'Shift & jadwal', ikon: <IconClock /> })
    if (can(actor, 'branch.manage')) tim.push({ to: '/cabang', label: 'Lokasi kerja', ikon: <IconMapPin /> })
    if (can(actor, 'division.manage')) tim.push({ to: '/divisi', label: 'Divisi', ikon: <IconLayers /> })
    if (tim.length) kelompok.push({ judul: 'Tim', item: tim })
    const laporan: ItemNav[] = []
    if (can(actor, 'report.export')) laporan.push({ to: '/laporan', label: 'Laporan absensi', ikon: <IconReceipt /> })
    if (can(actor, 'report.payroll.generate')) laporan.push({ to: '/rekap', label: 'Rekap gaji', ikon: <IconInbox /> })
    if (laporan.length) kelompok.push({ judul: 'Laporan', item: laporan })
  }
  if (employeeId) {
    kelompok.push({
      judul: manager ? 'Absen saya' : undefined,
      item: [
        { to: '/absen', label: 'Absen', ikon: <IconClock /> },
        { to: '/jadwal', label: manager ? 'Jadwal saya' : 'Jadwal', ikon: <IconCalendar /> },
        { to: '/riwayat', label: 'Riwayat', ikon: <IconHistory /> },
        { to: '/pengajuan', label: 'Cuti & lembur', ikon: <IconInbox /> },
      ],
    })
  }
  const dasar: ItemNav[] = []
  if (can(actor, 'mcp.connection.manage')) dasar.push({ to: '/agen', label: 'Agen AI', ikon: <IconBot /> })
  if (can(actor, 'company.update')) dasar.push({ to: '/pengaturan', label: 'Pengaturan', ikon: <IconSettings /> })
  if (dasar.length) kelompok.push({ judul: 'Lainnya', item: dasar })

  const tabHp: ItemNav[] = manager
    ? [
        { to: '/dashboard', label: 'Beranda', ikon: <IconGrid /> },
        ...(bolehSetujui ? [{ to: '/persetujuan', label: 'Setujui', ikon: <IconCheck />, hitung: tertunda.data ?? 0 }] : []),
        ...(can(actor, 'employee.manage') ? [{ to: '/karyawan', label: 'Karyawan', ikon: <IconUsers /> }] : []),
        ...(employeeId ? [{ to: '/absen', label: 'Absen', ikon: <IconClock /> }] : can(actor, 'report.export') ? [{ to: '/laporan', label: 'Laporan', ikon: <IconReceipt /> }] : []),
      ].slice(0, 4)
    : [
        { to: '/absen', label: 'Absen', ikon: <IconClock /> },
        { to: '/jadwal', label: 'Jadwal', ikon: <IconCalendar /> },
        { to: '/riwayat', label: 'Riwayat', ikon: <IconHistory /> },
        { to: '/pengajuan', label: 'Cuti', ikon: <IconInbox /> },
      ]

  const keluar = useKeluar()
  const pindahUsaha = async (cid: string) => {
    if (cid === activeCompanyId) { setGantiUsaha(false); return }
    try {
      await api.switchTenant(cid)
      qc.clear()
      setGantiUsaha(false)
      navigate('/', { replace: true })
    } catch (e) {
      toast.galat(pesanGalat(e))
    }
  }
  const balikTema = () => simpanPilihanTema(tema === 'dark' ? 'terang' : 'gelap')

  const kartuUsaha = (
    <button
      type="button"
      onClick={() => (memberships.length > 1 ? setGantiUsaha(true) : navigate(can(actor, 'company.update') ? '/pengaturan' : '/profil'))}
      className="kaca-pil flex w-full items-center gap-3 rounded-[18px] px-3 py-2.5 text-left"
    >
      {company?.logoUrl ? (
        <img src={company.logoUrl} alt="" className="h-8 w-8 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-grafit text-[13px] font-bold text-grafit-teks">{inisial(company?.displayName)}</span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-tinta">{company?.displayName}</span>
        <span className="block truncate text-[12px] text-tinta-3">{PERAN[role] ?? role}</span>
      </span>
      {memberships.length > 1 ? <IconSwitch width={16} height={16} className="shrink-0 text-tinta-3" /> : <IconChevronRight width={16} height={16} className="shrink-0 text-tinta-3" />}
    </button>
  )

  const daftarMenu = (padaLaci: boolean) => (
    <nav aria-label="Menu utama" className={padaLaci ? 'flex flex-col gap-4' : 'flex flex-col gap-2'}>
      {kelompok.map((k, i) => (
        <div key={i}>
          {k.judul && <p className="mb-1 px-3 text-[13px] font-semibold text-tinta-3">{k.judul}</p>}
          <div className="flex flex-col gap-0.5">
            {k.item.map((it) => <TautanSamping key={it.to} item={it} besar={padaLaci} />)}
          </div>
        </div>
      ))}
    </nav>
  )

  return (
    <div className="min-h-[100dvh] lg:flex">
      {/* Menu samping laptop */}
      <aside className="panel-samping sticky top-3 m-3 hidden h-[calc(100dvh-24px)] w-[264px] shrink-0 flex-col rounded-[28px] p-4 lg:flex">
        <div className="px-1 pb-4 pt-1"><LogoAbsentra ukuran={32} /></div>
        {kartuUsaha}
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">{daftarMenu(false)}</div>
        <NavLink to="/profil" className={({ isActive }) => cx('mt-3 flex items-center gap-3 rounded-[18px] px-3 py-2.5', isActive ? 'bg-permukaan shadow-lembut' : 'hover:bg-sumur')}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-grafit text-[13px] font-bold text-grafit-teks">{inisial(user?.name)}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold text-tinta">{user?.name}</span>
            <span className="block truncate text-[12px] text-tinta-3">{user?.email}</span>
          </span>
        </NavLink>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Bilah atas HP */}
        <header className="kaca-bilah sticky top-0 z-30 flex items-center gap-2 px-4 py-2.5 lg:hidden" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}>
          <LogoAbsentra ukuran={28} teks={false} />
          <button type="button" onClick={() => (memberships.length > 1 ? setGantiUsaha(true) : undefined)} className="min-w-0 flex-1 text-left">
            <span className="block truncate text-[15px] font-semibold text-tinta">{company?.displayName}</span>
            <span className="block truncate text-[12px] text-tinta-3">{PERAN[role] ?? role}{memberships.length > 1 ? ' · ganti usaha' : ''}</span>
          </button>
          <StatusSinyal online={online} antrean={antrean} />
          <button type="button" onClick={balikTema} aria-label={tema === 'dark' ? 'Pakai mode terang' : 'Pakai mode gelap'} className="flex h-10 w-10 items-center justify-center rounded-full text-tinta-2 hover:bg-sumur">
            {tema === 'dark' ? <IconSun width={20} height={20} /> : <IconMoon width={20} height={20} />}
          </button>
          <NavLink to="/profil" aria-label="Akun saya" className="flex h-10 w-10 items-center justify-center rounded-full bg-grafit text-[13px] font-bold text-grafit-teks">
            {inisial(user?.name)}
          </NavLink>
        </header>

        {/* Bilah atas laptop: menyatu dengan latar */}
        <div className="hidden items-center justify-end gap-2 px-8 pt-5 lg:flex">
          <StatusSinyal online={online} antrean={antrean} />
          <button type="button" onClick={balikTema} className="kaca-pil flex h-10 items-center gap-2 rounded-full px-4 text-[14px] font-medium text-tinta-2 hover:text-tinta">
            {tema === 'dark' ? <IconSun width={18} height={18} /> : <IconMoon width={18} height={18} />}
            {tema === 'dark' ? 'Mode terang' : 'Mode gelap'}
          </button>
        </div>

        <main className="flex-1 overflow-x-clip px-4 pb-[calc(env(safe-area-inset-bottom)+104px)] pt-5 sm:px-6 lg:px-8 lg:pb-12 lg:pt-3">
          <div key={lokasi.pathname} className="anim-naik">
            <Suspense fallback={<div className="flex justify-center py-20 text-tinta-3"><Spinner className="h-6 w-6" /></div>}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>

      {/* Bilah tab HP */}
      <nav aria-label="Menu cepat" className="kaca-kaki fixed inset-x-0 bottom-0 z-40 flex px-2 lg:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {tabHp.map((it) => <TautanTab key={it.to} item={it} />)}
        <button type="button" onClick={() => setLaci(true)} className="flex min-h-[64px] flex-1 flex-col items-center justify-center gap-1 text-[12px] font-medium text-tinta-3">
          <IconMenu width={22} height={22} />
          <span>Lainnya</span>
        </button>
      </nav>

      <BottomSheet open={laci} onClose={() => setLaci(false)} title="Menu">
        <div className="flex flex-col gap-4">
          {kartuUsaha}
          {daftarMenu(true)}
          <div className="flex flex-col gap-0.5 border-t border-garis pt-3">
            <TautanSamping item={{ to: '/profil', label: 'Akun saya', ikon: <IconUser /> }} besar />
            <button type="button" onClick={keluar} className="flex min-h-[48px] items-center gap-3 rounded-2xl px-3 text-[16px] font-medium text-galat hover:bg-galat-lembut">
              <IconLogout width={20} height={20} /> Keluar
            </button>
          </div>
        </div>
      </BottomSheet>

      <BottomSheet open={gantiUsaha} onClose={() => setGantiUsaha(false)} title="Ganti usaha" keterangan="Akunmu terdaftar di lebih dari satu usaha.">
        <div className="flex flex-col gap-2">
          {memberships.map((m) => (
            <button
              key={m.company.id}
              type="button"
              onClick={() => pindahUsaha(m.company.id)}
              data-aktif={m.company.id === activeCompanyId}
              className="kaca-ubin flex min-h-[56px] items-center gap-3 rounded-2xl px-4 text-left"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-grafit text-[13px] font-bold text-grafit-teks">{inisial(m.company.displayName)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold text-tinta">{m.company.displayName}</span>
                <span className="block text-[13px] text-tinta-3">{PERAN[m.membership.role] ?? m.membership.role}</span>
              </span>
              {m.company.id === activeCompanyId && <IconCheck width={18} height={18} className="text-tinta" />}
            </button>
          ))}
        </div>
      </BottomSheet>
    </div>
  )
}

function TautanSamping({ item, besar }: { item: ItemNav; besar?: boolean }) {
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cx(
          'relative flex items-center gap-3 rounded-[14px] px-3 font-medium transition-colors',
          besar ? 'min-h-[48px] text-[16px]' : 'min-h-[38px] text-[15px]',
          isActive ? 'bg-permukaan text-tinta shadow-lembut ring-1 ring-garis' : 'text-tinta-2 hover:bg-sumur hover:text-tinta',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span aria-hidden className="absolute left-1 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-aksen" />}
          <span className="[&>svg]:h-[20px] [&>svg]:w-[20px]">{item.ikon}</span>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {!!item.hitung && <span className="rounded-full bg-perlu-lembut px-2 py-0.5 text-[12px] font-bold text-perlu">{item.hitung}</span>}
        </>
      )}
    </NavLink>
  )
}

function TautanTab({ item }: { item: ItemNav }) {
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cx('relative flex min-h-[64px] flex-1 flex-col items-center justify-center gap-1 text-[12px] font-medium', isActive ? 'text-tinta' : 'text-tinta-3')
      }
    >
      {({ isActive }) => (
        <>
          <span className={cx('flex h-8 w-14 items-center justify-center rounded-full transition-colors [&>svg]:h-[22px] [&>svg]:w-[22px]', isActive && 'bg-sumur')}>{item.ikon}</span>
          <span className={isActive ? 'font-semibold' : ''}>{item.label}</span>
          {!!item.hitung && (
            <span className="absolute right-[calc(50%-24px)] top-2 min-w-[18px] rounded-full bg-perlu px-1 text-center text-[11px] font-bold leading-[18px] text-kanvas">{item.hitung}</span>
          )}
        </>
      )}
    </NavLink>
  )
}

function StatusSinyal({ online, antrean }: { online: boolean; antrean: number }) {
  if (online && antrean === 0) return null
  return (
    <span
      className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-perlu-lembut px-3 text-[13px] font-semibold text-perlu"
      role="status"
      aria-label={online ? `${antrean} absen menunggu dikirim` : antrean > 0 ? `Offline, ${antrean} absen menunggu dikirim` : 'Offline'}
    >
      <IconWifiOff width={16} height={16} />
      {/* Di HP cukup angka supaya nama usaha tetap terbaca. */}
      <span className="sm:hidden">{online ? antrean : antrean > 0 ? `Offline · ${antrean}` : 'Offline'}</span>
      <span className="hidden sm:inline">{online ? `${antrean} absen menunggu` : antrean > 0 ? `Offline · ${antrean} menunggu` : 'Offline'}</span>
    </span>
  )
}
