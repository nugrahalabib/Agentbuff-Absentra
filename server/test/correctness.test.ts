/**
 * Correctness regressions (fix list 19–26): invite sign-in path, overnight
 * shifts, double clock-in/out + idempotency scope, offline submissions, PP
 * 35/2021 payroll inputs, bulk assign, leave balance, tenant deletion.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import request from 'supertest'
import type { Express } from 'express'

let app: Express
let db: any
const agent = () => request.agent(app)
const PW = (email: string) => `Rahasia-${email}`
const signin = (a: any, email: string, name = email.split('@')[0]) => a.post('/api/auth/signin').send({ email, name, register: true, password: PW(email) })
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())
const addDays = (iso: string, d: number) => { const [y, m, dd] = iso.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1, dd)); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10) }
const dow = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay() }
const clockBody = (kind: 'in' | 'out', key: string, extra: Record<string, unknown> = {}) => ({ kind, lat: -6.2, long: 106.8166, gpsAccuracyM: 15, livenessPassed: null, cameraAvailable: false, idempotencyKey: key, ...extra })

let owner: any, ownerB: any
let cidA: string, branchA1: string, branchB1: string, malam: string, pagi: string

/** Invite + accept with location consent → a ready-to-clock employee. */
async function newEmployee(email: string, ownerAgent = owner, branchId = branchA1) {
  const inv = (await ownerAgent.post('/api/invites').send({ branchId })).body
  const a = agent(); await signin(a, email)
  await a.post(`/api/invites/token/${inv.token}/accept`).send({ consentLocation: true })
  const eid = (await a.get('/api/auth/me')).body.employeeId as string
  return { a, eid }
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'absentra-cor-'))
  process.env.ABSENTRA_DB = join(dir, 'test.db')
  process.env.PASSWORD_AUTH_ALLOWLIST = '*'
  process.env.ABSENTRA_RATE_LIMIT_DISABLED = '1'
  app = (await import('../src/app.js')).createApp()
  db = (await import('../src/lib/db.js')).db
  owner = agent(); await signin(owner, 'owner@c.test')
  cidA = (await owner.post('/api/companies').send({ displayName: 'Kedai Benar', businessType: 'Kuliner', timezone: 'Asia/Jakarta', workweekType: 'six_day' })).body.activeCompanyId
  branchA1 = (await owner.post('/api/branches').send({ name: 'Pusat', lat: -6.2, long: 106.8166, radiusM: 300 })).body.id
  malam = (await owner.post('/api/shift-templates').send({ name: 'Malam', startTime: '22:00', endTime: '06:00', crossesMidnight: true })).body.id
  pagi = (await owner.post('/api/shift-templates').send({ name: 'Pagi', startTime: '08:00', endTime: '17:00' })).body.id
  ownerB = agent(); await signin(ownerB, 'owner@cb.test')
  await ownerB.post('/api/companies').send({ displayName: 'Kedai Lain', businessType: 'Kuliner', timezone: 'Asia/Jakarta', workweekType: 'six_day' })
  branchB1 = (await ownerB.post('/api/branches').send({ name: 'B', lat: -6.2, long: 106.8166, radiusM: 300 })).body.id

}, 120_000) // many scrypt sign-ins; generous under a loaded CI box

// ---------------------------------------------------------------- 19
describe('#19 Invite link lets new staff through the owner gate', () => {
  it('a valid /invite/<token> next path is recognised; junk/expired is not', async () => {
    const { nextIsValidInvite } = await import('../src/routes/auth.js')
    const inv = (await owner.post('/api/invites').send({ branchId: branchA1 })).body
    expect(nextIsValidInvite(`/invite/${inv.token}`)).toBe(true)
    expect(nextIsValidInvite('/invite/doesnotexist123')).toBe(false)
    expect(nextIsValidInvite('/settings')).toBe(false)
    expect(nextIsValidInvite(null)).toBe(false)
    const dead = (await owner.post('/api/invites').send({ branchId: branchA1, expiresInDays: 0 })).body
    expect(nextIsValidInvite(`/invite/${dead.token}`)).toBe(false)
  })
})

