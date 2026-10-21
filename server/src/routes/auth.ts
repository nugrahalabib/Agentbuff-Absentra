import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { db, now } from '../lib/db.js'
import { id, token } from '../lib/ids.js'
import { mapCompany, mapMembership, mapUser } from '../lib/map.js'
import { SESSION_COOKIE, SESSION_MAX_AGE_MS, createSession, destroySession, setSessionCompany, requireAuth } from '../lib/context.js'
import { cookieOpts } from '../lib/httpSecurity.js'
import { LIMITS } from '../lib/rateLimit.js'
import { hashPassword, verifyPassword } from '../lib/password.js'
import { audit } from '../lib/audit.js'
import { config } from '../lib/config.js'
import { checkEntitlementStrict, forgetOwner } from '../lib/agentbuffGate.js'
import { bahanBaru, tukarKode, urlOtorisasi } from '../lib/agentbuffMasuk.js'

export const authRouter = Router()

const RT_COOKIE = 'absentra_rt'
const RT_MAX_AGE_MS = 60 * 864e5

/** Issue a rotating refresh token (PRD §7.1.2). Cookie value = token id. */
function issueRefresh(req: Request, res: Response, userId: string, companyId: string | null, familyId?: string) {
  const rid = id('rt')
  const fam = familyId ?? id('fam')
  db.prepare('INSERT INTO refresh_token (id, family_id, user_id, company_id, used, revoked, created_at, expires_at) VALUES (?,?,?,?,0,0,?,?)')
    .run(rid, fam, userId, companyId, now(), new Date(Date.now() + RT_MAX_AGE_MS).toISOString())
  res.cookie(RT_COOKIE, rid, cookieOpts(req, RT_MAX_AGE_MS))
}

/** Start a session: drop the browser's previous one (no unbounded session rows), set the cookie. */
function startSession(req: Request, res: Response, userId: string, companyId: string | null): string {
  const prev = req.cookies?.[SESSION_COOKIE]
  if (typeof prev === 'string' && prev) destroySession(prev)
  const sid = createSession(userId, companyId)
  res.cookie(SESSION_COOKIE, sid, cookieOpts(req, SESSION_MAX_AGE_MS))
  return sid
}

/**
 * Rotate the refresh token. Reusing an already-used/revoked token is treated as
 * theft → the whole family is revoked (PRD §7.1.2 reuse detection / TC-018).
 */
authRouter.post('/refresh', LIMITS.refresh, (req, res) => {
  const rid = req.cookies?.[RT_COOKIE]
  if (!rid) return res.status(401).json({ error: 'no_refresh' })
  const row = db.prepare('SELECT * FROM refresh_token WHERE id=?').get(rid) as any
  if (!row || row.expires_at < now()) return res.status(401).json({ error: 'invalid_refresh' })
  if (row.used || row.revoked) {
    db.prepare('UPDATE refresh_token SET revoked=1 WHERE family_id=?').run(row.family_id) // reuse → kill family
    res.clearCookie(RT_COOKIE, { path: '/' })
    return res.status(401).json({ error: 'refresh_reuse_detected' })
  }
  db.prepare('UPDATE refresh_token SET used=1 WHERE id=?').run(row.id)
  issueRefresh(req, res, row.user_id, row.company_id, row.family_id)
  // Rotation REPLACES the browser's session row instead of piling up a new one per refresh.
  startSession(req, res, row.user_id, row.company_id)
  res.json({ ok: true })
})

/** Frontend asks this to decide which auth methods to show. */
authRouter.get('/config', (_req, res) => res.json({
  googleEnabled: config.googleEnabled,
  passwordAuthEnabled: config.passwordAuthEnabled,
  agentbuffEnabled: config.agentbuffEnabled,
}))

/**
 * Upsert a global user from a verified Google profile + claim pending invites.
 * Identity key = Google `sub` (PRD §7.1.2). Falling back to the email is only
 * allowed for a VERIFIED email and only onto an account not already bound to a
 * different Google identity — otherwise someone else's Google account with the
 * same (unverified) address could take the account over.
 */
