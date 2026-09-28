import { Router } from 'express'
import { z } from 'zod'
import { db } from '../lib/db.js'
import { mapMcp } from '../lib/map.js'
import { requireCompany, requireCap } from '../lib/context.js'
import { audit } from '../lib/audit.js'
import { terbitkanKoneksiMcp } from '../lib/mcpKoneksi.js'

export const mcpRouter = Router()
export { sha256 } from '../lib/mcpKoneksi.js'

mcpRouter.get('/mcp/connections', requireCompany, requireCap('mcp.connection.manage'), (req, res) => {
  const rows = db.prepare('SELECT * FROM mcp_connection WHERE company_id=? ORDER BY created_at DESC').all(req.ctx!.companyId) as any[]
  res.json(rows.map(mapMcp))
})

/** Authorize a new agent connection with a chosen scope subset + branches (PRD §7.5.3). */
mcpRouter.post('/mcp/connections', requireCompany, requireCap('mcp.connection.manage'), (req, res) => {
  const body = z.object({
    agentName: z.string().min(1),
    scopes: z.array(z.string()).min(1),
    scopeBranchIds: z.array(z.string()).default([]),
  }).parse(req.body)
  const cid = req.ctx!.companyId!
  // Issue an OAuth-style bearer token bound to this company_id + scope subset (PRD §7.5.3).
  // Shown once; only its hash is stored.
  const { id: mid, accessToken } = terbitkanKoneksiMcp({
    companyId: cid, agentName: body.agentName, scopes: body.scopes, scopeBranchIds: body.scopeBranchIds, createdBy: req.ctx!.userId,
  })
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: 'mcp.connection.create', target: mid, metadata: { scopes: body.scopes } })
  res.json({ ...mapMcp(db.prepare('SELECT * FROM mcp_connection WHERE id=?').get(mid)), accessToken })
})

/** Kill-switch — revoke instantly (PRD §7.5.7). */
mcpRouter.delete('/mcp/connections/:id', requireCompany, requireCap('mcp.connection.manage'), (req, res) => {
  const cid = req.ctx!.companyId!
  db.prepare(`UPDATE mcp_connection SET status='revoked' WHERE id=? AND company_id=?`).run(req.params.id, cid)
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: 'mcp.connection.revoke', target: req.params.id })
  res.json({ ok: true })
})
