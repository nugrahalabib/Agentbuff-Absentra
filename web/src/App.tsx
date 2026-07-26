import { type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useActor } from '@/auth/useActor'
import { can, type Capability } from '@/lib/domain/rbac'
import { Spinner } from '@/components/ui'
import { AppShell } from '@/components/layout/AppShell'
import { LandingPage } from '@/features/landing/LandingPage'
import { LoginPage } from '@/features/login/LoginPage'
import { RegisterOwnerPage } from '@/features/login/RegisterOwnerPage'
import { OnboardingPage } from '@/features/onboarding/OnboardingPage'
import { InviteAcceptPage } from '@/features/invite/InviteAcceptPage'
import { AbsenPage } from '@/features/attendance/AbsenPage'
import { RiwayatSayaPage } from '@/features/attendance/RiwayatSayaPage'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { JadwalPage } from '@/features/schedule/JadwalPage'
import { PengajuanPage } from '@/features/requests/PengajuanPage'
import { ApprovalsPage } from '@/features/approvals/ApprovalsPage'
import { EmployeesPage } from '@/features/employees/EmployeesPage'
import { BranchesPage } from '@/features/org/BranchesPage'
import { DivisionsPage } from '@/features/org/DivisionsPage'
import { ShiftsPage } from '@/features/org/ShiftsPage'
import { SettingsPage } from '@/features/org/SettingsPage'
import { LaporanPage } from '@/features/reports/LaporanPage'
import { PayrollPage } from '@/features/payroll/PayrollPage'
import { McpPage } from '@/features/mcp/McpPage'
import { ProfilPage } from '@/features/profile/ProfilPage'

const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5_000 } } })

function FullSpinner() {
  return <div className="flex h-full items-center justify-center"><Spinner className="h-6 w-6 text-primary" /></div>
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoading, isSignedIn, activeCompanyId } = useActor()
  if (isLoading) return <FullSpinner />
  if (!isSignedIn) return <Navigate to="/login" replace />
  if (!activeCompanyId) return <Navigate to="/onboarding" replace />
  return <>{children}</>
}

function OnboardingGate() {
  const { isLoading, isSignedIn, activeCompanyId } = useActor()
  if (isLoading) return <FullSpinner />
  if (!isSignedIn) return <Navigate to="/login" replace />
  if (activeCompanyId) return <Navigate to="/absen" replace />
  return <OnboardingPage />
}

function RequireCap({ capability, children }: { capability: Capability; children: ReactNode }) {
  const { actor, isLoading } = useActor()
  if (isLoading) return <FullSpinner />
  if (!actor || !can(actor, capability)) return <Navigate to="/absen" replace />
  return <>{children}</>
}

/** "/" — public landing for visitors; signed-in users go straight to the app. */
function LandingOrHome() {
  const { isLoading, isSignedIn, activeCompanyId, role } = useActor()
  if (isLoading) return <FullSpinner />
  if (!isSignedIn) return <LandingPage />
  if (!activeCompanyId) return <Navigate to="/onboarding" replace />
  const manager = role === 'owner' || role === 'branch_admin' || role === 'hr'
  return <Navigate to={manager ? '/dashboard' : '/absen'} replace />
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingOrHome />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/daftar" element={<RegisterOwnerPage />} />
          <Route path="/invite/:token" element={<InviteAcceptPage />} />
          <Route path="/onboarding" element={<OnboardingGate />} />
          <Route element={<RequireAuth><AppShell /></RequireAuth>}>
            <Route path="/absen" element={<AbsenPage />} />
            <Route path="/jadwal" element={<JadwalPage />} />
            <Route path="/riwayat" element={<RiwayatSayaPage />} />
            <Route path="/pengajuan" element={<PengajuanPage />} />
            <Route path="/dashboard" element={<RequireCap capability="dashboard.view"><DashboardPage /></RequireCap>} />
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
      </BrowserRouter>
    </QueryClientProvider>
  )
}