function upsertGoogleUser(profile: { sub: string; email: string; emailVerified: boolean; name?: string; picture?: string }) {
  const email = profile.email.toLowerCase().trim()
  let user = db.prepare('SELECT * FROM user WHERE google_sub = ?').get(profile.sub) as any
  if (!user) {
    if (!profile.emailVerified) throw new Error('email_tidak_terverifikasi')
    user = db.prepare('SELECT * FROM user WHERE email = ?').get(email) as any
    const boundElsewhere = user?.google_sub && !String(user.google_sub).startsWith('local:') && user.google_sub !== profile.sub
    if (boundElsewhere) throw new Error('akun_lain')
  }
  if (!user) {
    const uid = id('usr')
    db.prepare('INSERT INTO user (id, google_sub, email, name, avatar_url, created_at) VALUES (?,?,?,?,?,?)').run(uid, profile.sub, email, profile.name ?? email.split('@')[0], profile.picture ?? null, now())
    user = db.prepare('SELECT * FROM user WHERE id = ?').get(uid)
  } else {
    db.prepare('UPDATE user SET google_sub=?, avatar_url=COALESCE(?, avatar_url) WHERE id=?').run(profile.sub, profile.picture ?? null, user.id)
  }
  db.prepare(`UPDATE membership SET user_id = ?, status = 'active' WHERE user_id = ?`).run(user.id, `pending:${email}`)
  db.prepare('UPDATE employee_profile SET user_id = ? WHERE email = ? AND (user_id IS NULL OR user_id = ?)').run(user.id, email, `pending:${email}`)
  return user
}

const G_STATE = 'absentra_goauth'
const G_NEXT = 'absentra_gnext'

/** Only allow same-origin relative paths (e.g. /invite/xyz). */
function safeNextPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null
  return raw
}

/** True when `next` points at a still-usable invite link (`/invite/<token>`). */
export function nextIsValidInvite(next: string | null): boolean {
  const m = next ? /^\/invite\/([A-Za-z0-9_-]{8,64})(?:[/?#].*)?$/.exec(next) : null
  if (!m) return false
  const inv = db.prepare('SELECT expires_at, used_count, max_uses FROM invite WHERE token = ?').get(m[1]) as any
  return !!inv && inv.expires_at > now() && inv.used_count < inv.max_uses
}

authRouter.get('/google/start', (req, res) => {
  if (!config.googleEnabled) return res.status(503).json({ error: 'google_not_configured' })
  const state = token()
  res.cookie(G_STATE, state, cookieOpts(req, 600_000))
  const next = safeNextPath(req.query.next)
  if (next) res.cookie(G_NEXT, next, cookieOpts(req, 600_000))
  else res.clearCookie(G_NEXT, { path: '/' })
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', config.googleClientId)
  url.searchParams.set('redirect_uri', config.googleRedirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('state', state)
  url.searchParams.set('prompt', 'select_account')
  res.redirect(url.toString())
})

authRouter.get('/google/callback', async (req, res) => {
  try {
    if (!config.googleEnabled) return res.redirect(`${config.appOrigin}/login?error=google`)
    const code = String(req.query.code ?? '')
    const state = String(req.query.state ?? '')
    if (!code || !state || state !== req.cookies?.[G_STATE]) return res.redirect(`${config.appOrigin}/login?error=state`)
    res.clearCookie(G_STATE, { path: '/' })
    const next = safeNextPath(req.cookies?.[G_NEXT])
    res.clearCookie(G_NEXT, { path: '/' })

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: config.googleClientId, client_secret: config.googleClientSecret, redirect_uri: config.googleRedirectUri, grant_type: 'authorization_code' }),
    })
    if (!tokenRes.ok) return res.redirect(`${config.appOrigin}/login?error=token`)
    const tokens = await tokenRes.json() as any
    const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { authorization: `Bearer ${tokens.access_token}` } })
    if (!infoRes.ok) return res.redirect(`${config.appOrigin}/login?error=userinfo`)
    const info = await infoRes.json() as any
    if (!info.email) return res.redirect(`${config.appOrigin}/login?error=noemail`)

    const user = upsertGoogleUser({ sub: info.sub, email: info.email, emailVerified: info.email_verified === true, name: info.name, picture: info.picture })
    const memberships = membershipsForUser(user.id)
    // AGENTBUFF GATE: a would-be OR returning OWNER must be an entitled AgentBuff
    // buyer (active OP Buff/trial + owns this product). Invited STAFF (they carry a
    // non-owner membership after the pending-claim above) pass here; the per-request
    // company-freeze gate covers their access instead. A lapsed owner is refused at
    // the door — no session is granted, but their data is untouched.
    const isOwner = memberships.some((m) => m.membership.role === 'owner')
    const isNewUser = memberships.length === 0
    // A brand-new user arriving from a valid invite link is STAFF-to-be: let them
    // in so they can accept it. They still cannot create a company — POST
    // /companies enforces the owner gate (perlu_agentbuff) on its own.
    const joiningViaInvite = isNewUser && nextIsValidInvite(next)
    if ((isNewUser || isOwner) && !joiningViaInvite) {
      // Since "Masuk dengan AgentBuff": owners and would-be owners sign in through
      // AgentBuff (which enforces subscription + product ownership). Google stays
      // for invited STAFF only. The account/data is untouched — the owner simply
      // uses the AgentBuff button next time (matched by the same email).
      if (config.agentbuffEnabled) {
        return res.redirect(`${config.appOrigin}/login?error=pakai_agentbuff`)
      }
      const ent = await checkEntitlementStrict(user.email)
      if (!ent.entitled) {
        return res.redirect(`${config.appOrigin}/login?error=${encodeURIComponent(ent.reason)}`)
      }
    }
    startSession(req, res, user.id, memberships[0]?.company.id ?? null)
    issueRefresh(req, res, user.id, memberships[0]?.company.id ?? null)
    res.redirect(`${config.appOrigin}${next ?? '/'}`)
  } catch (e) {
    const kode = e instanceof Error && (e.message === 'akun_lain' || e.message === 'email_tidak_terverifikasi') ? e.message : 'oauth'
    res.redirect(`${config.appOrigin}/login?error=${kode}`)
  }
})

