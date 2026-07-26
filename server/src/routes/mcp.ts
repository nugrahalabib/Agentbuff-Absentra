import { Router } from 'express'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { db, now } from '../lib/db.js'
import { id, token } from '../lib/ids.js'
import { mapMcp } from '../lib/map.js'
import { requireCompany, requireCap } from '../lib/context.js'
import { audit } from '../lib/audit.js'

export const mcpRouter = Router()
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

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
  const mid = id('mcp')
  // Issue an OAuth-style bearer token bound to this company_id + scope subset (PRD §7.5.3).
  // Shown once; only its hash is stored.
  const accessToken = `mcp_${token()}${token()}`
  db.prepare(`INSERT INTO mcp_connection (id, company_id, agent_name, oauth_client_id, scopes, scope_branch_ids, status, created_at, token_hash) VALUES (?,?,?,?,?,?, 'active', ?, ?)`).run(
    mid, cid, body.agentName, `cli_${id('')}`.slice(0, 16), JSON.stringify(body.scopes), JSON.stringify(body.scopeBranchIds), now(), sha256(accessToken),
  )
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
