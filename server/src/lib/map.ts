/** Row → domain object mappers (snake_case SQLite → camelCase API). */
import type {
  Membership, Company, Branch, Geofence, Division, EmployeeProfile, ShiftTemplate,
  ShiftAssignment, AttendanceRecord, LeaveRequest, OvertimeRequest, Policy, McpConnection, User,
} from '../domain/types.js'

export const mapUser = (r: any): User => ({ id: r.id, googleSub: r.google_sub, email: r.email, name: r.name, avatarUrl: r.avatar_url ?? undefined })

export const mapCompany = (r: any): Company => ({
  id: r.id, legalName: r.legal_name, displayName: r.display_name, businessType: r.business_type,
  timezone: r.timezone, address: r.address ?? undefined, logoUrl: r.logo_url ?? undefined, workweekType: r.workweek_type,
})

export const mapMembership = (r: any): Membership => ({
  id: r.id, companyId: r.company_id, userId: r.user_id, role: r.role,
  scopeBranchIds: JSON.parse(r.scope_branch_ids), scopeDivisionIds: JSON.parse(r.scope_division_ids), status: r.status,
})

export const mapBranch = (r: any): Branch => ({
  id: r.id, companyId: r.company_id, name: r.name, address: r.address ?? undefined, lat: r.lat, long: r.long, status: r.status,
})

export const mapGeofence = (r: any): Geofence => ({
  id: r.id, companyId: r.company_id, branchId: r.branch_id, type: r.type,
  centerLat: r.center_lat, centerLong: r.center_long, radiusM: r.radius_m, bufferM: r.buffer_m,
  polygon: r.polygon ? JSON.parse(r.polygon) : undefined,
})

export const mapDivision = (r: any): Division => ({ id: r.id, companyId: r.company_id, name: r.name })

export const mapEmployee = (r: any): EmployeeProfile & { email?: string; photoData?: string } => ({
  id: r.id, companyId: r.company_id, membershipId: r.membership_id, userId: r.user_id ?? '', name: r.name,
  email: r.email ?? undefined, branchId: r.branch_id, divisionId: r.division_id ?? undefined,
  wageBasic: r.wage_basic, wageFixedAllowance: r.wage_fixed_allowance, wageVariableAllowance: r.wage_variable_allowance,
  employmentStatus: r.employment_status,
  consentLocationAt: r.consent_location_at ?? undefined, consentPhotoAt: r.consent_photo_at ?? undefined,
  photoData: r.photo_data ?? undefined,
})

export const mapShiftTemplate = (r: any): ShiftTemplate => ({
  id: r.id, companyId: r.company_id, name: r.name, startTime: r.start_time, endTime: r.end_time,
  crossesMidnight: !!r.crosses_midnight, breakMinutes: r.break_minutes, lateToleranceMinutes: r.late_tolerance_minutes,
  geofenceId: r.geofence_id ?? undefined,
})

export const mapAssignment = (r: any): ShiftAssignment => ({
  id: r.id, companyId: r.company_id, employeeId: r.employee_id, shiftTemplateId: r.shift_template_id,
  workDate: r.work_date, status: r.status,
})

export const mapAttendance = (r: any): AttendanceRecord => ({
  id: r.id, companyId: r.company_id, employeeId: r.employee_id, branchId: r.branch_id, workDate: r.work_date,
  shiftAssignmentId: r.shift_assignment_id ?? undefined, status: r.status, lateMinutes: r.late_minutes,
  trustScore: r.trust_score, createdAt: r.created_at,
})

export const mapLeave = (r: any): LeaveRequest => ({
  id: r.id, companyId: r.company_id, employeeId: r.employee_id, type: r.type, dateStart: r.date_start, dateEnd: r.date_end,
  reason: r.reason ?? undefined, status: r.status, approverId: r.approver_id ?? undefined, decidedAt: r.decided_at ?? undefined,
})

export const mapOvertime = (r: any): OvertimeRequest => ({
  id: r.id, companyId: r.company_id, employeeId: r.employee_id, workDate: r.work_date, hours: r.hours, dayType: r.day_type,
  status: r.status, approverId: r.approver_id ?? undefined, decidedAt: r.decided_at ?? undefined,
})

export const mapPolicy = (r: any): Policy => ({
  id: r.company_id, companyId: r.company_id, lateDeductionMode: r.late_deduction_mode,
  lateDeductionConfig: JSON.parse(r.late_deduction_config), mealAllowanceConfig: JSON.parse(r.meal_allowance_config),
  strictGeofence: !!r.strict_geofence, trustThresholds: JSON.parse(r.trust_thresholds), photoRetentionDays: r.photo_retention_days,
})

export const mapMcp = (r: any): McpConnection => ({
  id: r.id, companyId: r.company_id, agentName: r.agent_name, oauthClientId: r.oauth_client_id,
  scopes: JSON.parse(r.scopes), scopeBranchIds: JSON.parse(r.scope_branch_ids), status: r.status,
  createdAt: r.created_at, lastUsedAt: r.last_used_at ?? undefined,
})
