import { describe, it, expect } from 'vitest'
import { can } from './rbac'
import type { Membership } from './types'

function mk(role: Membership['role'], scopeBranchIds: string[] = []): Membership {
  return { id: 'm', companyId: 'c1', userId: 'u', role, scopeBranchIds, scopeDivisionIds: [], status: 'active' }
}

describe('RBAC can()', () => {
  it('owner can update company; others cannot', () => {
    expect(can({ membership: mk('owner') }, 'company.update')).toBe(true)
    expect(can({ membership: mk('branch_admin') }, 'company.update')).toBe(false)
    expect(can({ membership: mk('employee') }, 'company.update')).toBe(false)
  })

  it('only owner manages MCP connections', () => {
    expect(can({ membership: mk('owner') }, 'mcp.connection.manage')).toBe(true)
    expect(can({ membership: mk('hr') }, 'mcp.connection.manage')).toBe(false)
  })

  it('branch admin is scoped to assigned branches', () => {
    const ba = { membership: mk('branch_admin', ['b1']) }
    expect(can(ba, 'attendance.view', { branchId: 'b1' })).toBe(true)
    expect(can(ba, 'attendance.view', { branchId: 'b2' })).toBe(false)
  })

  it('employee can only view their own attendance', () => {
    const emp = { membership: mk('employee'), employeeId: 'e1' }
    expect(can(emp, 'attendance.view', { ownerEmployeeId: 'e1' })).toBe(true)
    expect(can(emp, 'attendance.view', { ownerEmployeeId: 'e2' })).toBe(false)
  })

  it('everyone can clock themselves in; employees cannot approve leave', () => {
    expect(can({ membership: mk('employee'), employeeId: 'e1' }, 'attendance.clock', { ownerEmployeeId: 'e1' })).toBe(true)
    expect(can({ membership: mk('employee') }, 'leave.approve')).toBe(false)
    expect(can({ membership: mk('hr') }, 'leave.approve')).toBe(true)
  })

  it('disabled membership is denied everything', () => {
    const disabled: Membership = { ...mk('owner'), status: 'disabled' }
    expect(can({ membership: disabled }, 'company.update')).toBe(false)
  })
})
