/**
 * Absentra domain types — mirrors the PRD §10 data model.
 * Every tenant-owned entity carries `companyId` (the tenant key). The mock
 * backend enforces tenant scoping on top of these; a real backend adds RLS.
 */

export type UUID = string
export type ISODate = string // 'YYYY-MM-DD'
export type ISODateTime = string

// ---- RBAC (PRD §5.1) ----
export type Role = 'owner' | 'branch_admin' | 'hr' | 'employee'

export type MembershipStatus = 'active' | 'pending' | 'disabled'

export type WorkweekType = 'five_day' | 'six_day'

// ---- Identity (global) ----
export interface User {
  id: UUID
  googleSub: string
  email: string
  name: string
  avatarUrl?: string
}

// ---- Tenant root ----
export interface Company {
  id: UUID
  legalName: string
  displayName: string
  businessType: string
  timezone: string // e.g. 'Asia/Jakarta'
  address?: string
  logoUrl?: string
  workweekType: WorkweekType // selects overtime multiplier tier (PRD §7.2.1)
}

export interface Membership {
  id: UUID
  companyId: UUID
  userId: UUID
  role: Role
  scopeBranchIds: UUID[] // empty = all branches in tenant
  scopeDivisionIds: UUID[]
  status: MembershipStatus
}

export interface Branch {
  id: UUID
  companyId: UUID
  name: string
  address?: string
  lat: number
  long: number
  status: 'active' | 'archived'
}

export type GeofenceType = 'circle' | 'polygon'

export interface Geofence {
  id: UUID
  companyId: UUID
  branchId: UUID
  type: GeofenceType
  centerLat: number
  centerLong: number
  radiusM: number
  bufferM: number
  polygon?: Array<{ lat: number; long: number }>
}

export interface Division {
  id: UUID
  companyId: UUID
  name: string
}

export interface EmployeeProfile {
  id: UUID
  companyId: UUID
  membershipId: UUID
  userId: UUID
  name: string
  branchId: UUID
  divisionId?: UUID
  wageBasic: number // upah pokok
  wageFixedAllowance: number // tunjangan tetap
  wageVariableAllowance: number // tunjangan tidak tetap
  employmentStatus: 'active' | 'inactive'
  consentLocationAt?: ISODateTime
  consentPhotoAt?: ISODateTime
}

export interface ShiftTemplate {
  id: UUID
  companyId: UUID
  name: string
  startTime: string // 'HH:mm'
  endTime: string // 'HH:mm'
  crossesMidnight: boolean
  breakMinutes: number
  lateToleranceMinutes: number
  geofenceId?: UUID
}

export interface ShiftAssignment {
  id: UUID
  companyId: UUID
  employeeId: UUID
  shiftTemplateId: UUID
  workDate: ISODate
  status: 'scheduled' | 'completed' | 'absent'
}

export type AttendanceStatus = 'on_time' | 'late' | 'absent'
export type GeofenceResult = 'inside' | 'near' | 'outside'

export interface AttendanceRecord {
  id: UUID
  companyId: UUID
  employeeId: UUID
  branchId: UUID
  workDate: ISODate
  shiftAssignmentId?: UUID
  status: AttendanceStatus
  lateMinutes: number
  trustScore: number
  createdAt: ISODateTime
}

export type AttendanceEventType = 'clock_in' | 'clock_out'

export interface AttendanceEvent {
  id: UUID
  companyId: UUID
  attendanceRecordId: UUID
  type: AttendanceEventType
  eventTimeClient: ISODateTime
  eventTimeServer: ISODateTime
  lat: number
  long: number
  gpsAccuracy: number
  ip?: string
  deviceFingerprint?: string
  photoObjectKey?: string
  livenessPassed: boolean
  geofenceResult: GeofenceResult
  submittedOffline: boolean
  idempotencyKey: string
}

export type LeaveType = 'tahunan' | 'sakit' | 'izin' | 'tanpa_bayar'
export type RequestStatus = 'pending' | 'approved' | 'rejected'

export interface LeaveRequest {
  id: UUID
  companyId: UUID
  employeeId: UUID
  type: LeaveType
  dateStart: ISODate
  dateEnd: ISODate
  reason?: string
  status: RequestStatus
  approverId?: UUID
  decidedAt?: ISODateTime
}

export type DayType = 'workday' | 'weekly_rest' | 'public_holiday' | 'shortest_day'

export interface OvertimeRequest {
  id: UUID
  companyId: UUID
  employeeId: UUID
  workDate: ISODate
  hours: number
  dayType: DayType
  status: RequestStatus
  approverId?: UUID
  decidedAt?: ISODateTime
}

export type LateDeductionMode = 'grace_flat' | 'per_minute' | 'tiered'

export interface Policy {
  id: UUID
  companyId: UUID
  lateDeductionMode: LateDeductionMode
  lateDeductionConfig: {
    graceMinutes?: number
    flatAmount?: number
    perMinuteRate?: number
    tiers?: Array<{ uptoMinutes: number; amount: number }>
  }
  mealAllowanceConfig: {
    perPresentDay?: number
    onOvertimeMinHours?: number // mandatory meal when OT >= this (PRD §2.4.1: >= 4h)
    onOvertimeAmount?: number
  }
  strictGeofence: boolean
  trustThresholds: { accept: number; review: number } // e.g. {accept:80, review:60}
  photoRetentionDays: number
}

export interface McpConnection {
  id: UUID
  companyId: UUID
  agentName: string
  oauthClientId: string
  scopes: string[]
  scopeBranchIds: UUID[]
  status: 'active' | 'revoked'
  createdAt: ISODateTime
  lastUsedAt?: ISODateTime
}

export interface Invite {
  id: UUID
  companyId: UUID
  branchId: UUID
  divisionId?: UUID
  role: Role
  tokenJti: string
  maxUses: number
  usedCount: number
  expiresAt: ISODateTime
  createdBy: UUID
}

export type ActorType = 'user' | 'agent' | 'operator'
export type AuditSource = 'ui' | 'mcp' | 'sso'

export interface AuditLog {
  id: UUID
  companyId: UUID
  actorType: ActorType
  actorId: string
  action: string
  target?: string
  metadata?: Record<string, unknown> // PII redacted
  source: AuditSource
  ip?: string
  createdAt: ISODateTime
}
