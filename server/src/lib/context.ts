/**
 * Session + tenant context. A real httpOnly cookie identifies the session; the
 * session row holds the active company_id (tenant switching re-points it, PRD §7.1.4).
 * Every request resolves the actor (membership + employee) so handlers can call
 * can(actor, capability) and scope all queries by company_id (PRD §4.3, §5.3).
 */
import type { Request, Response, NextFunction } from 'express'
import { db, now } from './db.js'
import { id } from './ids.js'
import { mapMembership } from './map.js'
import { can, type Actor, type Capability } from '../domain/rbac.js'
import { companyOpen } from './agentbuffGate.js'

export const SESSION_COOKIE = 'absentra_sid'
const SESSION_DAYS = 30

export interface Ctx {
  sessionId: string
  userId: string
  companyId: string | null
  actor: Actor | null
  employeeId: string | null
  ip?: string
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      ctx?: Ctx
    }
  }
}

export function createSession(userId: string, companyId: string | null): string {
  const sid = id('sess')
  const created = now()
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString()
  db.prepare('INSERT INTO session (id, user_id, company_id, created_at, expires_at) VALUES (?,?,?,?,?)').run(
    sid, userId, companyId, created, expires,
  )
  return sid
}

export function setSessionCompany(sessionId: string, companyId: string | null) {
  db.prepare('UPDATE session SET company_id = ? WHERE id = ?').run(companyId, sessionId)
}

export function destroySession(sessionId: string) {
  db.prepare('DELETE FROM session WHERE id = ?').run(sessionId)
}

/** Loads session → user → active membership/employee into req.ctx (or leaves undefined). */
export function loadContext(req: Request, _res: Response, next: NextFunction) {
  const sid = req.cookies?.[SESSION_COOKIE]
  if (!sid) return next()
  const sess = db.prepare('SELECT * FROM session WHERE id = ?').get(sid) as any
  if (!sess || sess.expires_at < now()) return next()

  const companyId: string | null = sess.company_id
  let actor: Actor | null = null
  let employeeId: string | null = null
  if (companyId) {
    const mrow = db.prepare('SELECT * FROM membership WHERE company_id = ? AND user_id = ?').get(companyId, sess.user_id) as any
    if (mrow) {
      const membership = mapMembership(mrow)
      const emp = db.prepare('SELECT id FROM employee_profile WHERE company_id = ? AND user_id = ?').get(companyId, sess.user_id) as any
      employeeId = emp?.id ?? undefined
      actor = { membership, employeeId: employeeId ?? undefined }
    }
  }
  req.ctx = {
    sessionId: sid,
    userId: sess.user_id,
    companyId,
    actor,
    employeeId,
    ip: req.ip,
  }
  next()
}

/** 401 if not signed in. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.ctx) return res.status(401).json({ error: 'unauthenticated' })
  next()
}

/**
 * 400 if no active tenant selected. Also the COMPANY-FREEZE gate: the whole
 * company is blocked (read + write) the moment its owner's AgentBuff access
 * lapses — but data is never deleted, so re-subscribing lifts the freeze on the
 * next check. companyOpen fails safe internally (cache + outage grace).
 */
export async function requireCompany(req: Request, res: Response, next: NextFunction) {
  if (!req.ctx) return res.status(401).json({ error: 'unauthenticated' })
  if (!req.ctx.companyId || !req.ctx.actor) return res.status(403).json({ error: 'no_active_company' })
  try {
    const open = await companyOpen(req.ctx.companyId)
    if (!open.entitled) return res.status(403).json({ error: 'company_frozen', reason: open.reason })
  } catch {
    // A gate bug must not brick the app; the login gate + fresh checks still apply.
  }
  next()
}

/** 403 unless the actor holds the capability (PRD §5.3 — same gate for UI & MCP). */
export function requireCap(capability: Capability) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.ctx?.actor) return res.status(403).json({ error: 'forbidden' })
    if (!can(req.ctx.actor, capability)) return res.status(403).json({ error: 'forbidden', capability })
    next()
  }
}
