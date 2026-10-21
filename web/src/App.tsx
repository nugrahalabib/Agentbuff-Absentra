import { type ReactNode, Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useActor } from '@/auth/useActor'
import { can, isManager, type Capability } from '@/lib/domain/rbac'
import { Spinner } from '@/components/ui'
import { Toaster } from '@/components/Toast'
import { wizardAktif } from '@/features/onboarding/wizard'

// Tiap halaman dimuat saat dibuka: pengunjung landing tidak mengunduh aplikasi admin,
// karyawan tidak mengunduh layar laporan. Ringan di HP murah.
const AppShell = lazy(() => import('@/components/layout/AppShell').then((m) => ({ default: m.AppShell })))
const LandingPage = lazy(() => import('@/features/landing/LandingPage'))
const MasukPage = lazy(() => import('@/features/login/MasukPage'))
const OnboardingPage = lazy(() => import('@/features/onboarding/OnboardingPage'))
const InviteAcceptPage = lazy(() => import('@/features/invite/InviteAcceptPage'))
const AbsenPage = lazy(() => import('@/features/attendance/AbsenPage'))
const RiwayatSayaPage = lazy(() => import('@/features/attendance/RiwayatSayaPage'))
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'))
const JadwalPage = lazy(() => import('@/features/schedule/JadwalPage'))
const PengajuanPage = lazy(() => import('@/features/requests/PengajuanPage'))
const ApprovalsPage = lazy(() => import('@/features/approvals/ApprovalsPage'))
const EmployeesPage = lazy(() => import('@/features/employees/EmployeesPage'))
const BranchesPage = lazy(() => import('@/features/org/BranchesPage'))
const DivisionsPage = lazy(() => import('@/features/org/DivisionsPage'))
const ShiftsPage = lazy(() => import('@/features/org/ShiftsPage'))
const SettingsPage = lazy(() => import('@/features/org/SettingsPage'))
const LaporanPage = lazy(() => import('@/features/reports/LaporanPage'))
const PayrollPage = lazy(() => import('@/features/payroll/PayrollPage'))
const McpPage = lazy(() => import('@/features/mcp/McpPage'))
const ProfilPage = lazy(() => import('@/features/profile/ProfilPage'))

const qc = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 10_000, refetchOnWindowFocus: true },
    mutations: { retry: 0 },
  },
})

function Memuat() {
  return (
    <div className="flex min-h-[60dvh] items-center justify-center text-tinta-3">
      <Spinner className="h-6 w-6" />
    </div>
  )
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoading, isSignedIn, activeCompanyId } = useActor()
  if (isLoading) return <Memuat />
  if (!isSignedIn) return <Navigate to="/masuk" replace />
  if (!activeCompanyId) return <Navigate to="/onboarding" replace />
  return <>{children}</>
}

function OnboardingGate() {
  const { isLoading, isSignedIn, activeCompanyId } = useActor()
  if (isLoading) return <Memuat />
  if (!isSignedIn) return <Navigate to="/masuk" replace />
  // Wizard pemilik masih berjalan (perusahaan sudah dibuat di langkah 1): jangan diusir.
  if (activeCompanyId && !wizardAktif()) return <Navigate to="/" replace />
  return <OnboardingPage />
}

function RequireCap({ capability, children, kelola = false }: { capability: Capability; children: ReactNode; kelola?: boolean }) {
  const { actor, role, isLoading } = useActor()
  if (isLoading) return <Memuat />
  if (!actor || !role || !can(actor, capability) || (kelola && !isManager(role))) return <Navigate to="/" replace />
  return <>{children}</>
}

function RequireEmployee({ children }: { children: ReactNode }) {
  const { employeeId, isLoading } = useActor()
  if (isLoading) return <Memuat />
  if (!employeeId) return <Navigate to="/" replace />
  return <>{children}</>
}

/** "/": landing untuk pengunjung; yang sudah masuk langsung ke halaman utamanya. */
function LandingOrHome() {
  const { isLoading, isSignedIn, activeCompanyId, role, employeeId } = useActor()
  if (isLoading) return <Memuat />
  if (!isSignedIn) return <LandingPage />
  if (!activeCompanyId) return <Navigate to="/onboarding" replace />
  if (role && isManager(role)) return <Navigate to="/dashboard" replace />
  return <Navigate to={employeeId ? '/absen' : '/profil'} replace />
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Suspense fallback={<Memuat />}>
          <Routes>
            <Route path="/" element={<LandingOrHome />} />
            <Route path="/masuk" element={<MasukPage mode="masuk" />} />
            <Route path="/login" element={<MasukPage mode="masuk" />} />
            <Route path="/daftar" element={<MasukPage mode="daftar" />} />
            <Route path="/invite/:token" element={<InviteAcceptPage />} />
            <Route path="/onboarding" element={<OnboardingGate />} />
            <Route element={<RequireAuth><AppShell /></RequireAuth>}>
              <Route path="/absen" element={<RequireEmployee><AbsenPage /></RequireEmployee>} />
              <Route path="/jadwal" element={<RequireEmployee><JadwalPage /></RequireEmployee>} />
              <Route path="/riwayat" element={<RequireEmployee><RiwayatSayaPage /></RequireEmployee>} />
              <Route path="/pengajuan" element={<RequireEmployee><PengajuanPage /></RequireEmployee>} />
              <Route path="/dashboard" element={<RequireCap capability="dashboard.view" kelola><DashboardPage /></RequireCap>} />
              <Route path="/persetujuan" element={<RequireCap capability="leave.approve"><ApprovalsPage /></RequireCap>} />
              <Route path="/karyawan" element={<RequireCap capability="employee.manage"><EmployeesPage /></RequireCap>} />
              <Route path="/cabang" element={<RequireCap capability="branch.manage"><BranchesPage /></RequireCap>} />
              <Route path="/divisi" element={<RequireCap capability="division.manage"><DivisionsPage /></RequireCap>} />
              <Route path="/shift" element={<RequireCap capability="shift_template.manage"><ShiftsPage /></RequireCap>} />
              <Route path="/laporan" element={<RequireCap capability="report.export"><LaporanPage /></RequireCap>} />
              <Route path="/rekap" element={<RequireCap capability="report.payroll.generate"><PayrollPage /></RequireCap>} />
              <Route path="/agen" element={<RequireCap capability="mcp.connection.manage"><McpPage /></RequireCap>} />
              <Route path="/pengaturan" element={<RequireCap capability="company.update"><SettingsPage /></RequireCap>} />
              <Route path="/profil" element={<ProfilPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
        <Toaster />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
