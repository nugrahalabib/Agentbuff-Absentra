/**
 * RBAC — PRD §5. One authorization function shared by every access path
 * (UI and, in a real backend, MCP tools). Roles are scoped: a Branch Admin
 * only sees the branches/divisions assigned on their membership.
 */
import type { Membership, Role } from './types'

export type Capability =
  | 'company.update'
  | 'branch.manage'
  | 'division.manage'
  | 'geofence.manage'
  | 'employee.invite'
  | 'employee.manage'
  | 'employee.view'
  | 'wage.set'
  | 'shift_template.manage'
  | 'shift_assignment.manage'
  | 'attendance.clock'
  | 'attendance.view'
  | 'attendance.correct'
  | 'leave.request'
  | 'leave.approve'
  | 'overtime.request'
  | 'overtime.approve'
  | 'policy.manage'
  | 'report.payroll.generate'
  | 'report.export'
  | 'dashboard.view'
  | 'mcp.connection.manage'
  | 'audit.view'

type Grant = 'yes' | 'scoped' | 'self' | 'no'

// Permission matrix (PRD §5.2). 'scoped' = only within assigned branch/division.
const MATRIX: Record<Capability, Record<Role, Grant>> = {
  'company.update': { owner: 'yes', branch_admin: 'no', hr: 'no', employee: 'no' },
  'branch.manage': { owner: 'yes', branch_admin: 'no', hr: 'no', employee: 'no' },
  'division.manage': { owner: 'yes', branch_admin: 'scoped', hr: 'no', employee: 'no' },
  'geofence.manage': { owner: 'yes', branch_admin: 'scoped', hr: 'no', employee: 'no' },
  'employee.invite': { owner: 'yes', branch_admin: 'scoped', hr: 'no', employee: 'no' },
  'employee.manage': { owner: 'yes', branch_admin: 'scoped', hr: 'no', employee: 'no' },
  'employee.view': { owner: 'yes', branch_admin: 'scoped', hr: 'scoped', employee: 'self' },
  'wage.set': { owner: 'yes', branch_admin: 'no', hr: 'scoped', employee: 'no' },
  'shift_template.manage': { owner: 'yes', branch_admin: 'scoped', hr: 'no', employee: 'no' },
  'shift_assignment.manage': { owner: 'yes', branch_admin: 'scoped', hr: 'scoped', employee: 'no' },
  'attendance.clock': { owner: 'self', branch_admin: 'self', hr: 'self', employee: 'self' },
  'attendance.view': { owner: 'yes', branch_admin: 'scoped', hr: 'scoped', employee: 'self' },
  'attendance.correct': { owner: 'yes', branch_admin: 'scoped', hr: 'scoped', employee: 'no' },
  'leave.request': { owner: 'self', branch_admin: 'self', hr: 'self', employee: 'self' },
  'leave.approve': { owner: 'yes', branch_admin: 'scoped', hr: 'scoped', employee: 'no' },
  'overtime.request': { owner: 'self', branch_admin: 'self', hr: 'self', employee: 'self' },
  'overtime.approve': { owner: 'yes', branch_admin: 'scoped', hr: 'scoped', employee: 'no' },
  'policy.manage': { owner: 'yes', branch_admin: 'no', hr: 'scoped', employee: 'no' },
  'report.payroll.generate': { owner: 'yes', branch_admin: 'scoped', hr: 'scoped', employee: 'no' },
  'report.export': { owner: 'yes', branch_admin: 'scoped', hr: 'scoped', employee: 'no' },
  'dashboard.view': { owner: 'yes', branch_admin: 'scoped', hr: 'scoped', employee: 'self' },
  'mcp.connection.manage': { owner: 'yes', branch_admin: 'no', hr: 'no', employee: 'no' },
  'audit.view': { owner: 'yes', branch_admin: 'scoped', hr: 'no', employee: 'no' },
}

export interface ResourceScope {
  branchId?: string
  ownerEmployeeId?: string // for 'self' checks
}

export interface Actor {
  membership: Membership
  employeeId?: string // the actor's own employee id, for self checks
}

/** can(actor, capability, resource) → boolean. Mirrors PRD §5.3. */
export function can(actor: Actor, capability: Capability, resource: ResourceScope = {}): boolean {
  if (actor.membership.status !== 'active') return false
  const grant = MATRIX[capability][actor.membership.role]
  switch (grant) {
    case 'no':
      return false
    case 'yes':
      return true
    case 'self':
      return resource.ownerEmployeeId == null || resource.ownerEmployeeId === actor.employeeId
    case 'scoped': {
      const scope = actor.membership.scopeBranchIds
      if (!scope || scope.length === 0) return true // unscoped = all branches in tenant
      if (resource.branchId == null) return true // listing; backend further filters by scope
      return scope.includes(resource.branchId)
    }
  }
}

/** Convenience: roles that may see other people's data (used for nav gating). */
export function isManager(role: Role): boolean {
  return role === 'owner' || role === 'branch_admin' || role === 'hr'
}
