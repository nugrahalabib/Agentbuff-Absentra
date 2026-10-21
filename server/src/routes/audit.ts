import { Router } from 'express'
import { z } from 'zod'
import { db } from '../lib/db.js'
import { requireCompany, requireCap } from '../lib/context.js'
import { isValidIsoDate } from '../lib/validate.js'

export const auditRouter = Router()

/**
 * Audit rows visible to a branch-scoped viewer: entries whose TARGET is an
 * entity of one of their branches (the branch itself, its employees, their
 * attendance records, leave/overtime requests, invites) or whose ACTOR is a
 * user employed in those branches. An unscoped viewer (owner) sees everything.
 */
export function auditRows(companyId: string, scopeBranchIds: string[], limit: number, filters: { from?: string; to?: string; actorType?: string } = {}): any[] {
  const where: string[] = ['a.company_id = @cid']
  const params: Record<string, unknown> = { cid: companyId, limit }
  if (filters.actorType) { where.push('a.actor_type = @actorType'); params.actorType = filters.actorType }
  if (filters.from) { where.push('a.created_at >= @from'); params.from = filters.from }
  if (filters.to) { where.push('a.created_at <= @to'); params.to = `${filters.to}T23:59:59.999Z` }
  if (scopeBranchIds.length) {
    params.scope = JSON.stringify(scopeBranchIds)
    const inScope = 'SELECT value FROM json_each(@scope)'
    const scopedEmp = `SELECT id FROM employee_profile WHERE company_id = @cid AND branch_id IN (${inScope})`
    where.push(`(
      a.target IN (${inScope})
      OR a.target IN (${scopedEmp})
      OR a.target IN (SELECT id FROM attendance_record WHERE company_id = @cid AND branch_id IN (${inScope}))
      OR a.target IN (SELECT id FROM leave_request WHERE company_id = @cid AND employee_id IN (${scopedEmp}))
      OR a.target IN (SELECT id FROM overtime_request WHERE company_id = @cid AND employee_id IN (${scopedEmp}))
      OR a.target IN (SELECT id FROM invite WHERE company_id = @cid AND branch_id IN (${inScope}))
      OR a.actor_id IN (SELECT user_id FROM employee_profile WHERE company_id = @cid AND user_id IS NOT NULL AND branch_id IN (${inScope}))
    )`)
  }
  return db.prepare(`SELECT a.* FROM audit_log a WHERE ${where.join(' AND ')} ORDER BY a.created_at DESC LIMIT @limit`).all(params) as any[]
}

/** Audit trail (PRD §9.4). Filter by time/actor; metadata is already PII-redacted. */
auditRouter.get('/audit', requireCompany, requireCap('audit.view'), (req, res) => {
  const q = z.object({
    from: z.string().refine(isValidIsoDate).optional(),
    to: z.string().refine(isValidIsoDate).optional(),
    actorType: z.enum(['user', 'agent', 'operator']).optional(),
  }).parse(req.query)
  const rows = auditRows(req.ctx!.companyId!, req.ctx!.actor!.membership.scopeBranchIds, 500, q)
  res.json(rows.map((r) => ({
    id: r.id, actorType: r.actor_type, actorId: r.actor_id, action: r.action, target: r.target,
    source: r.source, ip: r.ip, createdAt: r.created_at,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
  })))
})