/* ------------------------------------------------------------------ Masuk dengan AgentBuff */

const AB_COOKIE = 'absentra_abmasuk'

/** Upsert the OWNER from a verified AgentBuff identity + claim pending invites. */
function upsertAgentBuffUser(p: { sub: string; email: string; name: string | null; picture: string | null }) {
  let user = db.prepare('SELECT * FROM user WHERE agentbuff_sub = ?').get(p.sub) as any
  if (!user) user = db.prepare('SELECT * FROM user WHERE email = ?').get(p.email) as any
  if (!user) {
    const uid = id('usr')
    db.prepare('INSERT INTO user (id, google_sub, email, name, avatar_url, created_at, agentbuff_sub) VALUES (?,?,?,?,?,?,?)')
      .run(uid, null, p.email, p.name ?? p.email.split('@')[0], p.picture, now(), p.sub)
    user = db.prepare('SELECT * FROM user WHERE id = ?').get(uid)
  } else {
    // The same email already linked to a DIFFERENT AgentBuff identity = refuse
    // rather than merge two people.
    if (user.agentbuff_sub && user.agentbuff_sub !== p.sub) throw new Error('akun_lain')
    db.prepare('UPDATE user SET agentbuff_sub = ?, avatar_url = COALESCE(avatar_url, ?) WHERE id = ?').run(p.sub, p.picture, user.id)
  }
  db.prepare(`UPDATE membership SET user_id = ?, status = 'active' WHERE user_id = ?`).run(user.id, `pending:${p.email}`)
  db.prepare('UPDATE employee_profile SET user_id = ? WHERE email = ? AND (user_id IS NULL OR user_id = ?)').run(user.id, p.email, `pending:${p.email}`)
  return user
}

authRouter.get('/agentbuff/start', (req, res) => {
  if (!config.agentbuffEnabled) return res.status(503).json({ error: 'agentbuff_not_configured' })
  const b = bahanBaru()
  const next = safeNextPath(req.query.next)
  res.cookie(AB_COOKIE, JSON.stringify({ s: b.state, n: b.nonce, v: b.verifier, nx: next }), cookieOpts(req, 600_000, '/api/auth'))
  res.redirect(urlOtorisasi(b, config.agentbuffRedirectUri, req.query.ganti === '1'))
})