// ---------------------------------------------------------------- 20
describe('#20 Overnight shift: clock-out after midnight closes the open record', () => {
  it('uses the open record of the shift start date; context says "out"', async () => {
    const { a, eid } = await newEmployee('malam@c.test')
    const yesterday = addDays(TODAY, -1)
    const sa = `sa_night_${eid}`
    db.prepare(`INSERT INTO shift_assignment (id, company_id, employee_id, shift_template_id, work_date, status) VALUES (?,?,?,?,?, 'scheduled')`).run(sa, cidA, eid, malam, yesterday)
    const clockIn = new Date(Date.now() - 5 * 3600_000).toISOString()
    db.prepare(`INSERT INTO attendance_record (id, company_id, employee_id, branch_id, work_date, shift_assignment_id, status, late_minutes, trust_score, clock_in_at, created_at) VALUES (?,?,?,?,?,?, 'on_time', 0, 100, ?, ?)`)
      .run(`att_night_${eid}`, cidA, eid, branchA1, yesterday, sa, clockIn, clockIn)
    const ctx = (await a.get('/api/attendance/today-context')).body
    expect(ctx.kind).toBe('out'); expect(ctx.record.workDate).toBe(yesterday)
    const r = await a.post('/api/attendance/clock').send(clockBody('out', 'night-out-1'))
    expect(r.status).toBe(200)
    expect(r.body.record.id).toBe(`att_night_${eid}`)
    const rec = db.prepare('SELECT * FROM attendance_record WHERE id=?').get(`att_night_${eid}`) as any
    expect(rec.clock_out_at).toBeTruthy()
    expect(db.prepare('SELECT COUNT(*) n FROM attendance_record WHERE employee_id=?').get(eid).n).toBe(1) // no orphan
  })
  it('clock-out with nothing open → 409 no_open_clock_in, and no orphan record', async () => {
    const { a, eid } = await newEmployee('orphan@c.test')
    const r = await a.post('/api/attendance/clock').send(clockBody('out', 'orphan-out-1'))
    expect(r.status).toBe(409); expect(r.body.error).toBe('no_open_clock_in')
    expect(db.prepare('SELECT COUNT(*) n FROM attendance_record WHERE employee_id=?').get(eid).n).toBe(0)
  })
})

// ---------------------------------------------------------------- 21
describe('#21 Double clock-in/out + idempotency scope', () => {
  it('second in → 409, same key → original result, second out → 409', async () => {
    const { a } = await newEmployee('dobel@c.test')
    const first = await a.post('/api/attendance/clock').send(clockBody('in', 'dobel-in-1'))
    expect(first.status).toBe(200)
    const again = await a.post('/api/attendance/clock').send(clockBody('in', 'dobel-in-2'))
    expect(again.status).toBe(409); expect(again.body.error).toBe('already_clocked_in')
    const retry = await a.post('/api/attendance/clock').send(clockBody('in', 'dobel-in-1'))
    expect(retry.status).toBe(200); expect(retry.body.duplicate).toBe(true)
    expect(retry.body.trustScore).toBe(first.body.trustScore); expect(retry.body.reasons).toEqual(first.body.reasons)
    expect((await a.post('/api/attendance/clock').send(clockBody('out', 'dobel-out-1'))).status).toBe(200)
    const out2 = await a.post('/api/attendance/clock').send(clockBody('out', 'dobel-out-2'))
    expect(out2.status).toBe(409); expect(out2.body.error).toBe('already_clocked_out')
  })
  it('the same idempotency key in another tenant is a different event', async () => {
    const { a } = await newEmployee('tenantb@c.test', ownerB, branchB1)
    const r = await a.post('/api/attendance/clock').send(clockBody('in', 'dobel-in-1'))
    expect(r.status).toBe(200); expect(r.body.duplicate).toBeUndefined()
  })
})

