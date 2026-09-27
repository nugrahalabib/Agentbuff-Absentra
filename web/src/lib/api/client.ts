/**
 * Real API client — talks to the Absentra backend over HTTP (cookie session).
 * Tenant scoping, RBAC, and the domain engines all live server-side; this is a
 * thin typed wrapper. Method names mirror the screens' existing calls; the
 * leading companyId/scope args are now derived from the session server-side and
 * are accepted-but-ignored to keep call sites stable.
 */
import type {
  AttendanceRecord, Branch, Company, Division, EmployeeProfile, Geofence,
  LeaveRequest, McpConnection, Membership, OvertimeRequest, Policy, RequestStatus,
  ShiftAssignment, ShiftTemplate, User, DayType, LeaveType, GeofenceResult, Role,
} from '../domain/types'
import type { PayrollRecapRow } from '../domain/payroll'

const BASE = '/api'

export class ApiError extends Error {
  constructor(public status: number, public body: any) {
    super(body?.error ?? `HTTP ${status}`)
    this.name = 'ApiError'
  }
}
export class OfflineError extends Error {
  constructor() { super('offline'); this.name = 'OfflineError' }
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
    ...opts,
  })
  if (!res.ok) {
    let body: any = null
    try { body = await res.json() } catch { /* */ }
    throw new ApiError(res.status, body)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}
const post = <T>(p: string, body?: unknown) => req<T>(p, { method: 'POST', body: body ? JSON.stringify(body) : undefined })
const patch = <T>(p: string, body: unknown) => req<T>(p, { method: 'PATCH', body: JSON.stringify(body) })
const del = <T>(p: string) => req<T>(p, { method: 'DELETE' })

// ---- shared types returned by the API ----
export interface MembershipWithCompany { membership: Membership; company: Company }
export interface MeResponse { user: User; memberships: MembershipWithCompany[]; activeCompanyId: string | null; employeeId: string | null; hasPassword?: boolean; passwordAuthAllowed?: boolean }
export interface BranchWithGeofence extends Branch { geofence: Geofence | null }
export interface EmployeeRow extends EmployeeProfile { email?: string; role: Role; membershipStatus: string; canSeeWage: boolean; photoData?: string }
export interface TodayContext {
  kind: 'in' | 'out' | 'none'
  assignment: ShiftAssignment | null
  template: ShiftTemplate | null
  branch: Branch | null
  geofence: Geofence | null
  record: AttendanceRecord | null
}
export interface ClockSubmission {
  companyId?: string; employeeId?: string
  kind: 'in' | 'out'
  geofenceResult: GeofenceResult
  gpsAccuracyM: number; lat: number; long: number
  livenessPassed: boolean | null
  cameraAvailable: boolean
  photoData?: string
}
export interface ClockResult { record: AttendanceRecord; trustScore: number; decision: string; reasons: string[] }
export interface AttendanceEventDetail {
  type: 'clock_in' | 'clock_out'; eventTimeServer: string; lat: number | null; long: number | null
  gpsAccuracy: number | null; geofenceResult: GeofenceResult | null; livenessPassed: number | null
  photoData: string | null; submittedOffline: boolean
}
export interface AttendanceDetail extends AttendanceRecord {
  name: string; branchName: string; clockInAt: string | null; clockOutAt: string | null
  leftEarly: boolean; reasons: string[]; events: AttendanceEventDetail[]
}
export interface FeedRow extends AttendanceRecord {
  name: string; clockInAt: string | null; clockOutAt: string | null; leftEarly: boolean
}

const QUEUE_KEY = 'absentra_offline_queue_v2'
function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36) }

class Api {
  online = true

  // ---- Auth ----
  authConfig() { return req<{ googleEnabled: boolean; passwordAuthEnabled: boolean; agentbuffEnabled?: boolean }>('/auth/config') }
  signin(email: string, name?: string, register = true, password?: string) { return post<MeResponse>('/auth/signin', { email, name, register, password }) }
  uploadProfilePhoto(photoData: string) { return post<{ ok: true }>('/me/profile-photo', { photoData }) }
  changePassword(newPassword: string, currentPassword?: string) { return post<{ ok: true; hadPassword: boolean }>('/auth/change-password', { newPassword, currentPassword }) }
  me() { return req<MeResponse>('/auth/me') }
  signout() { return post<{ ok: true }>('/auth/signout') }
  switchTenant(companyId: string) { return post<{ activeCompanyId: string }>('/auth/switch-tenant', { companyId }) }

  // ---- Company / onboarding / policy ----
  createCompany(input: { displayName: string; businessType: string; timezone: string; address?: string; workweekType: 'five_day' | 'six_day' }) {
    return post<{ company: Company; activeCompanyId: string }>('/companies', input)
  }
  company(_companyId?: string) { return req<Company>('/company') }
  updateCompany(input: Partial<{ displayName: string; legalName: string; businessType: string; timezone: string; address: string; workweekType: 'five_day' | 'six_day' }>) {
    return patch<Company>('/company', input)
  }
  policy(_companyId?: string) { return req<Policy>('/policy') }
  updatePolicy(input: Omit<Policy, 'id' | 'companyId'> & { minRestHours?: number }) { return req<Policy>('/policy', { method: 'PUT', body: JSON.stringify(input) }) }
  uploadLogo(logoData: string) { return post<Company>('/company/logo', { logoData }) }

