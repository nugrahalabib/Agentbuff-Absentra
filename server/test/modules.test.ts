/**
 * Black-box tests for the modules built to close the test plan: SSO Gateway (UC-02),
 * refresh-token rotation (TC-018), MCP server (UC-33/34/35), and feature gaps.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import request from 'supertest'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import type { Express } from 'express'

let app: Express
const agent = () => request.agent(app)
const signin = (a: any, email: string) => a.post('/api/auth/signin').send({ email, name: email.split('@')[0], register: true })
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())
const addDays = (iso: string, d: number) => { const [y, m, dd] = iso.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1, dd)); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10) }
const getCookie = (res: any, name: string): string | null => {
  for (const c of res.headers['set-cookie'] ?? []) { const m = String(c).match(new RegExp(`^${name}=([^;]+)`)); if (m) return m[1] }
  return null
}
function nowWibMin() { const p = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' }).formatToParts(new Date()); return Number(p.find((x) => x.type === 'hour')!.value) * 60 + Number(p.find((x) => x.type === 'minute')!.value) }
const hhmm = (min: number) => { const m = ((min % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` }

let owner: any, andi: any, ownerB: any
let cidA: string, branchA1: string, divDapur: string, shiftPagi: string, empAndi: string
let connReadToken: string, connWriteToken: string, connBToken: string, cidB: string, mcpReadId: string

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'absentra-mod-'))
  process.env.ABSENTRA_DB = join(dir, 'test.db')
  process.env.PASSWORD_AUTH_ALLOWLIST = '*'
  app = (await import('../src/app.js')).createApp()

  owner = agent(); await signin(owner, 'owner@m.test')
  cidA = (await owner.post('/api/companies').send({ displayName: 'M-A', businessType: 'Kuliner', timezone: 'Asia/Jakarta', workweekType: 'six_day' })).body.activeCompanyId
  branchA1 = (await owner.post('/api/branches').send({ name: 'Pusat', lat: -6.2, long: 106.8166, radiusM: 100 })).body.id
  divDapur = (await owner.post('/api/divisions').send({ name: 'Dapur' })).body.id
  shiftPagi = (await owner.post('/api/shift-templates').send({ name: 'Pagi', startTime: '08:00', endTime: '17:00', lateToleranceMinutes: 10 })).body.id
  empAndi = (await owner.post('/api/employees').send({ name: 'Andi', email: 'andi@m.test', branchId: branchA1, divisionId: divDapur, wageBasic: 4_000_000 })).body.id
  await owner.post('/api/employees').send({ name: 'Budi Satu', email: 'budi1@m.test', branchId: branchA1 })
  await owner.post('/api/employees').send({ name: 'Budi Dua', email: 'budi2@m.test', branchId: branchA1 })
  await owner.post('/api/shift-assignments').send({ employeeIds: [empAndi], shiftTemplateId: shiftPagi, dateStart: TODAY, skipSundays: false })
  andi = agent(); await signin(andi, 'andi@m.test')

  const r1 = await owner.post('/api/mcp/connections').send({ agentName: 'Reader', scopes: ['attendance:read'] })
  connReadToken = r1.body.accessToken; mcpReadId = r1.body.id
  connWriteToken = (await owner.post('/api/mcp/connections').send({ agentName: 'Writer', scopes: ['attendance:read', 'shift:write'] })).body.accessToken

  ownerB = agent(); await signin(ownerB, 'owner@b2.test')
  cidB = (await ownerB.post('/api/companies').send({ displayName: 'M-B', businessType: 'Retail', timezone: 'Asia/Jakarta', workweekType: 'five_day' })).body.activeCompanyId
  await ownerB.post('/api/branches').send({ name: 'B', lat: -6.3, long: 106.8, radiusM: 100 })
  connBToken = (await ownerB.post('/api/mcp/connections').send({ agentName: 'B-agent', scopes: ['attendance:read'] })).body.accessToken
})

const rpc = (tokenStr: string, method: string, params?: any) =>
  request(app).post('/mcp').set('Authorization', `Bearer ${tokenStr}`).send({ jsonrpc: '2.0', id: 1, method, params })

// ---------------- UC-04 refresh rotation ----------------
describe('UC-AB-04 TC-AB-018 rotasi refresh-token', () => {
  it('reuse refresh token yang sudah dirotasi → family dicabut', async () => {
    const s = await request(app).post('/api/auth/signin').send({ email: 'rt@m.test', register: true })
    const rt0 = getCookie(s, 'absentra_rt')!
    const r1 = await request(app).post('/api/auth/refresh').set('Cookie', `absentra_rt=${rt0}`)
    expect(r1.status).toBe(200)
    const rt1 = getCookie(r1, 'absentra_rt')!
    const reuse = await request(app).post('/api/auth/refresh').set('Cookie', `absentra_rt=${rt0}`) // reuse old
    expect(reuse.status).toBe(401)
    const afterRevoke = await request(app).post('/api/auth/refresh').set('Cookie', `absentra_rt=${rt1}`) // family revoked
    expect(afterRevoke.status).toBe(401)
  })
})

// ---------------- UC-02 SSO Gateway ----------------
describe('UC-AB-02 SSO Gateway', () => {
  let priv: any, sign: (claims: any, exp: number) => Promise<string>
  beforeAll(async () => {
    const kp = await generateKeyPair('RS256'); priv = kp.privateKey
    const jwk = await exportJWK(kp.publicKey)
    await owner.post('/api/sso/bridges').send({ issuer: 'https://partner.x', jwks: { keys: [{ ...jwk, kid: 'p1', alg: 'RS256', use: 'sig' }] } })
    sign = (claims, exp) => new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'p1' }).setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) + exp).setJti(`jti-${Math.random()}`).sign(priv)
  })
  it('TC-AB-007 assertion valid + issuer allowlist → sesi', async () => {
    const a = await sign({ iss: 'https://partner.x', aud: 'absentra', sub: 'p-user', email: 'partner@x.test' }, 60)
    const r = await request(app).post('/api/sso/bridge/token').send({ assertion: a })
    expect(r.status).toBe(200); expect(r.body.activeCompanyId).toBe(cidA)
  })
  it('TC-AB-008 issuer di luar allowlist → ditolak', async () => {
    const kp = await generateKeyPair('RS256')
    const a = await new SignJWT({ iss: 'https://evil.x', aud: 'absentra', sub: 'x' }).setProtectedHeader({ alg: 'RS256' }).setIssuedAt().setExpirationTime('5m').setJti('j1').sign(kp.privateKey)
    expect((await request(app).post('/api/sso/bridge/token').send({ assertion: a })).status).toBe(403)
  })
  it('TC-AB-009 assertion kedaluwarsa → ditolak', async () => {
    const a = await sign({ iss: 'https://partner.x', aud: 'absentra', sub: 'p' }, -60)
    expect((await request(app).post('/api/sso/bridge/token').send({ assertion: a })).status).toBe(401)
  })
  it('TC-AB-010 jti dipakai ulang → replay ditolak', async () => {
    const a = await new SignJWT({ iss: 'https://partner.x', aud: 'absentra', sub: 'p', email: 'r@x.test' }).setProtectedHeader({ alg: 'RS256', kid: 'p1' }).setIssuedAt().setExpirationTime('5m').setJti('fixed-jti').sign(priv)
    expect((await request(app).post('/api/sso/bridge/token').send({ assertion: a })).status).toBe(200)
    expect((await request(app).post('/api/sso/bridge/token').send({ assertion: a })).status).toBe(401) // replay
  })
  it('TC-AB-011 signature tidak cocok → ditolak', async () => {
    const other = await generateKeyPair('RS256')
    const a = await new SignJWT({ iss: 'https://partner.x', aud: 'absentra', sub: 'p' }).setProtectedHeader({ alg: 'RS256', kid: 'p1' }).setIssuedAt().setExpirationTime('5m').setJti('j2').sign(other.privateKey)
    expect((await request(app).post('/api/sso/bridge/token').send({ assertion: a })).status).toBe(401)
  })
  it('TC-AB-012 aud salah → ditolak', async () => {
    const a = await sign({ iss: 'https://partner.x', aud: 'wrong', sub: 'p' }, 60)
    expect((await request(app).post('/api/sso/bridge/token').send({ assertion: a })).status).toBe(401)
  })
})

// ---------------- UC-33/34/35 MCP ----------------
describe('UC-AB-33/34/35 MCP server', () => {
  it('TC-AB-143 attendance.recap (scope read) ter-scope tenant', async () => {
    const r = await rpc(connReadToken, 'tools/call', { name: 'attendance.recap', arguments: { periodStart: addDays(TODAY, -7), periodEnd: TODAY, branchId: branchA1 } })
    expect(r.body.result.content.some((c: any) => c.name === 'Andi')).toBe(true)
  })
  it('TC-AB-145 scope tidak cukup → ditolak', async () => {
    const r = await rpc(connReadToken, 'tools/call', { name: 'shift.assign', arguments: { employeeRef: 'Andi', shiftTemplate: 'Pagi', date: TODAY } })
    expect(r.body.error.code).toBe(-32001)
  })
  it('TC-AB-146 referensi ambigu → elicitation', async () => {
    const r = await rpc(connWriteToken, 'tools/call', { name: 'shift.assign', arguments: { employeeRef: 'Budi', shiftTemplate: 'Pagi', date: TODAY } })
    expect(r.body.result.status).toBe('needs_clarification'); expect(r.body.result.candidates.length).toBe(2)
  })
  it('TC-AB-147/154 tool tulis tanpa konfirmasi → tidak dieksekusi', async () => {
    const r = await rpc(connWriteToken, 'tools/call', { name: 'shift.assign', arguments: { employeeRef: 'Andi', shiftTemplate: 'Pagi', date: addDays(TODAY, 3) } })
    expect(r.body.result.status).toBe('needs_confirmation')
    const after = await owner.get('/api/shift-assignments').query({ employeeId: empAndi, from: addDays(TODAY, 3), to: addDays(TODAY, 3) })
    expect(after.body.length).toBe(0) // TC-155: tanpa konfirmasi tidak ada perubahan
  })
  it('TC-AB-144 shift.assign dengan konfirmasi → ditambah + audit', async () => {
    const r = await rpc(connWriteToken, 'tools/call', { name: 'shift.assign', arguments: { employeeRef: 'Andi', shiftTemplate: 'Pagi', date: addDays(TODAY, 4), confirm: true } })
    expect(r.body.result.status).toBe('assigned')
    const agentAudit = (await owner.get('/api/audit?actorType=agent')).body
    expect(agentAudit.some((x: any) => x.action === 'mcp.shift.assign')).toBe(true) // TC-150
  })
  it('TC-AB-148 parameter tak sesuai schema → ditolak', async () => {
    const r = await rpc(connReadToken, 'tools/call', { name: 'attendance.recap', arguments: { periodStart: 123 } })
    expect(r.body.error.code).toBe(-32602)
  })
  it('TC-AB-149 token tenant B tak melihat data tenant A', async () => {
    const r = await rpc(connBToken, 'tools/call', { name: 'attendance.recap', arguments: { periodStart: addDays(TODAY, -7), periodEnd: TODAY } })
    expect(r.body.result.content.some((c: any) => c.name === 'Andi')).toBe(false)
  })
  it('TC-AB-152 resources/read policy (tenant sendiri) ok', async () => {
    const r = await rpc(connReadToken, 'resources/read', { uri: `absentra://company/${cidA}/policy` })
    expect(r.body.result.contents[0].uri).toContain(cidA)
  })
  it('TC-AB-153 resources/read tenant lain → ditolak', async () => {
    const r = await rpc(connReadToken, 'resources/read', { uri: `absentra://company/${cidB}/policy` })
    expect(r.body.error.code).toBe(-32002)
  })
  it('TC-AB-072 koneksi dicabut → tool ditolak', async () => {
    await owner.delete(`/api/mcp/connections/${mcpReadId}`)
    const r = await rpc(connReadToken, 'tools/call', { name: 'attendance.who_is_present', arguments: {} })
    expect(r.status).toBe(401)
  })
  it('TC-AB-151 rate limit per koneksi', async () => {
    let limited = false
    for (let i = 0; i < 25; i++) {
      const r = await rpc(connWriteToken, 'tools/call', { name: 'attendance.who_is_present', arguments: {} })
      if (r.body.error?.code === -32029) { limited = true; break }
    }
    expect(limited).toBe(true)
  })
})

// ---------------- Feature gaps ----------------
describe('Fitur tambahan', () => {
  it('TC-AB-025/026 logo: format salah ditolak, valid diterima', async () => {
    expect((await owner.post('/api/company/logo').send({ logoData: 'data:text/plain;base64,AAA' })).status).toBe(400)
    expect((await owner.post('/api/company/logo').send({ logoData: 'data:image/png;base64,iVBORw0KGgo=' })).status).toBe(200)
  })
  it('TC-AB-030 geofence poligon tersimpan', async () => {
    const r = await owner.post('/api/branches').send({ name: 'Poligon', lat: -6.2, long: 106.8, polygon: [{ lat: -6.20, long: 106.80 }, { lat: -6.20, long: 106.82 }, { lat: -6.22, long: 106.81 }] })
    expect(r.body.geofence.type).toBe('polygon')
  })
  it('TC-AB-094 pola rotasi diterapkan', async () => {
    const r = await owner.post('/api/shift-assignments/rotation').send({ employeeIds: [empAndi], pattern: [shiftPagi, null, shiftPagi], dateStart: addDays(TODAY, 30), days: 6 })
    expect(r.body.created).toBe(4) // 6 hari, pola [P, off, P] → 4 hari kerja
  })
  it('TC-AB-096 jeda antar-shift di bawah batas → ditolak', async () => {
    await owner.put('/api/policy').send({ lateDeductionMode: 'per_minute', lateDeductionConfig: { perMinuteRate: 500 }, mealAllowanceConfig: {}, strictGeofence: false, trustThresholds: { accept: 80, review: 60 }, photoRetentionDays: 90, minRestHours: 12 } as any)
    const malam = (await owner.post('/api/shift-templates').send({ name: 'Malam2', startTime: '22:00', endTime: '23:30' })).body.id
    const pagi = (await owner.post('/api/shift-templates').send({ name: 'PagiAwal', startTime: '06:00', endTime: '14:00' })).body.id
    await owner.post('/api/shift-assignments').send({ employeeIds: [empAndi], shiftTemplateId: malam, dateStart: addDays(TODAY, 50), skipSundays: false })
    const r = await owner.post('/api/shift-assignments').send({ employeeIds: [empAndi], shiftTemplateId: pagi, dateStart: addDays(TODAY, 51), skipSundays: false })
    expect(r.body.conflicts).toBeGreaterThanOrEqual(1)
    await owner.put('/api/policy').send({ lateDeductionMode: 'per_minute', lateDeductionConfig: { perMinuteRate: 500 }, mealAllowanceConfig: {}, strictGeofence: false, trustThresholds: { accept: 80, review: 60 }, photoRetentionDays: 90, minRestHours: 0 } as any)
  })
  it('TC-AB-110/125 clock-out lewat shift → draft lembur (pending, tak auto-dihitung)', async () => {
    const e = agent(); await signin(e, 'otdraft@m.test')
    const inv = (await owner.post('/api/invites').send({ branchId: branchA1, role: 'employee' })).body
    await e.post(`/api/invites/token/${inv.token}/accept`).send({ consentLocation: true, consentPhoto: true })
    const eid = (await e.get('/api/auth/me')).body.employeeId
    const nm = nowWibMin()
    const tpl = (await owner.post('/api/shift-templates').send({ name: 'Lewat', startTime: hhmm(nm - 180), endTime: hhmm(nm - 60), lateToleranceMinutes: 999 })).body.id
    await owner.post('/api/shift-assignments').send({ employeeIds: [eid], shiftTemplateId: tpl, dateStart: TODAY, skipSundays: false })
    await e.post('/api/attendance/clock').send({ kind: 'in', lat: -6.2, long: 106.8166, gpsAccuracyM: 15, livenessPassed: true, cameraAvailable: true, geofenceResult: 'inside', idempotencyKey: 'otd-in-1' })
    await e.post('/api/attendance/clock').send({ kind: 'out', lat: -6.2, long: 106.8166, gpsAccuracyM: 15, livenessPassed: true, cameraAvailable: true, geofenceResult: 'inside', idempotencyKey: 'otd-out-1' })
    const ots = (await owner.get('/api/overtimes')).body.filter((o: any) => o.employeeId === eid && o.workDate === TODAY)
    expect(ots.length).toBeGreaterThanOrEqual(1)
    expect(ots[0].status).toBe('pending') // draft, belum dihitung
  })
  it('TC-AB-122 impossible travel → trust turun + alasan', async () => {
    const e = agent(); await signin(e, 'travel@m.test')
    const inv = (await owner.post('/api/invites').send({ branchId: branchA1, role: 'employee' })).body
    await e.post(`/api/invites/token/${inv.token}/accept`).send({ consentLocation: true, consentPhoto: true })
    const eid = (await e.get('/api/auth/me')).body.employeeId
    await owner.post('/api/shift-assignments').send({ employeeIds: [eid], shiftTemplateId: shiftPagi, dateStart: TODAY, skipSundays: false })
    await e.post('/api/attendance/clock').send({ kind: 'in', lat: -6.2, long: 106.8166, gpsAccuracyM: 15, livenessPassed: true, cameraAvailable: true, geofenceResult: 'inside', idempotencyKey: 'trv-in-1' })
    const out = await e.post('/api/attendance/clock').send({ kind: 'out', lat: -8.65, long: 115.21, gpsAccuracyM: 15, livenessPassed: true, cameraAvailable: true, geofenceResult: 'outside', idempotencyKey: 'trv-out-1' })
    expect(out.body.reasons.some((r: string) => /impossible/i.test(r))).toBe(true)
  })
  it('TC-AB-099 lengkapi clock-out yang hilang', async () => {
    const rec = (await owner.get('/api/attendance/feed')).body[0]
    const r = await owner.post(`/api/attendance/${rec.id}/correct`).send({ clockOutAt: `${TODAY}T10:00:00.000Z`, reason: 'lengkapi clock-out' })
    expect(r.status).toBe(200)
  })
  it('TC-AB-105 tolak cuti dengan alasan tersimpan', async () => {
    const lv = (await andi.post('/api/leaves').send({ type: 'izin', dateStart: addDays(TODAY, 60), dateEnd: addDays(TODAY, 60) })).body
    const r = await owner.post(`/api/leaves/${lv.id}/decision`).send({ status: 'rejected', reason: 'beban kerja tinggi' })
    expect(r.body.status).toBe('rejected')
  })
  it('TC-AB-107 setujui cuti bentrok shift → ada peringatan', async () => {
    const lv = (await andi.post('/api/leaves').send({ type: 'izin', dateStart: TODAY, dateEnd: TODAY })).body
    const r = await owner.post(`/api/leaves/${lv.id}/decision`).send({ status: 'approved' })
    expect(r.body.shiftConflict).toBe(true)
  })
  it('TC-AB-130 cuti melebihi saldo → ditolak', async () => {
    const r = await andi.post('/api/leaves').send({ type: 'tahunan', dateStart: addDays(TODAY, 100), dateEnd: addDays(TODAY, 120) }) // 21 hari > 12
    expect(r.status).toBe(409)
  })
  it('TC-AB-132 lampiran cuti tersimpan', async () => {
    const r = await andi.post('/api/leaves').send({ type: 'sakit', dateStart: addDays(TODAY, 70), dateEnd: addDays(TODAY, 70), attachmentName: 'surat-dokter.pdf' })
    expect(r.status).toBe(200)
  })
  it('TC-AB-138 cuti disetujui tampil di jadwal pribadi', async () => {
    const sched = await andi.get('/api/me/schedule').query({ from: addDays(TODAY, -1), to: addDays(TODAY, 1) })
    expect(sched.body.leaves.length).toBeGreaterThanOrEqual(1) // cuti TODAY yang disetujui di TC-107
  })
  it('TC-AB-003 abort login Google → kembali ke login tanpa sesi', async () => {
    const r = await request(app).get('/api/auth/google/callback?error=access_denied')
    expect(r.status).toBe(302); expect(String(r.headers.location)).toContain('/login')
  })
  it('TC-AB-077 undangan kedaluwarsa → ditolak', async () => {
    const inv = (await owner.post('/api/invites').send({ branchId: branchA1, role: 'employee', expiresInDays: 0 })).body
    const e = agent(); await signin(e, 'expired@m.test')
    expect((await e.post(`/api/invites/token/${inv.token}/accept`).send({ consentLocation: true, consentPhoto: true })).status).toBe(400)
  })
  it('Lupa password: admin reset → karyawan masuk dgn password sementara', async () => {
    const e = agent(); await signin(e, 'forgot@m.test')
    const inv = (await owner.post('/api/invites').send({ branchId: branchA1, role: 'employee' })).body
    await e.post(`/api/invites/token/${inv.token}/accept`).send({ consentLocation: true, consentPhoto: true })
    const eid = (await e.get('/api/auth/me')).body.employeeId
    const reset = await owner.post(`/api/employees/${eid}/reset-password`).send({})
    expect(reset.status).toBe(200); expect(reset.body.temporaryPassword).toBeTruthy()
    // login dgn password sementara berhasil; password lama tidak
    const fresh = agent()
    expect((await fresh.post('/api/auth/signin').send({ email: 'forgot@m.test', password: reset.body.temporaryPassword, register: false })).status).toBe(200)
  })
  it('Ganti password sendiri setelah reset: password baru berlaku, lama tidak', async () => {
    const e = agent(); await signin(e, 'chg@m.test')
    const inv = (await owner.post('/api/invites').send({ branchId: branchA1, role: 'employee' })).body
    await e.post(`/api/invites/token/${inv.token}/accept`).send({ consentLocation: true, consentPhoto: true })
    const eid = (await e.get('/api/auth/me')).body.employeeId
    const temp = (await owner.post(`/api/employees/${eid}/reset-password`).send({})).body.temporaryPassword
    const s = agent(); await s.post('/api/auth/signin').send({ email: 'chg@m.test', password: temp, register: false })
    expect((await s.post('/api/auth/change-password').send({ currentPassword: temp, newPassword: 'barubaru1' })).status).toBe(200)
    // password lama salah → 401, baru → 200
    expect((await agent().post('/api/auth/signin').send({ email: 'chg@m.test', password: temp, register: false })).status).toBe(401)
    expect((await agent().post('/api/auth/signin').send({ email: 'chg@m.test', password: 'barubaru1', register: false })).status).toBe(200)
    // password lama salah saat ganti → 401
    expect((await s.post('/api/auth/change-password').send({ currentPassword: 'salahsalah', newPassword: 'lagilagi9' })).status).toBe(401)
  })
  it('TC-AB-085/086 pencarian karyawan (ada hasil & kosong)', async () => {
    expect((await owner.get('/api/employees?q=Andi')).body.some((e: any) => e.name === 'Andi')).toBe(true)
    expect((await owner.get('/api/employees?q=zzznotexist')).body.length).toBe(0)
  })
  it('TC-AB-117 tidak ada shift → konteks memberi tahu (kind none)', async () => {
    const e = agent(); await signin(e, 'noshift@m.test')
    const inv = (await owner.post('/api/invites').send({ branchId: branchA1, role: 'employee' })).body
    await e.post(`/api/invites/token/${inv.token}/accept`).send({ consentLocation: true, consentPhoto: true })
    expect((await e.get('/api/attendance/today-context')).body.kind).toBe('none')
  })
  it('TC-AB-119 izin kamera ditolak → diproses + flag (kontrak API)', async () => {
    const e = agent(); await signin(e, 'nocam@m.test')
    const inv = (await owner.post('/api/invites').send({ branchId: branchA1, role: 'employee' })).body
    await e.post(`/api/invites/token/${inv.token}/accept`).send({ consentLocation: true, consentPhoto: true })
    const eid = (await e.get('/api/auth/me')).body.employeeId
    await owner.post('/api/shift-assignments').send({ employeeIds: [eid], shiftTemplateId: shiftPagi, dateStart: TODAY, skipSundays: false })
    const r = await e.post('/api/attendance/clock').send({ kind: 'in', lat: -6.2, long: 106.8166, gpsAccuracyM: 15, livenessPassed: null, cameraAvailable: false, geofenceResult: 'inside', idempotencyKey: 'nocam-in-1' })
    expect(r.status).toBe(200) // diproses meski tanpa kamera
  })
  it('TC-AB-127 offline submit → late-submitted diterima', async () => {
    const e = agent(); await signin(e, 'offline@m.test')
    const inv = (await owner.post('/api/invites').send({ branchId: branchA1, role: 'employee' })).body
    await e.post(`/api/invites/token/${inv.token}/accept`).send({ consentLocation: true, consentPhoto: true })
    const eid = (await e.get('/api/auth/me')).body.employeeId
    await owner.post('/api/shift-assignments').send({ employeeIds: [eid], shiftTemplateId: shiftPagi, dateStart: TODAY, skipSundays: false })
    const r = await e.post('/api/attendance/clock').send({ kind: 'in', lat: -6.2, long: 106.8166, gpsAccuracyM: 15, livenessPassed: true, cameraAvailable: true, geofenceResult: 'inside', idempotencyKey: 'off-in-1', submittedOffline: true, eventTimeClient: `${TODAY}T01:00:00.000Z` })
    expect(r.status).toBe(200)
  })
})

// ---------------- MCP full parity: tools, resources, prompts ----------------
describe('UC-AB-33/34/35 MCP paritas penuh', () => {
  const ALL_SCOPES = ['attendance:read', 'attendance:write', 'shift:read', 'shift:write', 'employee:read', 'employee:write', 'org:read', 'org:write', 'policy:read', 'policy:write', 'request:read', 'request:write', 'payroll:read', 'audit:read']
  let full: string, readOnly: string

  beforeAll(async () => {
    full = (await owner.post('/api/mcp/connections').send({ agentName: 'Hermes-full', scopes: ALL_SCOPES })).body.accessToken
    readOnly = (await owner.post('/api/mcp/connections').send({ agentName: 'ReadOnly', scopes: ['org:read', 'employee:read'] })).body.accessToken
  })

  it('prompts/list mengembalikan workflow pemandu', async () => {
    const r = await rpc(full, 'prompts/list')
    const names = r.body.result.prompts.map((p: any) => p.name)
    expect(names).toEqual(expect.arrayContaining(['onboard_company', 'weekly_attendance_review', 'run_payroll']))
  })
  it('prompts/get onboard_company berisi langkah + tool yang benar', async () => {
    const r = await rpc(full, 'prompts/get', { name: 'onboard_company', arguments: { companyName: 'Warung X' } })
    const text = r.body.result.messages[0].content.text
    expect(text).toContain('branch.create'); expect(text).toContain('employee.create'); expect(text).toContain('Warung X')
  })
  it('resources/list + resources/read employees (tenant sendiri)', async () => {
    const list = await rpc(full, 'resources/list')
    expect(list.body.result.resources.some((x: any) => x.uri.endsWith('/employees'))).toBe(true)
    const r = await rpc(full, 'resources/read', { uri: `absentra://company/${cidA}/employees` })
    const data = JSON.parse(r.body.result.contents[0].text)
    expect(data.some((e: any) => e.name === 'Andi')).toBe(true)
  })
  it('tools/list hanya menampilkan tool sesuai scope (least-privilege)', async () => {
    const ro = (await rpc(readOnly, 'tools/list')).body.result.tools.map((t: any) => t.name)
    expect(ro).toContain('employee.list')
    expect(ro).not.toContain('division.create') // butuh org:write
    const fl = (await rpc(full, 'tools/list')).body.result.tools.map((t: any) => t.name)
    expect(fl).toEqual(expect.arrayContaining(['division.create', 'employee.create', 'wage.set', 'payroll.recap', 'policy.set', 'leave.decide']))
  })
  it('tools/list exposes real JSON Schema (bukan object kosong)', async () => {
    const tools = (await rpc(full, 'tools/list')).body.result.tools
    const wage = tools.find((t: any) => t.name === 'wage.set')
    expect(wage.inputSchema.type).toBe('object')
    expect(wage.inputSchema.properties.employeeRef).toMatchObject({ type: 'string' })
    expect(wage.inputSchema.properties.confirm).toBeTruthy()
    expect(tools.some((t: any) => t.name === 'dashboard.summary')).toBe(true)
    expect(tools.some((t: any) => t.name === 'attendance.list')).toBe(true)
    expect(tools.some((t: any) => t.name === 'report.employee')).toBe(true)
  })
  it('tools/call wraps result dengan content[] MCP + field asli', async () => {
    const r = await rpc(full, 'tools/call', { name: 'company.get', arguments: {} })
    expect(r.body.result.content[0].type).toBe('text')
    expect(r.body.result.company).toBeTruthy()
  })
  it('write tanpa scope → forbidden_scope (-32001)', async () => {
    const r = await rpc(readOnly, 'tools/call', { name: 'division.create', arguments: { name: 'X', confirm: true } })
    expect(r.body.error.code).toBe(-32001)
  })
  it('division.create: tanpa confirm → needs_confirmation; dgn confirm → dibuat + audit', async () => {
    const pre = await rpc(full, 'tools/call', { name: 'division.create', arguments: { name: 'Gudang' } })
    expect(pre.body.result.status).toBe('needs_confirmation')
    const post = await rpc(full, 'tools/call', { name: 'division.create', arguments: { name: 'Gudang', confirm: true } })
    expect(post.body.result.status).toBe('created')
    expect((await owner.get('/api/divisions')).body.some((d: any) => d.name === 'Gudang')).toBe(true)
    expect((await owner.get('/api/audit?actorType=agent')).body.some((x: any) => x.action === 'mcp.division.create')).toBe(true)
  })
  it('employee.create via MCP (branchRef nama) → muncul di roster', async () => {
    const r = await rpc(full, 'tools/call', { name: 'employee.create', arguments: { name: 'Citra MCP', email: 'citra.mcp@m.test', branchRef: 'Pusat', confirm: true } })
    expect(r.body.result.status).toBe('created')
    expect((await owner.get('/api/employees?q=Citra')).body.some((e: any) => e.name === 'Citra MCP')).toBe(true)
  })
  it('employee.create branchRef ambigu → needs_clarification (elicitation)', async () => {
    await owner.post('/api/branches').send({ name: 'Cabang Timur', lat: -6.2, long: 106.9, radiusM: 100 })
    await owner.post('/api/branches').send({ name: 'Cabang Barat', lat: -6.2, long: 106.7, radiusM: 100 })
    const r = await rpc(full, 'tools/call', { name: 'employee.create', arguments: { name: 'Dst', email: 'dst@m.test', branchRef: 'Cabang', confirm: true } })
    expect(r.body.result.status).toBe('needs_clarification'); expect(r.body.result.candidates.length).toBe(2)
  })
  it('wage.set via MCP → tersimpan + audit mcp.wage.set', async () => {
    const r = await rpc(full, 'tools/call', { name: 'wage.set', arguments: { employeeRef: 'Andi', wageBasic: 5_000_000, confirm: true } })
    expect(r.body.result.status).toBe('updated')
    expect((await owner.get('/api/audit?actorType=agent')).body.some((x: any) => x.action === 'mcp.wage.set')).toBe(true)
  })
  it('payroll.recap (PP 35/2021) mengembalikan baris rekap', async () => {
    const r = await rpc(full, 'tools/call', { name: 'payroll.recap', arguments: { periodStart: addDays(TODAY, -7), periodEnd: TODAY } })
    expect(Array.isArray(r.body.result.rows)).toBe(true)
    expect(r.body.result.rows.some((row: any) => row.name === 'Andi')).toBe(true)
  })
  it('leave.decide via MCP: list_pending → approve dgn confirm', async () => {
    const lv = (await andi.post('/api/leaves').send({ type: 'izin', dateStart: addDays(TODAY, 200), dateEnd: addDays(TODAY, 200) })).body
    const pending = await rpc(full, 'tools/call', { name: 'request.list_pending', arguments: {} })
    expect(pending.body.result.leaves.some((l: any) => l.id === lv.id)).toBe(true)
    const dec = await rpc(full, 'tools/call', { name: 'leave.decide', arguments: { requestId: lv.id, decision: 'approved', confirm: true } })
    expect(dec.body.result.status).toBe('approved')
    expect((await owner.get('/api/leaves')).body.find((l: any) => l.id === lv.id).status).toBe('approved')
  })
  it('policy.set via MCP → resources/read mencerminkan perubahan', async () => {
    await rpc(full, 'tools/call', { name: 'policy.set', arguments: { strictGeofence: true, confirm: true } })
    const pol = await rpc(full, 'resources/read', { uri: `absentra://company/${cidA}/policy` })
    expect(JSON.parse(pol.body.result.contents[0].text).strict_geofence).toBe(1)
    await rpc(full, 'tools/call', { name: 'policy.set', arguments: { strictGeofence: false, confirm: true } })
  })
  it('isolasi tenant: token tenant B tak bisa employee.list tenant A (scope juga dibatasi)', async () => {
    // connBToken hanya punya attendance:read → employee.list (employee:read) ditolak scope
    const r = await rpc(connBToken, 'tools/call', { name: 'employee.list', arguments: {} })
    expect(r.body.error.code).toBe(-32001)
  })
})

// ---------------- MCP tool tambahan: koreksi absensi, profil perusahaan, ekspor ----------------
describe('MCP tool tambahan (koreksi, profil, ekspor)', () => {
  const ALL = ['attendance:read', 'attendance:write', 'shift:read', 'shift:write', 'employee:read', 'employee:write', 'org:read', 'org:write', 'policy:read', 'policy:write', 'request:read', 'request:write', 'payroll:read', 'audit:read']
  let tok: string, recId: string
  beforeAll(async () => {
    tok = (await owner.post('/api/mcp/connections').send({ agentName: 'Ops-full', scopes: ALL })).body.accessToken
    // skenario absensi mandiri agar ada rekam untuk dikoreksi
    const e = agent(); await signin(e, 'koreksi@m.test')
    const inv = (await owner.post('/api/invites').send({ branchId: branchA1, role: 'employee' })).body
    await e.post(`/api/invites/token/${inv.token}/accept`).send({ consentLocation: true, consentPhoto: true })
    const eid = (await e.get('/api/auth/me')).body.employeeId
    await owner.post('/api/shift-assignments').send({ employeeIds: [eid], shiftTemplateId: shiftPagi, dateStart: TODAY, skipSundays: false })
    await e.post('/api/attendance/clock').send({ kind: 'in', lat: -6.2, long: 106.8166, gpsAccuracyM: 15, livenessPassed: true, cameraAvailable: true, geofenceResult: 'inside', idempotencyKey: 'koreksi-in-1' })
    recId = (await owner.get('/api/attendance/list').query({ from: TODAY, to: TODAY })).body.find((r: any) => r.employeeId === eid).id
  })

  it('company.update via MCP → profil berubah (dgn konfirmasi) + audit', async () => {
    const pre = await rpc(tok, 'tools/call', { name: 'company.update', arguments: { businessType: 'Kuliner & Katering' } })
    expect(pre.body.result.status).toBe('needs_confirmation')
    const r = await rpc(tok, 'tools/call', { name: 'company.update', arguments: { businessType: 'Kuliner & Katering', confirm: true } })
    expect(r.body.result.status).toBe('updated')
    expect((await owner.get('/api/company')).body.businessType).toBe('Kuliner & Katering')
    expect((await owner.get('/api/audit?actorType=agent')).body.some((x: any) => x.action === 'mcp.company.update')).toBe(true)
  })

  it('attendance.correct via MCP → status terkoreksi + audit', async () => {
    const pre = await rpc(tok, 'tools/call', { name: 'attendance.correct', arguments: { recordId: recId, status: 'late', lateMinutes: 5, reason: 'verifikasi manual' } })
    expect(pre.body.result.status).toBe('needs_confirmation')
    const r = await rpc(tok, 'tools/call', { name: 'attendance.correct', arguments: { recordId: recId, status: 'late', lateMinutes: 5, resolveFlag: true, reason: 'verifikasi manual', confirm: true } })
    expect(r.body.result.status).toBe('corrected')
    expect((await owner.get('/api/audit?actorType=agent')).body.some((x: any) => x.action === 'mcp.attendance.correct')).toBe(true)
  })
  it('attendance.correct rekam tak ada → not_found', async () => {
    const r = await rpc(tok, 'tools/call', { name: 'attendance.correct', arguments: { recordId: 'att_tidakada', reason: 'x', confirm: true } })
    expect(r.body.result.status).toBe('not_found')
  })

  it('attendance.export → CSV dengan header benar', async () => {
    const r = await rpc(tok, 'tools/call', { name: 'attendance.export', arguments: { from: addDays(TODAY, -7), to: TODAY } })
    expect(r.body.result.mimeType).toBe('text/csv')
    expect(r.body.result.csv.split('\n')[0]).toBe('Nama,Cabang,Tanggal,Masuk,Keluar,Status,Telat(menit),Trust,PulangCepat')
    expect(r.body.result.filename).toContain('.csv')
  })
  it('payroll.export → CSV rekap PP 35/2021', async () => {
    const r = await rpc(tok, 'tools/call', { name: 'payroll.export', arguments: { periodStart: addDays(TODAY, -7), periodEnd: TODAY } })
    expect(r.body.result.csv.split('\n')[0]).toContain('Upah/jam')
    expect(r.body.result.rowCount).toBeGreaterThanOrEqual(1)
  })
  it('ekspor butuh scope yang sesuai (payroll:read) — koneksi read-only attendance ditolak', async () => {
    const ro = (await owner.post('/api/mcp/connections').send({ agentName: 'OnlyAtt', scopes: ['attendance:read'] })).body.accessToken
    expect((await rpc(ro, 'tools/call', { name: 'payroll.export', arguments: { periodStart: TODAY, periodEnd: TODAY } })).body.error.code).toBe(-32001)
    // tapi attendance.export (scope attendance:read) boleh
    expect((await rpc(ro, 'tools/call', { name: 'attendance.export', arguments: { from: TODAY, to: TODAY } })).body.result.mimeType).toBe('text/csv')
  })
})