// ---------------------------------------------------------------- 22
describe('#22 Offline submissions', () => {
  it('stale (>72 h) or future events are refused; a recent one keeps its real time + reason', async () => {
    const { a } = await newEmployee('offline@c.test')
    const stale = await a.post('/api/attendance/clock').send(clockBody('in', 'off-stale', { submittedOffline: true, eventTimeClient: new Date(Date.now() - 4 * 864e5).toISOString() }))
    expect(stale.status).toBe(400); expect(stale.body.error).toBe('stale_offline_event')
    const future = await a.post('/api/attendance/clock').send(clockBody('in', 'off-future', { submittedOffline: true, eventTimeClient: new Date(Date.now() + 3600_000).toISOString() }))
    expect(future.body.error).toBe('stale_offline_event')
    expect((await a.post('/api/attendance/clock').send(clockBody('in', 'off-missing', { submittedOffline: true }))).body.error).toBe('stale_offline_event')
    const when = new Date(Date.now() - 30 * 60_000)
    const ok = await a.post('/api/attendance/clock').send(clockBody('in', 'off-ok-recent', { submittedOffline: true, eventTimeClient: when.toISOString() }))
    expect(ok.status).toBe(200)
    expect(ok.body.reasons).toContain('Dikirim belakangan (sinyal hilang)')
    const rec = db.prepare('SELECT clock_in_at FROM attendance_record WHERE id=?').get(ok.body.record.id) as any
    expect(rec.clock_in_at).toBe(when.toISOString())
    const evt = db.prepare('SELECT submitted_offline, event_time_server, event_time_client FROM attendance_event WHERE attendance_record_id=?').get(ok.body.record.id) as any
    expect(evt.submitted_offline).toBe(1); expect(evt.event_time_client).toBe(when.toISOString()); expect(evt.event_time_server > evt.event_time_client).toBe(true)
  })
})