  // ---- Branches / divisions ----
  branches(_companyId?: string, _scope?: string[]) { return req<BranchWithGeofence[]>('/branches') }
  createBranch(input: { name: string; address?: string; lat: number; long: number; radiusM?: number; bufferM?: number }) { return post<BranchWithGeofence>('/branches', input) }
  updateBranch(id: string, input: Partial<{ name: string; address: string; lat: number; long: number; radiusM: number; bufferM: number }>) { return patch<BranchWithGeofence>(`/branches/${id}`, input) }
  archiveBranch(id: string) { return post(`/branches/${id}/archive`) }
  divisions(_companyId?: string) { return req<Division[]>('/divisions') }
  createDivision(name: string) { return post<Division>('/divisions', { name }) }
  updateDivision(id: string, name: string) { return patch<Division>(`/divisions/${id}`, { name }) }
  deleteDivision(id: string) { return del(`/divisions/${id}`) }

  // ---- Shifts ----
  shiftTemplates(_companyId?: string) { return req<ShiftTemplate[]>('/shift-templates') }
  createShiftTemplate(input: { name: string; startTime: string; endTime: string; crossesMidnight?: boolean; breakMinutes?: number; lateToleranceMinutes?: number; geofenceId?: string }) { return post<ShiftTemplate>('/shift-templates', input) }
  updateShiftTemplate(id: string, input: Partial<{ name: string; startTime: string; endTime: string; crossesMidnight: boolean; breakMinutes: number; lateToleranceMinutes: number }>) { return patch<ShiftTemplate>(`/shift-templates/${id}`, input) }
  assignmentsForEmployee(_companyId: string | undefined, employeeId: string | undefined, from: string, to: string) {
    const q = new URLSearchParams({ from, to })
    if (employeeId) q.set('employeeId', employeeId)
    return req<{ assignment: ShiftAssignment; template: ShiftTemplate }[]>(`/shift-assignments?${q}`)
  }
  bulkAssign(input: { employeeIds: string[]; shiftTemplateId: string; dateStart: string; dateEnd?: string; skipSundays?: boolean }) { return post<{ created: number }>('/shift-assignments', input) }

  // ---- Employees / invites ----
  employees(_companyId?: string, _scope?: string[]) { return req<EmployeeRow[]>('/employees') }
  createEmployee(input: { name: string; email: string; branchId: string; divisionId?: string; role?: Role; scopeBranchIds?: string[]; wageBasic?: number; wageFixedAllowance?: number; wageVariableAllowance?: number }) { return post<EmployeeProfile>('/employees', input) }
  updateEmployee(id: string, input: Partial<{ name: string; branchId: string; divisionId: string | null; role: Role; scopeBranchIds: string[]; employmentStatus: 'active' | 'inactive'; wageBasic: number; wageFixedAllowance: number; wageVariableAllowance: number }>) { return patch<EmployeeProfile>(`/employees/${id}`, input) }
  deleteEmployee(id: string) { return del(`/employees/${id}`) }
  resetEmployeePassword(id: string, newPassword?: string) { return post<{ temporaryPassword: string }>(`/employees/${id}/reset-password`, { newPassword }) }
  invites() { return req<Array<{ id: string; branchId: string; divisionId?: string; role: string; token: string; maxUses: number; usedCount: number; expiresAt: string }>>('/invites') }
  createInvite(input: { branchId: string; divisionId?: string; role?: Role; maxUses?: number; expiresInDays?: number; wageBasic?: number; wageFixedAllowance?: number }) { return post<{ id: string; token: string; expiresAt: string }>('/invites', input) }
  deleteInvite(id: string) { return del(`/invites/${id}`) }
  inviteInfo(token: string) { return req<{ valid: boolean; companyName?: string; branchName?: string; role?: string }>(`/invites/token/${token}`) }
  acceptInvite(token: string, consent: { consentLocation: boolean; consentPhoto: boolean }) { return post<{ companyId: string }>(`/invites/token/${token}/accept`, consent) }