authRouter.get('/agentbuff/callback', async (req, res) => {
  const gagal = (kode: string) => res.redirect(`${config.appOrigin}/login?error=${encodeURIComponent(kode)}`)
  try {
    if (!config.agentbuffEnabled) return gagal('agentbuff')
    const raw = req.cookies?.[AB_COOKIE]
    res.clearCookie(AB_COOKIE, { path: '/api/auth' })
    // AgentBuff sent the owner back without a code (not entitled / cancelled):
    // error_description carries the reason (belum_beli, akses_berakhir, ...).
    if (typeof req.query.error === 'string') return gagal(String(req.query.error_description ?? req.query.error))
    let b: { s?: string; n?: string; v?: string; nx?: string | null } | null = null
    try { b = raw ? JSON.parse(String(raw)) : null } catch { b = null }
    const code = String(req.query.code ?? '')
    const state = String(req.query.state ?? '')
    if (!b?.s || !b.n || !b.v || !code || state !== b.s) return gagal('state')

    const akun = await tukarKode(code, b.v, b.n, config.agentbuffRedirectUri)
    const user = upsertAgentBuffUser(akun)
    forgetOwner(user.id) // a just-renewed owner must not wait for the freeze cache
    const memberships = membershipsForUser(user.id)
    const companyId = memberships[0]?.company.id ?? null
    startSession(req, res, user.id, companyId)
    issueRefresh(req, res, user.id, companyId)
    res.redirect(`${config.appOrigin}${safeNextPath(b.nx) ?? '/'}`)
  } catch (e) {
    return gagal(e instanceof Error && e.message === 'akun_lain' ? 'akun_lain' : 'oauth')
  }
})

function membershipsForUser(userId: string) {
  const rows = db.prepare(`SELECT * FROM membership WHERE user_id = ? AND status != 'disabled'`).all(userId) as any[]
  return rows.map((m) => {
    const c = db.prepare('SELECT * FROM company WHERE id = ?').get(m.company_id) as any
    return { membership: mapMembership(m), company: mapCompany(c) }
  })
}

/**
 * Email+password auth — only for emails on PASSWORD_AUTH_ALLOWLIST (admin/dev).
 * Everyone else must use Google / AgentBuff (PRD §7.1 / NG3). A valid password
 * is ALWAYS required: an existing account without a password (Google/AgentBuff
 * user) can never be entered — nor have a "first password" planted — here.
 */
authRouter.post('/signin', LIMITS.signin, (req, res) => {
  const body = z.object({
    email: z.string().email().max(254),
    name: z.string().trim().min(1).max(120).optional(),
    password: z.string().max(200).optional(),
    register: z.boolean().default(true),
  }).parse(req.body)
  const email = body.email.toLowerCase().trim()
  if (!config.isPasswordAllowed(email)) {
    return res.status(403).json({ error: 'password_auth_forbidden', message: 'Gunakan Masuk dengan Google.' })
  }
  const password = body.password ?? ''
  let user = db.prepare('SELECT * FROM user WHERE email = ?').get(email) as any
  if (!user) {
    // "Masuk" (login) must NOT auto-create — tell the caller to register first.
    if (!body.register) return res.status(404).json({ error: 'not_registered' })
    if (password.length < 6) return res.status(400).json({ error: 'password_required', message: 'Kata sandi minimal 6 karakter.' })
    const uid = id('usr')
    db.prepare('INSERT INTO user (id, google_sub, email, name, password_hash, created_at) VALUES (?,?,?,?,?,?)').run(
      uid, `local:${email}`, email, body.name ?? email.split('@')[0], hashPassword(password), now(),
    )
    user = db.prepare('SELECT * FROM user WHERE id = ?').get(uid)
  } else {
    if (!user.password_hash || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'invalid_credentials', message: 'Email atau kata sandi salah.' })
    }
    if (body.register && body.name && user.name !== body.name) {
      db.prepare('UPDATE user SET name=? WHERE id=?').run(body.name, user.id)
    }
    user = db.prepare('SELECT * FROM user WHERE id = ?').get(user.id)
  }
  // Claim any pending membership/profile an admin pre-created by email (PRD §6.3 jalur B).
  db.prepare(`UPDATE membership SET user_id = ?, status = 'active' WHERE user_id = ?`).run(user.id, `pending:${email}`)
  db.prepare('UPDATE employee_profile SET user_id = ? WHERE email = ? AND (user_id IS NULL OR user_id = ?)').run(user.id, email, `pending:${email}`)

  const memberships = membershipsForUser(user.id)
  const activeCompanyId = memberships[0]?.company.id ?? null
  startSession(req, res, user.id, activeCompanyId)
  issueRefresh(req, res, user.id, activeCompanyId)
  res.json({ user: mapUser(user), memberships, activeCompanyId })
})

