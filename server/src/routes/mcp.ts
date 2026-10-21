import { Router } from 'express'
import { z } from 'zod'
import { db } from '../lib/db.js'
import { mapMcp } from '../lib/map.js'
import { requireCompany, requireCap } from '../lib/context.js'
import { audit } from '../lib/audit.js'
import { MCP_SCOPES, terbitkanKoneksiMcp } from '../lib/mcpKoneksi.js'

export const mcpRouter = Router()
export { sha256 } from '../lib/mcpKoneksi.js'

mcpRouter.get('/mcp/connections', requireCompany, requireCap('mcp.connection.manage'), (req, res) => {
  const rows = db.prepare('SELECT * FROM mcp_connection WHERE company_id=? ORDER BY created_at DESC').all(req.ctx!.companyId) as any[]
  res.json(rows.map(mapMcp))
})

/** Authorize a new agent connection with a chosen scope subset + branches (PRD §7.5.3). */
mcpRouter.post('/mcp/connections', requireCompany, requireCap('mcp.connection.manage'), (req, res) => {
  const body = z.object({
    agentName: z.string().trim().min(1).max(80),
    scopes: z.array(z.string()).min(1).max(MCP_SCOPES.length),
    scopeBranchIds: z.array(z.string()).max(200).default([]),
  }).parse(req.body)
  const cid = req.ctx!.companyId!
  // Least privilege is only meaningful if every scope/branch is real.
  const unknownScopes = body.scopes.filter((s) => !(MCP_SCOPES as readonly string[]).includes(s))
  if (unknownScopes.length) return res.status(400).json({ error: 'invalid_scope', scopes: unknownScopes, message: 'Ada cakupan akses yang tidak dikenal.' })
  const scopes = [...new Set(body.scopes)]
  const branchIds = [...new Set(body.scopeBranchIds)]
  const foreign = branchIds.filter((b) => !db.prepare(`SELECT id FROM branch WHERE id=? AND company_id=? AND status='active'`).get(b, cid))
  if (foreign.length) return res.status(400).json({ error: 'invalid_branch', branchIds: foreign, message: 'Ada cabang yang tidak ditemukan.' })
  // Issue an OAuth-style bearer token bound to this company_id + scope subset (PRD §7.5.3).
  // Shown once; only its hash is stored.
  const { id: mid, accessToken } = terbitkanKoneksiMcp({
    companyId: cid, agentName: body.agentName, scopes, scopeBranchIds: branchIds, createdBy: req.ctx!.userId,
  })
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: 'mcp.connection.create', target: mid, metadata: { scopes, branches: branchIds.length } })
  res.json({ ...mapMcp(db.prepare('SELECT * FROM mcp_connection WHERE id=?').get(mid)), accessToken })
})

/** Kill-switch — revoke instantly (PRD §7.5.7). */
mcpRouter.delete('/mcp/connections/:id', requireCompany, requireCap('mcp.connection.manage'), (req, res) => {
  const cid = req.ctx!.companyId!
  db.prepare(`UPDATE mcp_connection SET status='revoked' WHERE id=? AND company_id=?`).run(req.params.id, cid)
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: 'mcp.connection.revoke', target: req.params.id })
  res.json({ ok: true })
})