// ---------------------------------------------------------------- 23
describe('#23 Payroll inputs (PP 35/2021)', () => {
  let a: any, eid: string
  const pay = async (from: string, to: string) => (await owner.post('/api/reports/payroll').send({ periodStart: from, periodEnd: to })).body.find((r: any) => r.employeeId === eid)
  beforeAll(async () => {
    ({ a, eid } = await newEmployee('gaji@c.test'))
    await owner.patch(`/api/employees/${eid}`).send({ wageBasic: 4_000_000, wageFixedAllowance: 0 })
  })
  it('(a) overtime tiers per work day: 1h + 1h on one date = Rp80.924 (verified 2h example)', async () => {
    const d = addDays(TODAY, -10)
    for (const _ of [1, 2]) {
      const ot = (await a.post('/api/overtimes').send({ workDate: d, hours: 1, dayType: 'workday' })).body
      expect((await owner.post(`/api/overtimes/${ot.id}/decision`).send({ status: 'approved' })).status).toBe(200)
    }
    const row = await pay(d, d)
    expect(row.overtimeHoursTotal).toBe(2); expect(row.overtimePayTotal).toBe(80_924)
  })
  it('(b) a manual request supersedes the auto draft; the draft can never also be paid', async () => {
    const d = addDays(TODAY, -12)
    db.prepare(`INSERT INTO overtime_request (id, company_id, employee_id, work_date, hours, day_type, status, is_draft, created_at) VALUES ('ot_draft_c', ?, ?, ?, 1.5, 'workday', 'pending', 1, ?)`).run(cidA, eid, d, new Date().toISOString())
    const manual = (await a.post('/api/overtimes').send({ workDate: d, hours: 2, dayType: 'workday' })).body
    expect((db.prepare('SELECT status FROM overtime_request WHERE id=?').get('ot_draft_c') as any).status).toBe('rejected')
    await owner.post(`/api/overtimes/${manual.id}/decision`).send({ status: 'approved' })
    const dupe = await owner.post('/api/overtimes/ot_draft_c/decision').send({ status: 'approved' })
    expect(dupe.status).toBe(409); expect(dupe.body.error).toBe('overtime_duplicate_date')
    expect((await pay(d, d)).overtimeHoursTotal).toBe(2)
    const listed = (await owner.get('/api/overtimes')).body.find((o: any) => o.id === 'ot_draft_c')
    expect(listed.isDraft).toBe(true)
  })
  it('(c) records marked absent are not present days and earn no meal allowance', async () => {
    await owner.put('/api/policy').send({ lateDeductionMode: 'per_minute', lateDeductionConfig: { perMinuteRate: 0 }, mealAllowanceConfig: { perPresentDay: 10_000 }, strictGeofence: false, trustThresholds: { accept: 80, review: 60 }, photoRetentionDays: 90 })
    const d1 = addDays(TODAY, -20), d2 = addDays(TODAY, -19)
    for (const [d, status] of [[d1, 'on_time'], [d2, 'absent']]) {
      db.prepare(`INSERT INTO attendance_record (id, company_id, employee_id, branch_id, work_date, status, late_minutes, trust_score, clock_in_at, created_at) VALUES (?,?,?,?,?,?,0,100,?,?)`)
        .run(`att_c_${d}`, cidA, eid, branchA1, d, status, `${d}T01:00:00.000Z`, `${d}T01:00:00.000Z`)
    }
    const row = await pay(d1, d2)
    expect(row.presentDays).toBe(1); expect(row.mealAllowance).toBe(10_000); expect(row.absentDays).toBe(1)
  })
  it('(d) correcting to on_time without lateMinutes clears the lateness', async () => {
    const d = addDays(TODAY, -21)
    db.prepare(`INSERT INTO attendance_record (id, company_id, employee_id, branch_id, work_date, status, late_minutes, trust_score, clock_in_at, created_at) VALUES ('att_late_c', ?, ?, ?, ?, 'late', 45, 100, ?, ?)`)
      .run(cidA, eid, branchA1, d, `${d}T02:00:00.000Z`, `${d}T02:00:00.000Z`)
    const r = await owner.post('/api/attendance/att_late_c/correct').send({ status: 'on_time', reason: 'izin datang telat disetujui' })
    expect(r.status).toBe(200); expect(r.body.lateMinutes).toBe(0)
  })
  it('(e) future scheduled days are never counted as absent', async () => {
    const from = addDays(TODAY, 2), to = addDays(TODAY, 4)
    await owner.post('/api/shift-assignments').send({ employeeIds: [eid], shiftTemplateId: pagi, dateStart: from, dateEnd: to })
    expect((await pay(from, to)).absentDays).toBe(0)
    const past = addDays(TODAY, -30)
    await owner.post('/api/shift-assignments').send({ employeeIds: [eid], shiftTemplateId: pagi, dateStart: past })
    expect((await pay(past, past)).absentDays).toBe(1)
  })
  it('(f) tiered late deduction without tiers is refused', async () => {
    const r = await owner.put('/api/policy').send({ lateDeductionMode: 'tiered', lateDeductionConfig: {}, mealAllowanceConfig: {}, strictGeofence: false, trustThresholds: { accept: 80, review: 60 }, photoRetentionDays: 90 })
    expect(r.status).toBe(400); expect(r.body.error).toBe('tiers_required')
  })
  it('(g) variable allowance never lowers the basis below basic + fixed', async () => {
    await owner.patch(`/api/employees/${eid}`).send({ wageBasic: 3_000_000, wageFixedAllowance: 500_000, wageVariableAllowance: 500_000 })
    expect((await pay(TODAY, TODAY)).hourlyWage).toBe(Math.round(3_500_000 / 173))
    await owner.patch(`/api/employees/${eid}`).send({ wageBasic: 4_000_000, wageFixedAllowance: 0, wageVariableAllowance: 0 })
  })
})

