/**
 * Security regression tests for the pre-launch hardening (each exploit attempt
 * must FAIL). Numbers refer to the fix list: SSO takeover (1), branch-admin
 * escalation (2), self-scoping reads (3/4), CSRF + cookies (5), passwordless
 * login (6), MCP hardening (7), consent + retention (8), inactive membership
 * (9), rate limits (10), image limits (11), date caps (12), timezone/policy
 * (13), error leaks (14), fail-closed gate (15), audit IP (16), sessions (17).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import request from 'supertest'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import type { Express } from 'express'

let app: Express
let db: any
const agent = () => request.agent(app)
const PW = (email: string) => `Rahasia-${email}`
const signin = (a: any, email: string, name = email.split('@')[0]) => a.post('/api/auth/signin').send({ email, name, register: true, password: PW(email) })
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())
const addDays = (iso: string, d: number) => { const [y, m, dd] = iso.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1, dd)); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10) }
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='
const clockBody = (kind: 'in' | 'out', key: string, extra: Record<string, unknown> = {}) => ({ kind, lat: -6.2, long: 106.8166, gpsAccuracyM: 15, livenessPassed: null, cameraAvailable: true, idempotencyKey: key, ...extra })
const rpc = (tok: string, method: string, params?: any) => request(app).post('/mcp').set('Authorization', `Bearer ${tok}`).send({ jsonrpc: '2.0', id: 1, method, params })
const tool = (tok: string, name: string, args: any) => rpc(tok, 'tools/call', { name, arguments: args })

let owner: any, ownerB: any, rina: any, andi: any, bambang: any
let cidA: string, cidB: string, branchA1: string, branchA2: string, branchB1: string
let empAndi: string, empBambang: string, empRina: string, ownerUserId: string

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'absentra-sec-'))
  process.env.ABSENTRA_DB = join(dir, 'test.db')
  process.env.PASSWORD_AUTH_ALLOWLIST = '*'
  process.env.ABSENTRA_RATE_LIMIT_DISABLED = '1'
  delete process.env.SSO_BRIDGE_OPERATOR_SECRET
  delete process.env.ABSENTRA_ENFORCE_ORIGIN
  delete process.env.APP_ORIGIN
  app = (await import('../src/app.js')).createApp()
  db = (await import('../src/lib/db.js')).db

  owner = agent(); ownerUserId = (await signin(owner, 'owner@s.test', 'Bu Owner')).body.user.id
  cidA = (await owner.post('/api/companies').send({ displayName: 'Toko Aman', businessType: 'Retail', timezone: 'Asia/Jakarta', workweekType: 'six_day' })).body.activeCompanyId
  branchA1 = (await owner.post('/api/branches').send({ name: 'Pusat', lat: -6.2, long: 106.8166, radiusM: 200 })).body.id
  branchA2 = (await owner.post('/api/branches').send({ name: 'Timur', lat: -6.21, long: 106.9, radiusM: 200 })).body.id
  empAndi = (await owner.post('/api/employees').send({ name: 'Andi', email: 'andi@s.test', branchId: branchA1, wageBasic: 4_000_000 })).body.id
  empBambang = (await owner.post('/api/employees').send({ name: 'Bambang', email: 'bambang@s.test', branchId: branchA2 })).body.id
  empRina = (await owner.post('/api/employees').send({ name: 'Rina', email: 'rina@s.test', branchId: branchA1, role: 'branch_admin', scopeBranchIds: [branchA1] })).body.id
  andi = agent(); await signin(andi, 'andi@s.test', 'Andi')
  bambang = agent(); await signin(bambang, 'bambang@s.test', 'Bambang')
  rina = agent(); await signin(rina, 'rina@s.test', 'Rina')
  for (const a of [andi, bambang]) await a.post('/api/me/consent').send({ consentLocation: true, consentPhoto: true })

  ownerB = agent(); await signin(ownerB, 'owner@sb.test', 'Owner B')
  cidB = (await ownerB.post('/api/companies').send({ displayName: 'Toko Timur Jauh', businessType: 'Retail', timezone: 'Asia/Jayapura', workweekType: 'five_day' })).body.activeCompanyId
  branchB1 = (await ownerB.post('/api/branches').send({ name: 'B Pusat', lat: -2.5, long: 140.7, radiusM: 100 })).body.id

}, 120_000) // many scrypt sign-ins; generous under a loaded CI box

afterAll(() => {
  delete process.env.ABSENTRA_ENFORCE_ORIGIN
  delete process.env.SSO_BRIDGE_OPERATOR_SECRET
})

// ---------------------------------------------------------------- 1 SSO
describe('#1 SSO Identity Bridge', () => {
  let priv: CryptoKey, jwk: any
  const assertion = (claims: Record<string, unknown>, expSec = 60) =>
    new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k' }).setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) + expSec).setJti(`j-${Math.random()}`).sign(priv)
  beforeAll(async () => {
    const kp = await generateKeyPair('RS256'); priv = kp.privateKey
    jwk = { ...(await exportJWK(kp.publicKey)), kid: 'k', alg: 'RS256', use: 'sig' }
  })

  it('is invisible (404) when the operator secret is not configured', async () => {
    expect((await request(app).post('/api/sso/bridge/token').send({ assertion: 'x'.repeat(20) })).status).toBe(404)
    expect((await owner.post('/api/sso/bridges').send({ issuer: 'https://p.test', jwks: { keys: [jwk] } })).status).toBe(404)
  })
  it('an owner alone cannot register a bridge — needs x-operator-secret', async () => {
    process.env.SSO_BRIDGE_OPERATOR_SECRET = 'op-secret'
    expect((await owner.post('/api/sso/bridges').send({ issuer: 'https://p.test', jwks: { keys: [jwk] } })).status).toBe(403)
    expect((await owner.post('/api/sso/bridges').set('x-operator-secret', 'wrong').send({ issuer: 'https://p.test', jwks: { keys: [jwk] } })).status).toBe(403)
    expect((await owner.post('/api/sso/bridges').set('x-operator-secret', 'op-secret').send({ issuer: 'https://p.test', jwks: { keys: [jwk] } })).status).toBe(200)
  })
  it('assertion carrying the OWNER\'s email never yields the owner\'s session (identity = issuer+sub)', async () => {
    const a = agent()
    const r = await a.post('/api/sso/bridge/token').send({ assertion: await assertion({ iss: 'https://p.test', aud: 'absentra', sub: 'attacker-1', email: 'owner@s.test' }) })
    expect(r.status).toBe(200)
    const me = (await a.get('/api/auth/me')).body
    expect(me.user.id).not.toBe(ownerUserId)
    expect(me.user.email).not.toBe('owner@s.test')
    expect(me.memberships).toHaveLength(1)
    expect(me.memberships[0].membership.role).toBe('employee')
    expect(me.memberships[0].company.id).toBe(cidA)
    // Same (issuer, sub) again → same federated user, not a new one.
    const a2 = agent()
    await a2.post('/api/sso/bridge/token').send({ assertion: await assertion({ iss: 'https://p.test', aud: 'absentra', sub: 'attacker-1' }) })
    expect((await a2.get('/api/auth/me')).body.user.id).toBe(me.user.id)
  })
  it('another tenant cannot take over an issuer (no INSERT OR REPLACE)', async () => {
    const r = await ownerB.post('/api/sso/bridges').set('x-operator-secret', 'op-secret').send({ issuer: 'https://p.test', jwks: { keys: [jwk] } })
    expect(r.status).toBe(409)
    expect((db.prepare('SELECT company_id FROM identity_bridge WHERE issuer=?').get('https://p.test') as any).company_id).toBe(cidA)
  })
  it('rejects assertions whose exp is far in the future', async () => {
    const r = await request(app).post('/api/sso/bridge/token').send({ assertion: await assertion({ iss: 'https://p.test', aud: 'absentra', sub: 'x' }, 3600) })
    expect(r.status).toBe(401)
  })
  it('tenant deletion removes its bridges and federated identities', async () => {
    const t = agent(); await signin(t, 'tmpsso@s.test')
    const cid = (await t.post('/api/companies').send({ displayName: 'Sementara', businessType: 'X', timezone: 'Asia/Jakarta', workweekType: 'six_day' })).body.activeCompanyId
    await t.post('/api/sso/bridges').set('x-operator-secret', 'op-secret').send({ issuer: 'https://tmp.test', jwks: { keys: [jwk] } })
    expect(db.prepare('SELECT COUNT(*) n FROM identity_bridge WHERE company_id=?').get(cid).n).toBe(1)
    expect((await t.delete('/api/company').send({ confirmName: 'Sementara' })).status).toBe(200)
    expect(db.prepare('SELECT COUNT(*) n FROM identity_bridge WHERE company_id=?').get(cid).n).toBe(0)
    delete process.env.SSO_BRIDGE_OPERATOR_SECRET
  })
})

// ---------------------------------------------------------------- 2 branch admin escalation
describe('#2 Branch admin cannot escalate', () => {
  it('cannot grant owner (rejected by schema) or any manager role', async () => {
    expect((await rina.patch(`/api/employees/${empAndi}`).send({ role: 'owner' })).status).toBe(400)
    const r = await rina.patch(`/api/employees/${empAndi}`).send({ role: 'hr' })
    expect(r.status).toBe(403); expect(r.body.error).toBe('role_requires_owner')
    expect((db.prepare('SELECT m.role FROM membership m JOIN employee_profile e ON e.membership_id=m.id WHERE e.id=?').get(empAndi) as any).role).toBe('employee')
  })
  it('cannot touch employees outside its branches (patch, delete, reset)', async () => {
    expect((await rina.patch(`/api/employees/${empBambang}`).send({ name: 'Hacked' })).status).toBe(403)
    expect((await rina.patch(`/api/employees/${empBambang}`).send({ employmentStatus: 'inactive' })).status).toBe(403)
    expect((await rina.delete(`/api/employees/${empBambang}`)).status).toBe(403)
    expect((await rina.post(`/api/employees/${empBambang}/reset-password`).send({})).status).toBe(403)
  })
  it('cannot move an employee into a branch it does not manage', async () => {
    expect((await rina.patch(`/api/employees/${empAndi}`).send({ branchId: branchA2 })).status).toBe(403)
  })
  it('cannot create employees/invites outside scope or with manager roles', async () => {
    expect((await rina.post('/api/employees').send({ name: 'X', email: 'x1@s.test', branchId: branchA2 })).status).toBe(403)
    expect((await rina.post('/api/employees').send({ name: 'X', email: 'x2@s.test', branchId: branchA1, role: 'branch_admin' })).status).toBe(403)
    expect((await rina.post('/api/employees/import').send({ branchId: branchA2, rows: [{ name: 'Y', email: 'y@s.test' }] })).status).toBe(403)
    expect((await rina.post('/api/invites').send({ branchId: branchA1, role: 'hr' })).status).toBe(403)
    expect((await rina.post('/api/invites').send({ branchId: branchA2 })).status).toBe(403)
    // a foreign tenant's branch id is not a valid branch
    expect((await owner.post('/api/employees').send({ name: 'Z', email: 'z@s.test', branchId: branchB1 })).status).toBe(400)
  })
  it('employees a branch admin creates get a scope inside its own branches', async () => {
    const r = await rina.post('/api/employees').send({ name: 'Baru', email: 'baru@s.test', branchId: branchA1 })
    expect(r.status).toBe(200)
    const m = db.prepare('SELECT role, scope_branch_ids FROM membership WHERE id=?').get(r.body.membershipId) as any
    expect(m.role).toBe('employee'); expect(JSON.parse(m.scope_branch_ids)).toEqual([branchA1])
  })
  it('cannot manage peers/managers, nor itself', async () => {
    const r = await rina.patch(`/api/employees/${empRina}`).send({ employmentStatus: 'inactive' })
    expect(r.status).toBe(403); expect(r.body.error).toBe('forbidden_target_role')
  })
  it('owner-created manager defaults to ONE branch scope, not "all branches"', async () => {
    const r = await owner.post('/api/employees').send({ name: 'Hana HR', email: 'hana@s.test', branchId: branchA2, role: 'hr' })
    expect(JSON.parse((db.prepare('SELECT scope_branch_ids FROM membership WHERE id=?').get(r.body.membershipId) as any).scope_branch_ids)).toEqual([branchA2])
    // promoting an employee without an explicit scope → their branch only
    await owner.patch(`/api/employees/${empBambang}`).send({ role: 'branch_admin' })
    expect(JSON.parse((db.prepare('SELECT m.scope_branch_ids s FROM membership m JOIN employee_profile e ON e.membership_id=m.id WHERE e.id=?').get(empBambang) as any).s)).toEqual([branchA2])
    await owner.patch(`/api/employees/${empBambang}`).send({ role: 'employee' })
  })
  it('invite for a manager role carries the invite branch as scope', async () => {
    const inv = (await owner.post('/api/invites').send({ branchId: branchA2, role: 'branch_admin' })).body
    const e = agent(); await signin(e, 'invadmin@s.test')
    expect((await e.post(`/api/invites/token/${inv.token}/accept`).send({ consentLocation: true })).status).toBe(200)
    const uid = (await e.get('/api/auth/me')).body.user.id
    expect(JSON.parse((db.prepare('SELECT scope_branch_ids s FROM membership WHERE company_id=? AND user_id=?').get(cidA, uid) as any).s)).toEqual([branchA2])
  })
  it('owner account is protected: others cannot modify it; the last owner cannot demote themself', async () => {
    const mem = db.prepare(`SELECT id FROM membership WHERE company_id=? AND user_id=?`).get(cidA, ownerUserId) as any
    db.prepare(`INSERT INTO employee_profile (id, company_id, membership_id, user_id, name, email, branch_id, employment_status, created_at) VALUES ('emp_owner_s', ?, ?, ?, 'Bu Owner', 'owner@s.test', ?, 'active', ?)`)
      .run(cidA, mem.id, ownerUserId, branchA1, new Date().toISOString())
    expect((await rina.patch('/api/employees/emp_owner_s').send({ employmentStatus: 'inactive' })).body.error).toBe('cannot_modify_owner')
    expect((await rina.post('/api/employees/emp_owner_s/reset-password').send({})).status).toBe(403)
    const self = await owner.patch('/api/employees/emp_owner_s').send({ employmentStatus: 'inactive' })
    expect(self.status).toBe(409); expect(self.body.error).toBe('last_owner')
    expect((db.prepare('SELECT status FROM membership WHERE id=?').get(mem.id) as any).status).toBe('active')
  })
})

// ---------------------------------------------------------------- 3/4 self-scoping
describe('#3/#4 Employees only see and file their own data', () => {
  let recBambang: string, recAndi: string
  beforeAll(async () => {
    recAndi = (await andi.post('/api/attendance/clock').send(clockBody('in', 'sec-andi-in', { photoData: JPEG }))).body.record.id
    recBambang = (await bambang.post('/api/attendance/clock').send(clockBody('in', 'sec-bam-in', { photoData: JPEG, lat: -6.21, long: 106.9 }))).body.record.id
  })
  it('cannot open another employee\'s attendance detail (photo + GPS)', async () => {
    expect((await andi.get(`/api/attendance/${recBambang}`)).status).toBe(403)
    const own = await andi.get(`/api/attendance/${recAndi}`)
    expect(own.status).toBe(200); expect(own.body.events[0].photoData).toBe(JPEG)
  })
  it('branch admin cannot open a record of another branch', async () => {
    expect((await rina.get(`/api/attendance/${recBambang}`)).status).toBe(403)
    expect((await rina.get(`/api/attendance/${recAndi}`)).status).toBe(200)
  })
  it('company-wide views are managers only', async () => {
    for (const path of ['/api/attendance/feed', `/api/attendance/list?from=${TODAY}&to=${TODAY}`, '/api/attendance/anomalies', '/api/dashboard/summary', '/api/dashboard/trends']) {
      expect((await andi.get(path)).status, path).toBe(403)
    }
    expect((await owner.get('/api/attendance/feed')).status).toBe(200)
  })
  it('leaves/overtimes lists are forced to "mine" for employees and branch-scoped for admins', async () => {
    await bambang.post('/api/leaves').send({ type: 'izin', dateStart: addDays(TODAY, 30), dateEnd: addDays(TODAY, 30) })
    await bambang.post('/api/overtimes').send({ workDate: addDays(TODAY, -1), hours: 1, dayType: 'workday' })
    await andi.post('/api/leaves').send({ type: 'izin', dateStart: addDays(TODAY, 31), dateEnd: addDays(TODAY, 31) })
    const lv = (await andi.get('/api/leaves')).body
    expect(lv.length).toBeGreaterThan(0); expect(lv.every((l: any) => l.employeeId === empAndi)).toBe(true)
    expect((await andi.get('/api/overtimes')).body.every((o: any) => o.employeeId === empAndi)).toBe(true)
    expect((await rina.get('/api/leaves')).body.some((l: any) => l.employeeId === empBambang)).toBe(false)
    expect((await owner.get('/api/leaves')).body.some((l: any) => l.employeeId === empBambang)).toBe(true)
  })
  it('shift schedule: an employee asking for someone else gets only their own', async () => {
    await owner.post('/api/shift-templates').send({ name: 'Pagi', startTime: '08:00', endTime: '17:00' })
    const tpl = (await owner.get('/api/shift-templates')).body.find((t: any) => t.name === 'Pagi').id
    await owner.post('/api/shift-assignments').send({ employeeIds: [empBambang], shiftTemplateId: tpl, dateStart: addDays(TODAY, 5) })
    const r = (await andi.get('/api/shift-assignments').query({ employeeId: empBambang, from: TODAY, to: addDays(TODAY, 10) })).body
    expect(r.every((x: any) => x.assignment.employeeId === empAndi)).toBe(true)
  })
  it('audit log for a branch admin only shows its own branches', async () => {
    const mine = (await rina.get('/api/audit')).body
    expect(mine.some((r: any) => r.target === recBambang)).toBe(false)
    expect((await owner.get('/api/audit')).body.some((r: any) => r.target === recBambang)).toBe(true)
  })
  it('#4 employeeId in the body is ignored for non-approvers and scope-checked for approvers', async () => {
    const r = await andi.post('/api/leaves').send({ type: 'izin', dateStart: addDays(TODAY, 40), dateEnd: addDays(TODAY, 40), employeeId: empBambang })
    expect(r.status).toBe(200); expect(r.body.employeeId).toBe(empAndi)
    expect((await rina.post('/api/overtimes').send({ workDate: TODAY, hours: 1, dayType: 'workday', employeeId: empBambang })).status).toBe(403)
    expect((await rina.post('/api/overtimes').send({ workDate: TODAY, hours: 1, dayType: 'workday', employeeId: empAndi })).body.employeeId).toBe(empAndi)
  })
  it('approvers cannot decide their own request', async () => {
    const own = (await rina.post('/api/overtimes').send({ workDate: addDays(TODAY, -2), hours: 1, dayType: 'workday' })).body
    expect((await rina.post(`/api/overtimes/${own.id}/decision`).send({ status: 'approved' })).body.error).toBe('cannot_decide_own_request')
  })
})

// ---------------------------------------------------------------- 5 CSRF / cookies
describe('#5 CSRF origin guard + Secure cookies', () => {
  it('rejects cross-site state-changing requests when enforced', async () => {
    process.env.ABSENTRA_ENFORCE_ORIGIN = '1'
    process.env.APP_ORIGIN = 'https://absentra.test'
    try {
      expect((await owner.post('/api/divisions').set('Origin', 'https://evil.test').send({ name: 'CSRF' })).status).toBe(403)
      expect((await owner.post('/api/divisions').set('Sec-Fetch-Site', 'cross-site').send({ name: 'CSRF' })).status).toBe(403)
      expect((await owner.post('/api/divisions').set('Origin', 'https://absentra.test').send({ name: 'Legit' })).status).toBe(200)
      expect((await owner.post('/api/divisions').set('Sec-Fetch-Site', 'same-origin').send({ name: 'Legit2' })).status).toBe(200)
      expect((await owner.get('/api/company').set('Origin', 'https://evil.test')).status).toBe(200) // reads unaffected
      // server-to-server AgentBuff endpoint is exempt (bearer assertion auth)
      expect((await request(app).post('/api/agentbuff/mcp-token').set('Origin', 'https://evil.test').send({})).body.error).not.toBe('forbidden_origin')
    } finally {
      delete process.env.ABSENTRA_ENFORCE_ORIGIN
      delete process.env.APP_ORIGIN
    }
  })
  it('session cookie is Secure behind the HTTPS proxy, httpOnly + SameSite=Lax always', async () => {
    const https = await request(app).post('/api/auth/signin').set('X-Forwarded-Proto', 'https').send({ email: 'andi@s.test', password: PW('andi@s.test'), register: false })
    const c = (https.headers['set-cookie'] as unknown as string[]).find((x) => x.startsWith('absentra_sid='))!
    expect(c).toMatch(/Secure/); expect(c).toMatch(/HttpOnly/); expect(c).toMatch(/SameSite=Lax/i)
    const plain = await request(app).post('/api/auth/signin').send({ email: 'andi@s.test', password: PW('andi@s.test'), register: false })
    expect((plain.headers['set-cookie'] as unknown as string[]).find((x) => x.startsWith('absentra_sid='))).not.toMatch(/Secure/)
  })
  it('sends protective headers: CSP without inline scripts, no framing, camera/location only for itself, HSTS over HTTPS', async () => {
    const r = await request(app).get('/api/health').set('X-Forwarded-Proto', 'https')
    const csp = String(r.headers['content-security-policy'])
    expect(csp).toMatch(/script-src 'self'(;|$)/)
    expect(csp).toMatch(/frame-ancestors 'none'/)
    expect(csp).toMatch(/object-src 'none'/)
    expect(r.headers['x-frame-options']).toBe('DENY')
    expect(String(r.headers['permissions-policy'])).toMatch(/camera=\(self\)/)
    expect(String(r.headers['permissions-policy'])).toMatch(/microphone=\(\)/)
    expect(String(r.headers['strict-transport-security'])).toMatch(/max-age=\d+/)
    expect((await request(app).get('/api/health')).headers['strict-transport-security']).toBeUndefined()
  })
})

// ---------------------------------------------------------------- 6 passwordless
describe('#6 No passwordless sign-in', () => {
  it('an allowlisted account without a password cannot be entered nor have a first password planted', async () => {
    db.prepare(`INSERT INTO user (id, google_sub, email, name, created_at) VALUES ('usr_google_s', 'g-123', 'google@s.test', 'G', ?)`).run(new Date().toISOString())
    expect((await request(app).post('/api/auth/signin').send({ email: 'google@s.test', register: false })).status).toBe(401)
    expect((await request(app).post('/api/auth/signin').send({ email: 'google@s.test', password: 'attacker-pw', register: true })).status).toBe(401)
    expect((db.prepare('SELECT password_hash FROM user WHERE id=?').get('usr_google_s') as any).password_hash).toBeNull()
  })
  it('registration requires a password', async () => {
    const r = await request(app).post('/api/auth/signin').send({ email: 'nopw@s.test', register: true })
    expect(r.status).toBe(400); expect(r.body.error).toBe('password_required')
  })
  it('"*" in the allowlist is refused in production', async () => {
    const { config } = await import('../src/lib/config.js')
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try { expect(config.isPasswordAllowed('anyone@s.test')).toBe(false) } finally { process.env.NODE_ENV = prev }
    expect(config.isPasswordAllowed('anyone@s.test')).toBe(true)
  })
})

// ---------------------------------------------------------------- 7 MCP
describe('#7 MCP hardening', () => {
  let full: string, other: string
  const ALL = ['attendance:read', 'attendance:write', 'shift:read', 'shift:write', 'employee:read', 'employee:write', 'org:read', 'org:write', 'policy:read', 'policy:write', 'request:read', 'request:write', 'payroll:read', 'audit:read']
  beforeAll(async () => {
    full = (await owner.post('/api/mcp/connections').send({ agentName: 'Agen', scopes: ALL })).body.accessToken
    other = (await owner.post('/api/mcp/connections').send({ agentName: 'Agen2', scopes: ALL })).body.accessToken
  })
  it('(e) connection creation validates scopes and branch ids', async () => {
    expect((await owner.post('/api/mcp/connections').send({ agentName: 'X', scopes: ['god:mode'] })).body.error).toBe('invalid_scope')
    expect((await owner.post('/api/mcp/connections').send({ agentName: 'X', scopes: ['org:read'], scopeBranchIds: [branchB1] })).body.error).toBe('invalid_branch')
  })
  it('(a) agents cannot mint hr/branch_admin', async () => {
    const r = await tool(full, 'employee.create', { name: 'Agen HR', email: 'agenhr@s.test', branchRef: 'Pusat', role: 'hr' })
    expect(r.body.result.status).toBe('forbidden'); expect(r.body.result.confirmationToken).toBeUndefined()
    expect((await tool(full, 'employee.invite', { branchRef: 'Pusat', role: 'branch_admin' })).body.result.status).toBe('forbidden')
  })
  it('(b) confirm:true alone never executes; the token is bound to exact args, single-use, per connection', async () => {
    const pre = await tool(full, 'division.create', { name: 'Satu', confirm: true })
    expect(pre.body.result.status).toBe('needs_confirmation')
    const tok = pre.body.result.confirmationToken
    expect(tok).toMatch(/^cfm_/)
    expect((db.prepare("SELECT COUNT(*) n FROM division WHERE name='Satu'").get() as any).n).toBe(0)
    // changed args with the token → refused
    expect((await tool(full, 'division.create', { name: 'Dua', confirmationToken: tok })).body.result.status).toBe('confirmation_invalid')
    expect((db.prepare("SELECT COUNT(*) n FROM division WHERE name IN ('Satu','Dua')").get() as any).n).toBe(0)
    // the token was consumed by the failed attempt; a fresh one works once
    const pre2 = (await tool(full, 'division.create', { name: 'Satu' })).body.result.confirmationToken
    expect((await tool(other, 'division.create', { name: 'Satu', confirmationToken: pre2 })).body.result.status).toBe('confirmation_invalid') // other connection
    const pre3 = (await tool(full, 'division.create', { name: 'Satu' })).body.result.confirmationToken
    expect((await tool(full, 'division.create', { name: 'Satu', confirmationToken: pre3 })).body.result.status).toBe('created')
    expect((await tool(full, 'division.create', { name: 'Satu', confirmationToken: pre3 })).body.result.status).toBe('confirmation_invalid') // replay
    expect((db.prepare("SELECT COUNT(*) n FROM division WHERE name='Satu'").get() as any).n).toBe(1)
  })
  it('(b) a wage preview goes stale when the wage changed in between', async () => {
    const pre = (await tool(full, 'wage.set', { employeeRef: 'Andi', wageBasic: 9_000_000 })).body.result
    await owner.patch(`/api/employees/${empAndi}`).send({ wageBasic: 4_100_000 })
    expect((await tool(full, 'wage.set', { employeeRef: 'Andi', wageBasic: 9_000_000, confirmationToken: pre.confirmationToken })).body.result.status).toBe('confirmation_invalid')
    expect((db.prepare('SELECT wage_basic FROM employee_profile WHERE id=?').get(empAndi) as any).wage_basic).toBe(4_100_000)
  })
  it('(c) the MCP content array is never overwritten by tool data', async () => {
    const r = await tool(full, 'attendance.who_is_present', {})
    expect(r.body.result.content[0].type).toBe('text')
    expect(Array.isArray(r.body.result.present)).toBe(true)
  })
  it('(d) shift.assign applies the same overlap rule as REST', async () => {
    await owner.post('/api/shift-templates').send({ name: 'Siang', startTime: '12:00', endTime: '20:00' })
    const pagi = (await owner.get('/api/shift-templates')).body.find((t: any) => t.name === 'Pagi').id
    const d = addDays(TODAY, 20)
    await owner.post('/api/shift-assignments').send({ employeeIds: [empAndi], shiftTemplateId: pagi, dateStart: d })
    const r = await tool(full, 'shift.assign', { employeeRef: 'Andi', shiftTemplate: 'Siang', date: d })
    expect(r.body.result.status).toBe('conflict'); expect(r.body.result.reason).toBe('overlap')
  })
  it('(f) "today" follows the company timezone', async () => {
    const tokB = (await ownerB.post('/api/mcp/connections').send({ agentName: 'B', scopes: ['attendance:read'] })).body.accessToken
    const jayapura = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jayapura' }).format(new Date())
    expect((await tool(tokB, 'dashboard.summary', {})).body.result.date).toBe(jayapura)
  })
  it('(g) CSV exports neutralise spreadsheet formulas', async () => {
    await owner.post('/api/employees').send({ name: '=HYPERLINK("http://evil")', email: 'formula@s.test', branchId: branchA1 })
    const r = await tool(full, 'payroll.export', { periodStart: TODAY, periodEnd: TODAY })
    expect(r.body.result.csv).toContain(`"'=HYPERLINK(""http://evil"")"`)
    expect(r.body.result.csv).not.toMatch(/(^|,)=HYPERLINK/m)
  })
  it('date ranges are capped for agents too', async () => {
    const r = await tool(full, 'attendance.list', { from: '2020-01-01', to: '2026-01-01' })
    expect(r.body.error.code).toBe(-32602); expect(r.body.error.data.message).toMatch(/range_too_long/)
  })
})

// ---------------------------------------------------------------- 8 consent + retention
describe('#8 Consent + photo retention (UU PDP)', () => {
  let citra: any
  beforeAll(async () => {
    await owner.post('/api/employees').send({ name: 'Citra', email: 'citra@s.test', branchId: branchA1 })
    citra = agent(); await signin(citra, 'citra@s.test')
  })
  it('no clock-in without location consent; consent flags exposed in /auth/me', async () => {
    const me = (await citra.get('/api/auth/me')).body
    expect(me.consentLocation).toBe(false); expect(me.consentPhoto).toBe(false)
    const r = await citra.post('/api/attendance/clock').send(clockBody('in', 'citra-in-1'))
    expect(r.status).toBe(403); expect(r.body.error).toBe('consent_required')
  })
  it('location-only consent → clock-in works but the photo is dropped', async () => {
    const c = await citra.post('/api/me/consent').send({ consentLocation: true, consentPhoto: false })
    expect(c.body.consentLocation).toBe(true); expect(c.body.consentPhoto).toBe(false)
    expect((await citra.get('/api/auth/me')).body.consentLocation).toBe(true)
    const r = await citra.post('/api/attendance/clock').send(clockBody('in', 'citra-in-2', { photoData: JPEG }))
    expect(r.status).toBe(200)
    const evt = db.prepare('SELECT photo_data FROM attendance_event WHERE attendance_record_id=?').get(r.body.record.id) as any
    expect(evt.photo_data).toBeNull()
    expect(r.body.reasons).not.toContain('Absen tanpa foto') // no consent → no photo expected, no penalty
  })
  it('invite acceptance needs only location consent; photo stays opt-in', async () => {
    const inv = (await owner.post('/api/invites').send({ branchId: branchA1 })).body
    const e = agent(); await signin(e, 'locationonly@s.test')
    expect((await e.post(`/api/invites/token/${inv.token}/accept`).send({ consentLocation: false, consentPhoto: true })).status).toBe(400)
    expect((await e.post(`/api/invites/token/${inv.token}/accept`).send({ consentLocation: true })).status).toBe(200)
    const me = (await e.get('/api/auth/me')).body
    expect(me.consentLocation).toBe(true); expect(me.consentPhoto).toBe(false)
  })
  it('photo consent given but no photo sent → transparent "Absen tanpa foto" deduction', async () => {
    const e = agent(); await signin(e, 'nophoto@s.test')
    const inv = (await owner.post('/api/invites').send({ branchId: branchA1 })).body
    await e.post(`/api/invites/token/${inv.token}/accept`).send({ consentLocation: true, consentPhoto: true })
    const r = await e.post('/api/attendance/clock').send(clockBody('in', 'nophoto-in', { cameraAvailable: false }))
    expect(r.body.reasons).toContain('Absen tanpa foto'); expect(r.body.trustScore).toBe(85)
  })
  it('photos older than the retention window are purged (audited); newer ones kept', async () => {
    const { runMaintenance } = await import('../src/lib/maintenance.js')
    const old = db.prepare(`SELECT id FROM attendance_event WHERE company_id=? AND photo_data IS NOT NULL LIMIT 1`).get(cidA) as any
    const keep = db.prepare(`SELECT id FROM attendance_event WHERE company_id=? AND photo_data IS NOT NULL AND id != ? LIMIT 1`).get(cidA, old.id) as any
    db.prepare('UPDATE attendance_event SET event_time_server=? WHERE id=?').run(new Date(Date.now() - 100 * 864e5).toISOString(), old.id)
    const out = runMaintenance()
    expect(out.photos.find((p) => p.companyId === cidA)?.purged).toBe(1)
    expect((db.prepare('SELECT photo_data FROM attendance_event WHERE id=?').get(old.id) as any).photo_data).toBeNull()
    expect((db.prepare('SELECT photo_data FROM attendance_event WHERE id=?').get(keep.id) as any).photo_data).toBe(JPEG)
    const a = db.prepare(`SELECT * FROM audit_log WHERE company_id=? AND action='attendance.photo_purge'`).get(cidA) as any
    expect(a.actor_type).toBe('operator')
  })
})

// ---------------------------------------------------------------- 9 inactive membership
describe('#9 Inactive membership is locked out everywhere', () => {
  it('a deactivated employee\'s live session cannot reach tenant routes or clock in', async () => {
    const dodi = (await owner.post('/api/employees').send({ name: 'Dodi', email: 'dodi@s.test', branchId: branchA1 })).body.id
    const d = agent(); await signin(d, 'dodi@s.test')
    await d.post('/api/me/consent').send({ consentLocation: true, consentPhoto: false })
    expect((await d.get('/api/company')).status).toBe(200)
    await owner.patch(`/api/employees/${dodi}`).send({ employmentStatus: 'inactive' })
    const r = await d.get('/api/company')
    expect(r.status).toBe(403); expect(r.body.error).toBe('membership_inactive')
    expect((await d.post('/api/attendance/clock').send(clockBody('in', 'dodi-in-1'))).status).toBe(403)
    expect((await d.get('/api/branches')).status).toBe(403)
  })
})

// ---------------------------------------------------------------- 10 rate limits
describe('#10 Rate limits', () => {
  it('11th sign-in attempt within a minute from one IP → 429', async () => {
    const { resetAllLimits } = await import('../src/lib/rateLimit.js')
    delete process.env.ABSENTRA_RATE_LIMIT_DISABLED
    resetAllLimits()
    try {
      const codes: number[] = []
      for (let i = 0; i < 11; i++) codes.push((await request(app).post('/api/auth/signin').send({ email: 'brute@s.test', password: 'guess' + i, register: false })).status)
      expect(codes.slice(0, 10).every((c) => c !== 429)).toBe(true)
      expect(codes[10]).toBe(429)
    } finally {
      process.env.ABSENTRA_RATE_LIMIT_DISABLED = '1'
      resetAllLimits()
    }
  })
})

// ---------------------------------------------------------------- 11 images
describe('#11 Image limits', () => {
  it('profile photo: too large / not an image → rejected', async () => {
    const big = 'data:image/jpeg;base64,/9j/' + 'A'.repeat(420_000)
    expect((await andi.post('/api/me/profile-photo').send({ photoData: big })).body.error).toBe('photo_too_large')
    const fakePng = 'data:image/png;base64,' + Buffer.from('<html><script>alert(1)</script></html>').toString('base64')
    expect((await andi.post('/api/me/profile-photo').send({ photoData: fakePng })).body.error).toBe('photo_invalid')
    expect((await andi.post('/api/me/profile-photo').send({ photoData: JPEG })).status).toBe(200)
  })
  it('logo: SVG refused', async () => {
    const svg = 'data:image/svg+xml;base64,' + Buffer.from('<svg onload="alert(1)"/>').toString('base64')
    expect((await owner.post('/api/company/logo').send({ logoData: svg })).body.error).toBe('photo_invalid')
  })
  it('attendance photo larger than 400 KB → rejected', async () => {
    const big = 'data:image/jpeg;base64,/9j/' + 'A'.repeat(560_000)
    expect((await andi.post('/api/attendance/clock').send(clockBody('out', 'andi-big-out', { photoData: big }))).body.error).toBe('photo_too_large')
  })
  it('JSON bodies above 1 MB are refused', async () => {
    const r = await owner.post('/api/divisions').send({ name: 'x'.repeat(1_200_000) })
    expect(r.status).toBe(413)
  })
})

// ---------------------------------------------------------------- 12 dates
describe('#12 Date validation + range caps', () => {
  it('ranges over 366 days and impossible dates are refused', async () => {
    const r = await andi.get('/api/me/attendance').query({ from: '2020-01-01', to: '2026-01-01' })
    expect(r.status).toBe(400); expect(r.body.error).toBe('range_too_long')
    expect((await owner.post('/api/reports/payroll').send({ periodStart: '2024-01-01', periodEnd: '2026-01-01' })).body.error).toBe('range_too_long')
    expect((await owner.get('/api/shift-assignments').query({ from: '2026-02-30', to: '2026-03-01' })).status).toBe(400)
    expect((await owner.post('/api/shift-assignments').send({ employeeIds: [empAndi], shiftTemplateId: 'x', dateStart: '2026-01-01', dateEnd: '2028-01-01' })).body.error).toBe('range_too_long')
  })
})

// ---------------------------------------------------------------- 13 timezone + policy
describe('#13 Timezone + policy validation', () => {
  it('only Indonesian zones are accepted', async () => {
    const t = agent(); await signin(t, 'tz@s.test')
    expect((await t.post('/api/companies').send({ displayName: 'TZ', businessType: 'X', timezone: 'Europe/London', workweekType: 'six_day' })).body.error).toBe('invalid_timezone')
    expect((await owner.patch('/api/company').send({ timezone: 'Mars/Base' })).body.error).toBe('invalid_timezone')
    expect((await owner.patch('/api/company').send({ timezone: 'Asia/Makassar' })).status).toBe(200)
    await owner.patch('/api/company').send({ timezone: 'Asia/Jakarta' })
  })
  it('PUT /policy without minRestHours keeps the current value', async () => {
    const base = { lateDeductionMode: 'per_minute', lateDeductionConfig: { perMinuteRate: 500 }, mealAllowanceConfig: {}, strictGeofence: false, trustThresholds: { accept: 80, review: 60 }, photoRetentionDays: 90 }
    await owner.put('/api/policy').send({ ...base, minRestHours: 8 })
    await owner.put('/api/policy').send(base)
    expect((db.prepare('SELECT min_rest_hours FROM policy WHERE company_id=?').get(cidA) as any).min_rest_hours).toBe(8)
    await owner.put('/api/policy').send({ ...base, minRestHours: 0 })
  })
})

// ---------------------------------------------------------------- 14 error leaks
describe('#14 Errors never leak internals', () => {
  it('500s answer a generic "internal"', async () => {
    const { errorHandler } = await import('../src/app.js')
    let status = 0, body: any = null
    const res: any = { headersSent: false, status(s: number) { status = s; return this }, json(b: any) { body = b; return this } }
    const orig = console.error; console.error = () => {}
    try { errorHandler(new Error('SQLITE_ERROR: no such table secret_stuff at /srv/app.ts'), { method: 'GET', path: '/x' } as any, res, () => {}) } finally { console.error = orig }
    expect(status).toBe(500); expect(body.error).toBe('internal'); expect(JSON.stringify(body)).not.toMatch(/SQLITE|secret_stuff/)
  })
  it('malformed JSON → 400 invalid_json', async () => {
    const r = await owner.post('/api/divisions').set('content-type', 'application/json').send('{"name": ')
    expect(r.status).toBe(400); expect(r.body.error).toBe('invalid_json')
  })
})

// ---------------------------------------------------------------- 15 gate
describe('#15 Entitlement gate fails closed when misconfigured in production', () => {
  it('owner flows are refused with gate_misconfigured', async () => {
    const gate = await import('../src/lib/agentbuffGate.js')
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      expect(gate.gateMisconfigured()).toBe(true)
      expect(await gate.ownerStatusFresh(ownerUserId)).toEqual({ entitled: false, reason: 'gate_misconfigured' })
      expect((await gate.checkEntitlementStrict('owner@s.test')).entitled).toBe(false)
    } finally { process.env.NODE_ENV = prev }
    expect((await gate.ownerStatusFresh(ownerUserId)).entitled).toBe(true) // dev/test: gate off
  })
})

// ---------------------------------------------------------------- 16/17
describe('#16/#17 Audit IP + bounded sessions', () => {
  it('audit entries record the client IP', async () => {
    await owner.post('/api/divisions').send({ name: 'Audit IP' })
    const row = db.prepare(`SELECT ip FROM audit_log WHERE company_id=? AND action='division.create' ORDER BY created_at DESC LIMIT 1`).get(cidA) as any
    expect(row.ip).toBeTruthy()
  })
  it('refresh rotation replaces the session row instead of accumulating', async () => {
    const s = await request(app).post('/api/auth/signin').send({ email: 'rot@s.test', password: 'Rahasia-rot', register: true })
    const uid = s.body.user.id
    const cookies = () => (s.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0])
    let jar = cookies()
    for (let i = 0; i < 3; i++) {
      const r = await request(app).post('/api/auth/refresh').set('Cookie', jar.join('; '))
      expect(r.status).toBe(200)
      jar = (r.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0])
    }
    expect((db.prepare('SELECT COUNT(*) n FROM session WHERE user_id=?').get(uid) as any).n).toBe(1)
  })
})
