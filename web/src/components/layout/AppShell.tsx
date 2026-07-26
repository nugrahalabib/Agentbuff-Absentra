import { type ReactNode, type ChangeEvent, useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useSession } from '@/store/session'
import { useActor } from '@/auth/useActor'
import { can, isManager } from '@/lib/domain/rbac'
import { api } from '@/lib/api/client'
import { t } from '@/i18n'
import { Spinner } from '@/components/ui'
import {
  IconClock, IconCalendar, IconInbox, IconGrid, IconUsers, IconReceipt,
  IconBot, IconUser, IconCheck, IconLogout, IconSun, IconMoon, IconWifiOff,
  IconMapPin, IconLayers, IconSettings, IconMenu, IconX,
} from '@/components/ui/icons'

interface NavItem { to: string; label: string; icon: ReactNode; show: boolean; mobile: boolean }

export function AppShell() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { theme, toggleTheme } = useSession()
  const { actor, role, company, memberships, user, activeCompanyId, employeeId, isLoading } = useActor()
  const [online, setOnline] = useState(api.online)
  const [drawer, setDrawer] = useState(false)

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme) }, [theme])

  if (isLoading || !actor || !role) return <div className="flex h-full items-center justify-center text-text-muted"><Spinner className="h-6 w-6" /></div>

  const manager = isManager(role)
  const selfService = !!employeeId // only people with an employee profile clock in / request leave
  const items: NavItem[] = [
    { to: '/absen', label: t.nav.absen, icon: <IconClock />, show: selfService, mobile: true },
    { to: '/jadwal', label: t.nav.jadwal, icon: <IconCalendar />, show: selfService, mobile: !manager },
    { to: '/riwayat', label: 'Riwayat', icon: <IconReceipt />, show: selfService, mobile: false },
    { to: '/pengajuan', label: t.nav.pengajuan, icon: <IconInbox />, show: selfService, mobile: !manager },
    { to: '/dashboard', label: t.nav.dashboard, icon: <IconGrid />, show: can(actor, 'dashboard.view') && manager, mobile: true },
    { to: '/persetujuan', label: t.nav.persetujuan, icon: <IconCheck />, show: can(actor, 'leave.approve'), mobile: true },
    { to: '/laporan', label: 'Laporan', icon: <IconReceipt />, show: can(actor, 'report.export'), mobile: manager },
    { to: '/karyawan', label: t.nav.karyawan, icon: <IconUsers />, show: can(actor, 'employee.manage'), mobile: false },
    { to: '/shift', label: 'Shift', icon: <IconClock />, show: can(actor, 'shift_template.manage'), mobile: false },
    { to: '/cabang', label: 'Cabang', icon: <IconMapPin />, show: can(actor, 'branch.manage'), mobile: false },
    { to: '/divisi', label: 'Divisi', icon: <IconLayers />, show: can(actor, 'division.manage'), mobile: false },
    { to: '/rekap', label: t.nav.rekap, icon: <IconReceipt />, show: can(actor, 'report.payroll.generate'), mobile: false },
    { to: '/agen', label: t.nav.agen, icon: <IconBot />, show: can(actor, 'mcp.connection.manage'), mobile: false },
    { to: '/pengaturan', label: 'Pengaturan', icon: <IconSettings />, show: can(actor, 'company.update'), mobile: false },
    { to: '/profil', label: t.nav.profil, icon: <IconUser />, show: true, mobile: true },
  ]
  const visible = items.filter((i) => i.show)
  const mobileItems = visible.filter((i) => i.mobile).slice(0, 4)
  const hasOverflow = visible.length > mobileItems.length
  const showDemoOffline = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('demo')

  const toggleOnline = async () => {
    const next = !online
    api.online = next
    setOnline(next)
    if (next) { const n = await api.flushQueue(); if (n > 0) window.dispatchEvent(new CustomEvent('absentra:synced')) }
  }
  const onSwitch = async (e: ChangeEvent<HTMLSelectElement>) => {
    const cidNext = e.target.value
    if (cidNext !== activeCompanyId) { await api.switchTenant(cidNext); await qc.invalidateQueries(); navigate('/') }
  }
  const doLogout = async () => { await api.signout(); await qc.invalidateQueries({ queryKey: ['me'] }); navigate('/') }

  return (
    <div className="flex min-h-full w-full">
      {/* Desktop sidebar — sticky to the left edge, full height */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-surface-elevated p-4 lg:flex">
        <Brand />
        <nav className="mt-6 flex flex-1 flex-col gap-1 overflow-y-auto">
          {visible.map((i) => <SideLink key={i.to} to={i.to} icon={i.icon} label={i.label} onClick={() => {}} />)}
        </nav>
        <button onClick={doLogout} className="mt-2 flex items-center gap-2 rounded-md px-3 py-2 text-sm text-text-muted hover:bg-surface">
          <IconLogout width={18} height={18} /> {t.nav.keluar}
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-surface-elevated/95 px-3 py-2 backdrop-blur sm:px-4">
          {/* Hamburger (small screens) */}
          <button onClick={() => setDrawer(true)} aria-label="Menu" className="flex min-h-touch min-w-touch items-center justify-center rounded-md text-text lg:hidden">
            <IconMenu width={22} height={22} />
          </button>
          <div className="hidden sm:block lg:hidden"><Brand compact /></div>
          <div className="min-w-0 flex-1 truncate text-sm font-medium text-text-muted">{company?.displayName}</div>
          {memberships.length > 1 && (
            <select aria-label={t.common.switchTenant} value={activeCompanyId ?? ''} onChange={onSwitch} className="max-w-[8rem] truncate rounded-md border border-border bg-surface px-2 py-1 text-xs text-text">
              {memberships.map((m) => <option key={m.company.id} value={m.company.id}>{m.company.displayName}</option>)}
            </select>
          )}
          {showDemoOffline && (
            <button onClick={toggleOnline} title="Toggle online/offline (demo)" className={`flex min-h-touch items-center justify-center rounded-md px-2 ${online ? 'text-success' : 'text-danger'}`}>
              {online ? <span className="text-xs font-semibold">ONLINE</span> : <IconWifiOff width={18} height={18} />}
            </button>
          )}
          <button onClick={toggleTheme} aria-label="Tema" className="flex min-h-touch min-w-touch items-center justify-center rounded-md text-text-muted hover:bg-surface">
            {theme === 'light' ? <IconMoon width={18} height={18} /> : <IconSun width={18} height={18} />}
          </button>
        </header>

        {!online && <div className="flex items-center gap-2 bg-warning/10 px-4 py-2 text-sm text-warning"><IconWifiOff width={16} height={16} /> {t.common.offline}</div>}

        <main className="flex-1 px-3 pb-24 pt-4 sm:px-4 lg:pb-8"><Outlet /></main>
      </div>

      {/* Mobile/tablet drawer — full menu so nothing is hidden on small screens */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[80%] flex-col bg-surface-elevated p-4 shadow-lg">
            <div className="flex items-center justify-between">
              <Brand />
              <button onClick={() => setDrawer(false)} aria-label="Tutup" className="flex min-h-touch min-w-touch items-center justify-center rounded-md text-text-muted"><IconX width={20} height={20} /></button>
            </div>
            <nav className="mt-4 flex flex-1 flex-col gap-1 overflow-y-auto">
              {visible.map((i) => <SideLink key={i.to} to={i.to} icon={i.icon} label={i.label} onClick={() => setDrawer(false)} />)}
            </nav>
            <button onClick={doLogout} className="mt-2 flex items-center gap-2 rounded-md px-3 py-2 text-sm text-text-muted hover:bg-surface">
              <IconLogout width={18} height={18} /> {t.nav.keluar}
            </button>
          </aside>
        </div>
      )}

      {/* Mobile bottom nav (quick access; full menu is in the drawer) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface-elevated lg:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {mobileItems.map((i) => <BottomLink key={i.to} to={i.to} icon={i.icon} label={i.label} />)}
        {hasOverflow && (
          <button onClick={() => setDrawer(true)} className="flex min-h-touch flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] text-text-muted">
            <IconMenu width={22} height={22} /><span>Menu</span>
          </button>
        )}
      </nav>

      <span className="sr-only">{user?.name}</span>
    </div>
  )
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-on-primary"><IconCheck width={18} height={18} /></span>
      {!compact && <span className="text-lg font-bold text-text">{t.appName}</span>}
    </div>
  )
}

function SideLink({ to, icon, label, onClick }: { to: string; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <NavLink to={to} onClick={onClick} className={({ isActive }) => `flex min-h-touch items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${isActive ? 'bg-primary/10 text-primary' : 'text-text hover:bg-surface'}`}>
      {icon}{label}
    </NavLink>
  )
}

function BottomLink({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <NavLink to={to} className={({ isActive }) => `flex min-h-touch flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] ${isActive ? 'text-primary' : 'text-text-muted'}`}>
      {icon}<span>{label}</span>
    </NavLink>
  )
}
