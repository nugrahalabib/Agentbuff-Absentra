import { Router } from 'express'
import { z } from 'zod'
import { db, now } from '../lib/db.js'
import { id, token } from '../lib/ids.js'
import { mapCompany, mapMembership, mapUser } from '../lib/map.js'
import { SESSION_COOKIE, createSession, destroySession, setSessionCompany, requireAuth } from '../lib/context.js'
import { hashPassword, verifyPassword } from '../lib/password.js'
import { audit } from '../lib/audit.js'
import { config } from '../lib/config.js'

export const authRouter = Router()

const RT_COOKIE = 'absentra_rt'
const rtCookieOpts = { httpOnly: true, sameSite: 'lax' as const, secure: false, maxAge: 60 * 864e5, path: '/' }

/** Issue a rotating refresh token (PRD §7.1.2). Cookie value = token id. */
function issueRefresh(res: any, userId: string, companyId: string | null, familyId?: string) {
  const rid = id('rt')
  const fam = familyId ?? id('fam')
  db.prepare('INSERT INTO refresh_token (id, family_id, user_id, company_id, used, revoked, created_at, expires_at) VALUES (?,?,?,?,0,0,?,?)')
    .run(rid, fam, userId, companyId, now(), new Date(Date.now() + 60 * 864e5).toISOString())
  res.cookie(RT_COOKIE, rid, rtCookieOpts)
}

/**
 * Rotate the refresh token. Reusing an already-used/revoked token is treated as
 * theft → the whole family is revoked (PRD §7.1.2 reuse detection / TC-018).
 */
authRouter.post('/refresh', (req, res) => {
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
  issueRefresh(res, row.user_id, row.company_id, row.family_id)
  const sid = createSession(row.user_id, row.company_id)
  res.cookie(SESSION_COOKIE, sid, cookieOpts)
  res.json({ ok: true })
})

/** Frontend asks this to decide which auth methods to show. */
authRouter.get('/config', (_req, res) => res.json({
  googleEnabled: config.googleEnabled,
  passwordAuthEnabled: config.passwordAuthEnabled,
}))

/** Upsert a global user from a verified Google profile + claim pending invites. */
function upsertGoogleUser(profile: { sub: string; email: string; name?: string; picture?: string }) {
  const email = profile.email.toLowerCase().trim()
  let user = db.prepare('SELECT * FROM user WHERE email = ? OR google_sub = ?').get(email, profile.sub) as any
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
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) return null
  return raw
}

authRouter.get('/google/start', (req, res) => {
  if (!config.googleEnabled) return res.status(503).json({ error: 'google_not_configured' })
  const state = token()
  res.cookie(G_STATE, state, { httpOnly: true, sameSite: 'lax', maxAge: 600_000, path: '/' })
  const next = safeNextPath(req.query.next)
  if (next) res.cookie(G_NEXT, next, { httpOnly: true, sameSite: 'lax', maxAge: 600_000, path: '/' })
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

    const user = upsertGoogleUser({ sub: info.sub, email: info.email, name: info.name, picture: info.picture })
    const memberships = membershipsForUser(user.id)
    const sid = createSession(user.id, memberships[0]?.company.id ?? null)
    res.cookie(SESSION_COOKIE, sid, cookieOpts)
    issueRefresh(res, user.id, memberships[0]?.company.id ?? null)
    res.redirect(`${config.appOrigin}${next ?? '/'}`)
  } catch {
    res.redirect(`${config.appOrigin}/login?error=oauth`)
  }
})

const cookieOpts = { httpOnly: true, sameSite: 'lax' as const, secure: false, maxAge: 30 * 864e5, path: '/' }

function membershipsForUser(userId: string) {
  const rows = db.prepare(`SELECT * FROM membership WHERE user_id = ? AND status != 'disabled'`).all(userId) as any[]
  return rows.map((m) => {
    const c = db.prepare('SELECT * FROM company WHERE id = ?').get(m.company_id) as any
    return { membership: mapMembership(m), company: mapCompany(c) }
  })
}

/**
 * Email+password auth — only for emails on PASSWORD_AUTH_ALLOWLIST (admin/dev).
 * Everyone else must use Google OAuth (PRD §7.1 / NG3).
 */
authRouter.post('/signin', (req, res) => {
  const body = z.object({ email: z.string().email(), name: z.string().min(1).optional(), password: z.string().optional(), register: z.boolean().default(true) }).parse(req.body)
  const email = body.email.toLowerCase().trim()
  if (!config.isPasswordAllowed(email)) {
    return res.status(403).json({ error: 'password_auth_forbidden', message: 'Gunakan Masuk dengan Google.' })
  }
  let user = db.prepare('SELECT * FROM user WHERE email = ?').get(email) as any
  if (!user) {
    // "Masuk" (login) must NOT auto-create — tell the caller to register first.
    if (!body.register) return res.status(404).json({ error: 'not_registered' })
    const uid = id('usr')
    db.prepare('INSERT INTO user (id, google_sub, email, name, password_hash, created_at) VALUES (?,?,?,?,?,?)').run(
      uid, `local:${email}`, email, body.name ?? email.split('@')[0], body.password ? hashPassword(body.password) : null, now(),
    )
    user = db.prepare('SELECT * FROM user WHERE id = ?').get(uid)
  } else {
    // Existing account. If it has a password, verify it.
    if (user.password_hash && !verifyPassword(body.password ?? '', user.password_hash)) {
      return res.status(401).json({ error: 'invalid_credentials' })
    }
    if (!user.password_hash && body.password) {
      db.prepare('UPDATE user SET password_hash=? WHERE id=?').run(hashPassword(body.password), user.id)
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
  const sid = createSession(user.id, activeCompanyId)
  res.cookie(SESSION_COOKIE, sid, cookieOpts)
  issueRefresh(res, user.id, activeCompanyId)
  res.json({ user: mapUser(user), memberships, activeCompanyId })
})

authRouter.get('/me', (req, res) => {
  if (!req.ctx) return res.status(401).json({ error: 'unauthenticated' })
  const user = db.prepare('SELECT * FROM user WHERE id = ?').get(req.ctx.userId) as any
  if (!user) return res.status(401).json({ error: 'unauthenticated' })
  res.json({
    user: mapUser(user),
    memberships: membershipsForUser(user.id),
    activeCompanyId: req.ctx.companyId,
    employeeId: req.ctx.employeeId ?? null,
    hasPassword: !!user.password_hash,
    passwordAuthAllowed: config.isPasswordAllowed(user.email),
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
  const member = db.prepare(`SELECT * FROM membership WHERE company_id = ? AND user_id = ? AND status != 'disabled'`).get(body.companyId, req.ctx!.userId)
  if (!member) return res.status(403).json({ error: 'not_a_member' })
  setSessionCompany(req.ctx!.sessionId, body.companyId)
  res.json({ activeCompanyId: body.companyId })
})
