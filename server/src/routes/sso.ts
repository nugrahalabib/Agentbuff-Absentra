/**
 * Custom SSO / Webhook Gateway (PRD §7.1.3). Federates a session from a partner
 * app via a short-lived signed assertion (RS256/ES256). Verifies signature (partner
 * JWKS), issuer allowlist, aud='absentra', exp (≤5 min ahead), and jti replay.
 *
 * Hardened for public launch:
 *   • OFF unless the platform operator sets SSO_BRIDGE_OPERATOR_SECRET — every
 *     /sso route answers 404 otherwise. Registering a bridge additionally needs
 *     the `x-operator-secret` header (a tenant owner alone cannot trust a key).
 *   • A federated identity is keyed ONLY by (issuer, sub) and lives in the
 *     bridge's own company. An assertion's `email` is never used to find an
 *     existing account, so a partner key can never mint a session for someone
 *     else's Absentra/Google/AgentBuff user.
 *   • An issuer belongs to exactly one company; another tenant cannot take it over.
 */
import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { decodeJwt } from 'jose'
import { createHash, timingSafeEqual } from 'node:crypto'
import { db, now } from '../lib/db.js'
import { id } from '../lib/ids.js'
import { mapCompany, mapMembership } from '../lib/map.js'
import { SESSION_COOKIE, SESSION_MAX_AGE_MS, createSession, destroySession, requireCompany, requireCap } from '../lib/context.js'
import { verifyWithJwks } from '../lib/jwt.js'
import { config } from '../lib/config.js'
import { audit } from '../lib/audit.js'
import { cookieOpts } from '../lib/httpSecurity.js'
import { LIMITS } from '../lib/rateLimit.js'

export const ssoRouter = Router()
const AUD = 'absentra'
const MAX_ASSERTION_LIFETIME_S = 300

const operatorSecret = () => process.env.SSO_BRIDGE_OPERATOR_SECRET ?? ''

function sameSecret(a: string, b: string): boolean {
  const x = createHash('sha256').update(a).digest()
  const y = createHash('sha256').update(b).digest()
  return timingSafeEqual(x, y)
}

// Feature gate: the whole SSO surface is invisible until the operator enables it.
ssoRouter.use('/sso', (_req: Request, res: Response, next: NextFunction) => {
  if (!operatorSecret()) return res.status(404).json({ error: 'not_found' })
  next()
})

function requireOperatorSecret(req: Request, res: Response, next: NextFunction) {
  const given = req.get('x-operator-secret') ?? ''
  if (!given || !sameSecret(given, operatorSecret())) return res.status(403).json({ error: 'operator_secret_required' })
  next()
}

/** Register (or rotate the keys of) this company's partner Identity Bridge. */
ssoRouter.post('/sso/bridges', requireCompany, requireCap('company.update'), requireOperatorSecret, (req, res) => {
  const body = z.object({
    issuer: z.string().url().max(300),
    jwks: z.object({ keys: z.array(z.record(z.any())).min(1).max(10) }),
  }).parse(req.body)
  // Only public signing keys: a JWK carrying private material ("d") is a mistake we refuse.
  if (body.jwks.keys.some((k) => 'd' in k || (k.alg && !/^(RS|ES|PS)\d{3}$/.test(String(k.alg))))) {
    return res.status(400).json({ error: 'invalid_jwks', message: 'Hanya kunci publik RS/ES/PS yang diterima.' })
  }
  const cid = req.ctx!.companyId!
  const existing = db.prepare('SELECT * FROM identity_bridge WHERE issuer=?').get(body.issuer) as any
  if (existing && existing.company_id !== cid) return res.status(409).json({ error: 'issuer_taken', message: 'Issuer ini sudah terdaftar untuk perusahaan lain.' })
  let bid: string
  if (existing) {
    bid = existing.id
    db.prepare("UPDATE identity_bridge SET jwks=?, company_mapping=?, status='active' WHERE id=? AND company_id=?").run(JSON.stringify(body.jwks), cid, bid, cid)
  } else {
    bid = id('idb')
    db.prepare("INSERT INTO identity_bridge (id, company_id, issuer, jwks, company_mapping, status, created_at) VALUES (?,?,?,?,?, 'active', ?)")
      .run(bid, cid, body.issuer, JSON.stringify(body.jwks), cid, now())
  }
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: 'sso.bridge.register', target: body.issuer })
  res.json({ id: bid, issuer: body.issuer })
})

ssoRouter.get('/sso/bridges', requireCompany, requireCap('company.update'), (req, res) => {
  const rows = db.prepare('SELECT id, issuer, status, created_at FROM identity_bridge WHERE company_id=?').all(req.ctx!.companyId) as any[]
  res.json(rows)
})

/** Kill-switch (owner, no operator secret needed — revoking must always be easy). */
ssoRouter.delete('/sso/bridges/:issuer', requireCompany, requireCap('company.update'), (req, res) => {
  db.prepare("UPDATE identity_bridge SET status='revoked' WHERE company_id=? AND issuer=?").run(req.ctx!.companyId, req.params.issuer)
  audit({ companyId: req.ctx!.companyId!, actorType: 'user', actorId: req.ctx!.userId, action: 'sso.bridge.revoke', target: req.params.issuer })
  res.json({ ok: true })
})

