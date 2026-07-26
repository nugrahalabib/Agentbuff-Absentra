import { Router } from 'express'
import { z } from 'zod'
import { db } from '../lib/db.js'
import { requireCompany, requireCap } from '../lib/context.js'

export const auditRouter = Router()

/** Audit trail (PRD §9.4). Filter by time/actor; metadata is already PII-redacted. */
auditRouter.get('/audit', requireCompany, requireCap('audit.view'), (req, res) => {
  const q = z.object({ from: z.string().optional(), to: z.string().optional(), actorType: z.enum(['user', 'agent', 'operator']).optional() }).parse(req.query)
  let rows = db.prepare('SELECT * FROM audit_log WHERE company_id=? ORDER BY created_at DESC LIMIT 500').all(req.ctx!.companyId) as any[]
  if (q.actorType) rows = rows.filter((r) => r.actor_type === q.actorType)
  if (q.from) rows = rows.filter((r) => r.created_at >= q.from!)
  if (q.to) rows = rows.filter((r) => r.created_at <= q.to! + 'T23:59:59.999Z')
  res.json(rows.map((r) => ({
    id: r.id, actorType: r.actor_type, actorId: r.actor_id, action: r.action, target: r.target,
    source: r.source, ip: r.ip, createdAt: r.created_at,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
  })))
})