authRouter.get('/me', (req, res) => {
  if (!req.ctx) return res.status(401).json({ error: 'unauthenticated' })
  const user = db.prepare('SELECT * FROM user WHERE id = ?').get(req.ctx.userId) as any
  if (!user) return res.status(401).json({ error: 'unauthenticated' })
  // UU PDP consent of the signed-in employee in the ACTIVE company (false when
  // there is no employee profile). The UI shows the consent screen before the
  // first clock-in when consentLocation is false (POST /api/me/consent).
  const emp = req.ctx.employeeId && req.ctx.companyId
    ? db.prepare('SELECT consent_location_at, consent_photo_at FROM employee_profile WHERE id = ? AND company_id = ?').get(req.ctx.employeeId, req.ctx.companyId) as any
    : null
  res.json({
    user: mapUser(user),
    memberships: membershipsForUser(user.id),
    activeCompanyId: req.ctx.companyId,
    employeeId: req.ctx.employeeId ?? null,
    hasPassword: !!user.password_hash,
    passwordAuthAllowed: config.isPasswordAllowed(user.email),
    consentLocation: !!emp?.consent_location_at,
    consentPhoto: !!emp?.consent_photo_at,
  })
})

/** Self-service change/set password — only for allowlisted emails. */
authRouter.post('/change-password', requireAuth, (req, res) => {
  const body = z.object({ currentPassword: z.string().optional(), newPassword: z.string().min(6) }).parse(req.body)
  const user = db.prepare('SELECT * FROM user WHERE id=?').get(req.ctx!.userId) as any
  if (!user) return res.status(401).json({ error: 'unauthenticated' })
  if (!config.isPasswordAllowed(user.email)) {
    return res.status(403).json({ error: 'password_auth_forbidden' })
  }
  // If the account already has a password, the current one must match.
  if (user.password_hash && !verifyPassword(body.currentPassword ?? '', user.password_hash)) {
    return res.status(401).json({ error: 'invalid_current' })
  }
  db.prepare('UPDATE user SET password_hash=? WHERE id=?').run(hashPassword(body.newPassword), user.id)
  if (req.ctx!.companyId) audit({ companyId: req.ctx!.companyId, actorType: 'user', actorId: user.id, action: 'user.change_password', target: user.id })
  res.json({ ok: true, hadPassword: !!user.password_hash })
})

authRouter.post('/signout', (req, res) => {
  if (req.ctx) destroySession(req.ctx.sessionId)
  const rid = req.cookies?.[RT_COOKIE]
  if (rid) { const row = db.prepare('SELECT family_id FROM refresh_token WHERE id=?').get(rid) as any; if (row) db.prepare('UPDATE refresh_token SET revoked=1 WHERE family_id=?').run(row.family_id) }
  res.clearCookie(SESSION_COOKIE, { path: '/' })
  res.clearCookie(RT_COOKIE, { path: '/' })
  res.json({ ok: true })
})

authRouter.post('/switch-tenant', requireAuth, (req, res) => {
  const body = z.object({ companyId: z.string() }).parse(req.body)
  const member = db.prepare(`SELECT * FROM membership WHERE company_id = ? AND user_id = ? AND status = 'active'`).get(body.companyId, req.ctx!.userId)
  if (!member) return res.status(403).json({ error: 'not_a_member' })
  setSessionCompany(req.ctx!.sessionId, body.companyId)
  res.json({ activeCompanyId: body.companyId })
})