/** Verify a partner assertion and federate a session (never throws). */
async function federate(assertion: string): Promise<{ status: number; body: any; userId?: string; companyId?: string }> {
  let claims: any
  try { claims = decodeJwt(assertion) } catch { return { status: 401, body: { error: 'malformed_assertion' } } }
  const issuer = typeof claims.iss === 'string' ? claims.iss : ''
  if (!issuer) return { status: 401, body: { error: 'missing_iss' } }
  const bridge = db.prepare("SELECT * FROM identity_bridge WHERE issuer=? AND status='active'").get(issuer) as any
  if (!bridge) return { status: 403, body: { error: 'issuer_not_allowed' } } // allowlist (TC-008)

  let jwks: any
  try { jwks = JSON.parse(bridge.jwks) } catch { return { status: 500, body: { error: 'internal' } } }
  const v = await verifyWithJwks(assertion, jwks, { issuer, audience: AUD })
  if (!v.ok) {
    // distinguishes exp / signature / aud failures (TC-009/011/012)
    return { status: 401, body: { error: 'assertion_invalid', reason: v.reason } }
  }
  const p = v.payload as any
  if (typeof p.sub !== 'string' || !p.sub || p.sub.length > 200) return { status: 401, body: { error: 'missing_sub' } }
  if (typeof p.jti !== 'string' || !p.jti || p.jti.length > 200) return { status: 401, body: { error: 'missing_jti' } }
  const nowS = Math.floor(Date.now() / 1000)
  if (typeof p.exp !== 'number' || p.exp - nowS > MAX_ASSERTION_LIFETIME_S) return { status: 401, body: { error: 'assertion_invalid', reason: 'exp_too_far' } }
  const jtiKey = `${bridge.id}:${p.jti}`
  if (db.prepare('SELECT jti FROM used_jti WHERE jti=?').get(jtiKey)) return { status: 401, body: { error: 'replay_detected' } } // (TC-010)
  db.prepare('INSERT INTO used_jti (jti, expires_at) VALUES (?,?)').run(jtiKey, new Date(p.exp * 1000).toISOString())

  const companyId: string = bridge.company_id
  const claimedEmail = typeof p.email === 'string' ? p.email.toLowerCase().slice(0, 254) : null
  let ext = db.prepare('SELECT * FROM external_identity WHERE issuer=? AND sub=?').get(issuer, p.sub) as any
  if (ext && ext.company_id !== companyId) return { status: 403, body: { error: 'identity_other_company' } }
  if (!ext) {
    // A brand-new, bridge-local account. Its email is synthetic and unique so it
    // can never collide with — or be matched to — an existing user.
    const uid = id('usr')
    const synthetic = `sso.${bridge.id}.${createHash('sha256').update(p.sub).digest('hex').slice(0, 20)}@sso.absentra.invalid`
    const name = String(p.name ?? claimedEmail?.split('@')[0] ?? 'Pengguna SSO').slice(0, 120)
    const tx = db.transaction(() => {
      db.prepare('INSERT INTO user (id, google_sub, email, name, created_at) VALUES (?,?,?,?,?)').run(uid, `sso:${bridge.id}:${p.sub}`, synthetic, name, now())
      db.prepare('INSERT INTO external_identity (id, company_id, issuer, sub, user_id, claimed_email, created_at) VALUES (?,?,?,?,?,?,?)')
        .run(id('ext'), companyId, issuer, p.sub, uid, claimedEmail, now())
      db.prepare("INSERT INTO membership (id, company_id, user_id, role, scope_branch_ids, scope_division_ids, status, created_at) VALUES (?,?,?, 'employee','[]','[]','active', ?)")
        .run(id('mem'), companyId, uid, now())
    })
    tx()
    ext = db.prepare('SELECT * FROM external_identity WHERE issuer=? AND sub=?').get(issuer, p.sub)
  }
  const mem = db.prepare('SELECT * FROM membership WHERE company_id=? AND user_id=?').get(companyId, ext.user_id) as any
  if (!mem || mem.status !== 'active') return { status: 403, body: { error: 'membership_inactive' } }
  audit({ companyId, actorType: 'user', actorId: ext.user_id, action: 'sso.federate', target: issuer, source: 'sso', metadata: { sub: p.sub } })
  const company = db.prepare('SELECT * FROM company WHERE id=?').get(companyId)
  return {
    status: 200,
    body: { ok: true, activeCompanyId: companyId, company: mapCompany(company), membership: mapMembership(mem) },
    userId: ext.user_id, companyId,
  }
}

function setFederatedSession(req: Request, res: Response, userId: string, companyId: string) {
  const prev = req.cookies?.[SESSION_COOKIE]
  if (typeof prev === 'string' && prev) destroySession(prev)
  res.cookie(SESSION_COOKIE, createSession(userId, companyId), cookieOpts(req, SESSION_MAX_AGE_MS))
}

/** Back-channel token exchange (RFC 8693-style). */
ssoRouter.post('/sso/bridge/token', LIMITS.sso, (req, res, next) => {
  const parsed = z.object({ assertion: z.string().min(10).max(8000) }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'validation', detail: parsed.error.issues })
  federate(parsed.data.assertion)
    .then((r) => {
      if (r.userId && r.companyId) setFederatedSession(req, res, r.userId, r.companyId)
      res.status(r.status).json(r.body)
    })
    .catch(next)
})

/** Front-channel redirect callback. */
ssoRouter.get('/sso/bridge/callback', LIMITS.sso, (req, res, next) => {
  const assertion = String(req.query.token ?? '')
  if (!assertion || assertion.length > 8000) return res.redirect(`${config.appOrigin}/login?error=sso`)
  federate(assertion)
    .then((r) => {
      if (r.userId && r.companyId) { setFederatedSession(req, res, r.userId, r.companyId); return res.redirect(`${config.appOrigin}/`) }
      res.redirect(`${config.appOrigin}/login?error=sso_${encodeURIComponent(r.body?.error ?? 'failed')}`)
    })
    .catch(next)
})