// ---------------------------------------------------------------- 24
describe('#24 Bulk assign', () => {
  it('Sundays are included unless skipSundays is sent; conflicts come back with reasons', async () => {
    const { eid } = await newEmployee('bulk@c.test')
    let sunday = addDays(TODAY, 60)
    while (dow(sunday) !== 0) sunday = addDays(sunday, 1)
    expect((await owner.post('/api/shift-assignments').send({ employeeIds: [eid], shiftTemplateId: pagi, dateStart: sunday })).body.created).toBe(1)
    const next = addDays(sunday, 7)
    expect((await owner.post('/api/shift-assignments').send({ employeeIds: [eid], shiftTemplateId: pagi, dateStart: next, skipSundays: true })).body.created).toBe(0)
    const siang = (await owner.post('/api/shift-templates').send({ name: 'Siang', startTime: '12:00', endTime: '20:00' })).body.id
    const r = (await owner.post('/api/shift-assignments').send({ employeeIds: [eid], shiftTemplateId: siang, dateStart: sunday })).body
    expect(r.created).toBe(0); expect(r.conflicts).toBe(1)
    expect(r.conflictDetails[0]).toMatchObject({ employeeId: eid, date: sunday, reason: 'overlap' })
    // Malam (22:00→06:00) the evening before a 08:00 shift is fine; ending after 08:00 next day would not be.
    expect((await owner.post('/api/shift-assignments').send({ employeeIds: [eid], shiftTemplateId: malam, dateStart: addDays(sunday, -1) })).body.created).toBe(1)
  })
  it('employees of another tenant cannot be scheduled', async () => {
    const { eid } = await newEmployee('foreign@c.test', ownerB, branchB1)
    expect((await owner.post('/api/shift-assignments').send({ employeeIds: [eid], shiftTemplateId: pagi, dateStart: TODAY })).status).toBe(404)
  })
})

// ---------------------------------------------------------------- 25
describe('#25 Leave balance', () => {
  it('counts working days only (six-day week) and never consumes balance for tanpa_bayar', async () => {
    const { a } = await newEmployee('cuti@c.test')
    const year = Number(TODAY.slice(0, 4)) + 1
    expect((await a.post('/api/leaves').send({ type: 'tanpa_bayar', dateStart: `${year}-04-01`, dateEnd: `${year}-04-20` })).status).toBe(200)
    // Find a Monday in March so 14 calendar days contain exactly 2 Sundays = 12 working days.
    let mon = `${year}-03-01`
    while (dow(mon) !== 1) mon = addDays(mon, 1)
    expect((await a.post('/api/leaves').send({ type: 'tahunan', dateStart: mon, dateEnd: addDays(mon, 13) })).status).toBe(200)
    const more = await a.post('/api/leaves').send({ type: 'tahunan', dateStart: `${year}-05-04`, dateEnd: `${year}-05-04` })
    expect(dow(`${year}-05-04`) === 0 ? 200 : 409).toBe(more.status)
  })
})

// ---------------------------------------------------------------- 26
describe('#26 Tenant deletion', () => {
  it('requires the exact company name and never touches other tenants\' audit rows', async () => {
    const before = db.prepare('SELECT COUNT(*) n FROM audit_log WHERE company_id=?').get(cidA).n
    const t = agent(); await signin(t, 'hapus@c.test')
    const cid = (await t.post('/api/companies').send({ displayName: 'Akan Dihapus', businessType: 'X', timezone: 'Asia/Jakarta', workweekType: 'six_day' })).body.activeCompanyId
    expect((await t.delete('/api/company').send({ confirmName: 'akan dihapus' })).body.error).toBe('confirm_name_mismatch')
    expect((await t.delete('/api/company').send({ confirmName: 'Akan Dihapus' })).status).toBe(200)
    expect(db.prepare('SELECT COUNT(*) n FROM company WHERE id=?').get(cid).n).toBe(0)
    expect(db.prepare('SELECT COUNT(*) n FROM audit_log WHERE company_id=?').get(cidA).n).toBe(before)
  })
})