  // ---- Attendance ----
  todayContext(_companyId?: string, _employeeId?: string) { return req<TodayContext>('/attendance/today-context') }
  async submitClock(sub: ClockSubmission): Promise<ClockResult> {
    if (!this.online) throw new OfflineError()
    return post<ClockResult>('/attendance/clock', { ...this.clockBody(sub), idempotencyKey: uid() })
  }
  private clockBody(sub: ClockSubmission) {
    return {
      kind: sub.kind, lat: sub.lat, long: sub.long, gpsAccuracyM: sub.gpsAccuracyM,
      livenessPassed: sub.livenessPassed, cameraAvailable: sub.cameraAvailable, photoData: sub.photoData,
      geofenceResult: sub.geofenceResult,
    }
  }
  dashboardSummary(_companyId?: string, branchId?: string) { return req<{ present: number; late: number; notYet: number; onLeave: number; overtime: number; totalEmployees: number }>(`/dashboard/summary${branchId ? `?branchId=${branchId}` : ''}`) }
  dashboardTrends(branchId?: string, days = 7) { const q = new URLSearchParams({ days: String(days) }); if (branchId) q.set('branchId', branchId); return req<Array<{ date: string; present: number; late: number }>>(`/dashboard/trends?${q}`) }
  liveFeed(_companyId?: string, branchId?: string) { return req<FeedRow[]>(`/attendance/feed${branchId ? `?branchId=${branchId}` : ''}`) }
  anomalies(_companyId?: string, branchId?: string) { return req<FeedRow[]>(`/attendance/anomalies${branchId ? `?branchId=${branchId}` : ''}`) }
  attendanceList(from: string, to: string, branchId?: string) { const q = new URLSearchParams({ from, to }); if (branchId) q.set('branchId', branchId); return req<Array<FeedRow & { branchName: string }>>(`/attendance/list?${q}`) }
  myAttendance(from: string, to: string) { return req<FeedRow[]>(`/me/attendance?from=${from}&to=${to}`) }
  attendanceDetail(id: string) { return req<AttendanceDetail>(`/attendance/${id}`) }
  correctAttendance(id: string, body: { status?: 'on_time' | 'late' | 'absent'; lateMinutes?: number; resolveFlag?: boolean; reason: string }) { return post<AttendanceRecord>(`/attendance/${id}/correct`, body) }
  importEmployees(input: { branchId: string; divisionId?: string; rows: Array<{ name: string; email: string; wageBasic?: number; wageFixedAllowance?: number }> }) { return post<{ created: number; skipped: string[] }>('/employees/import', input) }

  // ---- Requests ----
  listLeaves(_companyId?: string, employeeId?: string) { return req<Array<LeaveRequest & { name: string }>>(`/leaves${employeeId ? '?mine=1' : ''}`) }
  listOvertimes(_companyId?: string, employeeId?: string) { return req<Array<OvertimeRequest & { name: string }>>(`/overtimes${employeeId ? '?mine=1' : ''}`) }
  createLeave(input: { companyId?: string; employeeId?: string; type: LeaveType; dateStart: string; dateEnd: string; reason?: string; attachmentName?: string }) {
    return post<LeaveRequest>('/leaves', { type: input.type, dateStart: input.dateStart, dateEnd: input.dateEnd, reason: input.reason, attachmentName: input.attachmentName })
  }
  createOvertime(input: { companyId?: string; employeeId?: string; workDate: string; hours: number; dayType: DayType }) {
    return post<OvertimeRequest>('/overtimes', { workDate: input.workDate, hours: input.hours, dayType: input.dayType })
  }
  pendingApprovals(_companyId?: string, _scope?: string[]) { return req<{ leaves: Array<LeaveRequest & { name: string }>; overtimes: Array<OvertimeRequest & { name: string }> }>('/approvals/pending') }
  decideLeave(_companyId: string | undefined, id: string, status: RequestStatus, _approverId?: string) { return post<LeaveRequest>(`/leaves/${id}/decision`, { status }) }
  decideOvertime(_companyId: string | undefined, id: string, status: RequestStatus, _approverId?: string) { return post<OvertimeRequest>(`/overtimes/${id}/decision`, { status }) }

  // ---- Payroll ----
  generatePayroll(_companyId: string | undefined, periodStart: string, periodEnd: string, _scope?: string[], branchId?: string) {
    return post<PayrollRecapRow[]>('/reports/payroll', { periodStart, periodEnd, branchId })
  }
  employeeReport(employeeId: string, from: string, to: string) {
    const q = new URLSearchParams({ employeeId, from, to })
    return req<import('@/features/reports/EmployeeReportDocument').EmployeeReport>(`/reports/employee?${q}`)
  }

  // ---- MCP ----
  mcpConnections(_companyId?: string) { return req<McpConnection[]>('/mcp/connections') }
  createMcp(input: { agentName: string; scopes: string[]; scopeBranchIds?: string[] }) { return post<McpConnection & { accessToken: string }>('/mcp/connections', input) }
  revokeMcp(_companyId: string | undefined, id: string) { return del(`/mcp/connections/${id}`) }

  // ---- Offline queue (client-side) ----
  enqueueOffline(sub: ClockSubmission) {
    const q = this.readQueue()
    q.push({ ...sub, queuedAt: new Date().toISOString() })
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q))
  }
  readQueue(): Array<ClockSubmission & { queuedAt: string }> {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') } catch { return [] }
  }
  async flushQueue(): Promise<number> {
    if (!this.online) return 0
    const q = this.readQueue()
    for (const item of q) {
      try { await post('/attendance/clock', { ...this.clockBody(item), idempotencyKey: uid() }) } catch { /* keep going */ }
    }
    localStorage.setItem(QUEUE_KEY, '[]')
    return q.length
  }
}

export const api = new Api()
