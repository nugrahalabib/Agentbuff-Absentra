/**
 * Custom SSO / Webhook Gateway (PRD §7.1.3). Federates a session from a partner
 * app via a short-lived signed assertion (RS256/ES256). Verifies signature (partner
 * JWKS), issuer allowlist, aud='absentra', exp, and jti replay protection.
 */
import { Router } from 'express'
import { z } from 'zod'
import { decodeJwt } from 'jose'
import { db, now } from '../lib/db.js'
import { id } from '../lib/ids.js'
import { mapCompany, mapMembership } from '../lib/map.js'
import { SESSION_COOKIE, createSession, requireCompany, requireCap } from '../lib/context.js'
import { verifyWithJwks } from '../lib/jwt.js'
import { config } from '../lib/config.js'
import { audit } from '../lib/audit.js'

export const ssoRouter = Router()
const cookieOpts = { httpOnly: true, sameSite: 'lax' as const, secure: false, maxAge: 30 * 864e5, path: '/' }
const AUD = 'absentra'

/** Register a partner Identity Bridge (issuer + its JWKS) for this company. */
ssoRouter.post('/sso/bridges', requireCompany, requireCap('company.update'), (req, res) => {
  const body = z.object({ issuer: z.string().min(1), jwks: z.object({ keys: z.array(z.any()) }) }).parse(req.body)
  const bid = id('idb')
  db.prepare('INSERT OR REPLACE INTO identity_bridge (id, company_id, issuer, jwks, company_mapping, status, created_at) VALUES (?,?,?,?,?, \'active\', ?)')
    .run(bid, req.ctx!.companyId, body.issuer, JSON.stringify(body.jwks), req.ctx!.companyId, now())
  audit({ companyId: req.ctx!.companyId!, actorType: 'user', actorId: req.ctx!.userId, action: 'sso.bridge.register', target: body.issuer })
  res.json({ id: bid, issuer: body.issuer })
})

ssoRouter.get('/sso/bridges', requireCompany, requireCap('company.update'), (req, res) => {
  const rows = db.prepare('SELECT id, issuer, status, created_at FROM identity_bridge WHERE company_id=?').all(req.ctx!.companyId) as any[]
  res.json(rows)
})

ssoRouter.delete('/sso/bridges/:issuer', requireCompany, requireCap('company.update'), (req, res) => {
  db.prepare("UPDATE identity_bridge SET status='revoked' WHERE company_id=? AND issuer=?").run(req.ctx!.companyId, req.params.issuer)
  res.json({ ok: true })
})

/** Verify a partner assertion and federate a session. Returns the verdict + (on success) sets session cookie. */
async function federate(assertion: string): Promise<{ status: number; body: any; sid?: string }> {
  let claims: any
  try { claims = decodeJwt(assertion) } catch { return { status: 401, body: { error: 'malformed_assertion' } } }
  const issuer = claims.iss
  if (!issuer) return { status: 401, body: { error: 'missing_iss' } }
  const bridge = db.prepare("SELECT * FROM identity_bridge WHERE issuer=? AND status='active'").get(issuer) as any
  if (!bridge) return { status: 403, body: { error: 'issuer_not_allowed' } } // allowlist (TC-008)

  const v = await verifyWithJwks(assertion, JSON.parse(bridge.jwks), { issuer, audience: AUD })
  if (!v.ok) {
    // distinguishes exp / signature / aud failures (TC-009/011/012)
    return { status: 401, body: { error: 'assertion_invalid', reason: v.reason } }
  }
  const p = v.payload as any
  if (!p.jti) return { status: 401, body: { error: 'missing_jti' } }
  const seen = db.prepare('SELECT jti FROM used_jti WHERE jti=?').get(p.jti)
  if (seen) return { status: 401, body: { error: 'replay_detected' } } // (TC-010)
  db.prepare('INSERT INTO used_jti (jti, expires_at) VALUES (?,?)').run(p.jti, new Date(((p.exp ?? 0) * 1000) || Date.now() + 60000).toISOString())

  const email = String(p.email ?? `${p.sub}@${issuer}`).toLowerCase()
  let user = db.prepare('SELECT * FROM user WHERE email=? OR google_sub=?').get(email, `sso:${issuer}:${p.sub}`) as any
  if (!user) {
    const uid = id('usr')
    db.prepare('INSERT INTO user (id, google_sub, email, name, created_at) VALUES (?,?,?,?,?)').run(uid, `sso:${issuer}:${p.sub}`, email, String(p.name ?? email.split('@')[0]), now())
    user = db.prepare('SELECT * FROM user WHERE id=?').get(uid)
  }
  const companyId: string = bridge.company_mapping ?? bridge.company_id
  // Ensure membership in the mapped company (gateway may create one per partner policy).
  let mem = db.prepare('SELECT * FROM membership WHERE company_id=? AND user_id=?').get(companyId, user.id) as any
  if (!mem) {
    const mid = id('mem')
    db.prepare("INSERT INTO membership (id, company_id, user_id, role, scope_branch_ids, scope_division_ids, status, created_at) VALUES (?,?,?, 'employee','[]','[]','active', ?)").run(mid, companyId, user.id, now())
    mem = db.prepare('SELECT * FROM membership WHERE id=?').get(mid)
  }
  audit({ companyId, actorType: 'user', actorId: user.id, action: 'sso.federate', target: issuer, source: 'sso', metadata: { sub: p.sub } })
  const sid = createSession(user.id, companyId)
  const company = db.prepare('SELECT * FROM company WHERE id=?').get(companyId)
  return { status: 200, body: { ok: true, activeCompanyId: companyId, company: mapCompany(company), membership: mapMembership(mem) }, sid }
}

/** Back-channel token exchange (RFC 8693-style). */
ssoRouter.post('/sso/bridge/token', async (req, res) => {
  const body = z.object({ assertion: z.string().min(10) }).parse(req.body)
  const r = await federate(body.assertion)
  if (r.sid) res.cookie(SESSION_COOKIE, r.sid, cookieOpts)
  res.status(r.status).json(r.body)
})

/** Front-channel redirect callback. */
ssoRouter.get('/sso/bridge/callback', async (req, res) => {
  const assertion = String(req.query.token ?? '')
  if (!assertion) return res.redirect(`${config.appOrigin}/login?error=sso`)
  const r = await federate(assertion)
  if (r.sid) { res.cookie(SESSION_COOKIE, r.sid, cookieOpts); return res.redirect(`${config.appOrigin}/`) }
  res.redirect(`${config.appOrigin}/login?error=sso_${r.body?.error ?? 'failed'}`)
})
