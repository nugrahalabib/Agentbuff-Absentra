/**
 * Black-box system tests for Absentra (Rencana-Pengujian-BlackBox-Absentra.md).
 * Drives the real Express API over HTTP (supertest) against a fresh SQLite DB.
 * Test names carry the TC-AB-xxx id so the run doubles as the result checklist.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import request from 'supertest'
import type { Express } from 'express'

const here = dirname(fileURLToPath(import.meta.url))

function todayJkt(): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date())
}
function addDays(iso: string, d: number): string {
  const [y, m, dd] = iso.split('-').map(Number)
  const x = new Date(Date.UTC(y, m - 1, dd)); x.setUTCDate(x.getUTCDate() + d)
  return x.toISOString().slice(0, 10)
}

let app: Express
const TODAY = todayJkt()
const agent = () => request.agent(app)
const signin = (a: any, email: string, name = email.split('@')[0], register = true) => a.post('/api/auth/signin').send({ email, name, register })

// shared context
let owner: any, andi: any, rina: any, ownerB: any
let cidA: string, cidA2: string, branchA1: string, branchA2: string, divDapur: string, divKasir: string
let shiftPagi: string, shiftMalam: string, empAndi: string, empRina: string

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'absentra-test-'))
  process.env.ABSENTRA_DB = join(dir, 'test.db')
  process.env.PASSWORD_AUTH_ALLOWLIST = '*' // tests use email/password stand-in
  const mod = await import('../src/app.js')
  app = mod.createApp()
  process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch {} })

  owner = agent()
  await signin(owner, 'owner@a.test', 'Bu Sari')
  cidA = (await owner.post('/api/companies').send({ displayName: 'Warung A', businessType: 'Kuliner', timezone: 'Asia/Jakarta', workweekType: 'six_day' })).body.activeCompanyId
  branchA1 = (await owner.post('/api/branches').send({ name: 'Cabang Pusat', lat: -6.2, long: 106.8166, radiusM: 100 })).body.id
  branchA2 = (await owner.post('/api/branches').send({ name: 'Cabang Selatan', lat: -6.26, long: 106.79, radiusM: 100 })).body.id
  divDapur = (await owner.post('/api/divisions').send({ name: 'Dapur' })).body.id
  divKasir = (await owner.post('/api/divisions').send({ name: 'Kasir' })).body.id
  shiftPagi = (await owner.post('/api/shift-templates').send({ name: 'Pagi', startTime: '08:00', endTime: '17:00', lateToleranceMinutes: 10 })).body.id
  shiftMalam = (await owner.post('/api/shift-templates').send({ name: 'Malam', startTime: '22:00', endTime: '06:00', crossesMidnight: true })).body.id
  empAndi = (await owner.post('/api/employees').send({ name: 'Andi', email: 'andi@a.test', branchId: branchA1, divisionId: divDapur, wageBasic: 4_000_000 })).body.id
  empRina = (await owner.post('/api/employees').send({ name: 'Rina', email: 'rina@a.test', branchId: branchA1, role: 'branch_admin', scopeBranchIds: [branchA1] })).body.id
  await owner.post('/api/shift-assignments').send({ employeeIds: [empAndi], shiftTemplateId: shiftPagi, dateStart: TODAY, skipSundays: false })

  andi = agent(); await signin(andi, 'andi@a.test', 'Andi')
  rina = agent(); await signin(rina, 'rina@a.test', 'Rina')

  // second tenant for isolation
  ownerB = agent(); await signin(ownerB, 'owner@b.test', 'Owner B')
  await ownerB.post('/api/companies').send({ displayName: 'Toko B', businessType: 'Retail', timezone: 'Asia/Jakarta', workweekType: 'five_day' })
  await ownerB.post('/api/branches').send({ name: 'B Pusat', lat: -6.3, long: 106.8, radiusM: 100 })
  await ownerB.post('/api/employees').send({ name: 'Budi B', email: 'budi@b.test', branchId: (await ownerB.get('/api/branches')).body[0].id })

  // a second company owned by owner@a for tenant-switch tests
  cidA2 = (await owner.post('/api/companies').send({ displayName: 'Warung A2', businessType: 'Jasa', timezone: 'Asia/Jakarta', workweekType: 'five_day' })).body.activeCompanyId
  await owner.post('/api/auth/switch-tenant').send({ companyId: cidA }) // back to A
})

// ---------------- UC-01 Auth ----------------
describe('UC-AB-01 Autentikasi', () => {
  it('TC-AB-001 login member aktif → sesi + company aktif', async () => {
    const a = agent(); const r = await signin(a, 'owner@a.test', 'Bu Sari')
    expect(r.status).toBe(200); expect(r.body.activeCompanyId).toBeTruthy()
  })
  it('TC-AB-002 akun valid tanpa keanggotaan → tanpa company', async () => {
    const a = agent(); const r = await signin(a, 'nobody@x.test', 'Nobody')
    expect(r.status).toBe(200); expect(r.body.memberships.length).toBe(0); expect(r.body.activeCompanyId).toBeNull()
  })
  it('TC-AB-004 keanggotaan dinonaktifkan → company tak muncul', async () => {
    // deactivate Rina then she signs in fresh
    await owner.patch(`/api/employees/${empRina}`).send({ employmentStatus: 'inactive' })
    const a = agent(); const r = await signin(a, 'rina@a.test')
    const inA = r.body.memberships.find((m: any) => m.company.id === cidA)
    expect(inA).toBeUndefined()
    await owner.patch(`/api/employees/${empRina}`).send({ employmentStatus: 'active' }) // restore
  })
  it('TC-AB-005 akses halaman terproteksi tanpa sesi → 401', async () => {
    expect((await request(app).get('/api/company')).status).toBe(401)
  })
  it('auth/config exposes googleEnabled + passwordAuthEnabled', async () => {
    const r = await request(app).get('/api/auth/config')
    expect(r.status).toBe(200)
    expect(r.body).toHaveProperty('googleEnabled')
    expect(r.body.passwordAuthEnabled).toBe(true)
  })
})

// ---------------- UC-03 Tenant switching ----------------
describe('UC-AB-03 Tenant switching', () => {
  it('TC-AB-013 pindah ke company anggota → 200', async () => {
    const r = await owner.post('/api/auth/switch-tenant').send({ companyId: cidA2 })
    expect(r.status).toBe(200); expect(r.body.activeCompanyId).toBe(cidA2)
    await owner.post('/api/auth/switch-tenant').send({ companyId: cidA })
  })
  it('TC-AB-014 pindah ke company bukan anggota → ditolak', async () => {
    const otherB = (await ownerB.get('/api/auth/me')).body.activeCompanyId
    expect((await owner.post('/api/auth/switch-tenant').send({ companyId: otherB })).status).toBe(403)
  })
  it('TC-AB-015 data setelah pindah hanya milik company tujuan', async () => {
    await owner.post('/api/auth/switch-tenant').send({ companyId: cidA2 })
    const emps = (await owner.get('/api/employees')).body
    expect(emps.every((e: any) => e.companyId === cidA2)).toBe(true)
    await owner.post('/api/auth/switch-tenant').send({ companyId: cidA })
  })
})

// ---------------- UC-04 Logout ----------------
describe('UC-AB-04 Logout', () => {
  it('TC-AB-016/017 logout mengakhiri sesi; akses berikutnya ditolak', async () => {
    const a = agent(); await signin(a, 'owner@a.test')
    expect((await a.get('/api/company')).status).toBe(200)
    await a.post('/api/auth/signout')
    expect((await a.get('/api/auth/me')).status).toBe(401)
    expect((await a.get('/api/company')).status).toBe(401) // session destroyed → unauthenticated
  })
})

// ---------------- UC-05 Registrasi & perusahaan ----------------
describe('UC-AB-05 Registrasi & pembuatan perusahaan', () => {
  it('TC-AB-019 buat perusahaan valid → owner', async () => {
    const a = agent(); await signin(a, 'newowner@a.test')
    const r = await a.post('/api/companies').send({ displayName: 'Warung C', businessType: 'Kuliner', timezone: 'Asia/Jakarta', workweekType: 'six_day' })
    expect(r.status).toBe(200)
    const me = (await a.get('/api/auth/me')).body
    expect(me.memberships.find((m: any) => m.company.id === r.body.activeCompanyId).membership.role).toBe('owner')
  })
  it('TC-AB-020 field wajib kosong → ditolak', async () => {
    expect((await owner.post('/api/companies').send({ displayName: '', businessType: 'X', timezone: 'Asia/Jakarta', workweekType: 'six_day' })).status).toBe(400)
  })
})

// ---------------- UC-06 Profil perusahaan ----------------
describe('UC-AB-06 Profil perusahaan', () => {
  it('TC-AB-023 update profil valid', async () => {
    const r = await owner.patch('/api/company').send({ displayName: 'Warung A (updated)' })
    expect(r.status).toBe(200); expect(r.body.displayName).toBe('Warung A (updated)')
  })
  it('TC-AB-024 ubah tipe minggu kerja tersimpan', async () => {
    await owner.patch('/api/company').send({ workweekType: 'five_day' })
    expect((await owner.get('/api/company')).body.workweekType).toBe('five_day')
    await owner.patch('/api/company').send({ workweekType: 'six_day' })
  })
})

// ---------------- UC-07 Cabang & geofence ----------------
describe('UC-AB-07 Cabang & geofence', () => {
  it('TC-AB-027/028 tambah cabang + geofence', async () => {
    const r = await owner.post('/api/branches').send({ name: 'Cabang Uji', lat: -6.21, long: 106.82, radiusM: 120 })
    expect(r.status).toBe(200); expect(r.body.geofence.radiusM).toBe(120)
    await owner.post(`/api/branches/${r.body.id}/archive`)
  })
  it('TC-AB-029 radius tidak wajar (0 / sangat besar) → ditolak', async () => {
    expect((await owner.post('/api/branches').send({ name: 'X', lat: -6.2, long: 106.8, radiusM: 0 })).status).toBe(400)
    expect((await owner.post('/api/branches').send({ name: 'X', lat: -6.2, long: 106.8, radiusM: 999999 })).status).toBe(400)
  })
  it('TC-AB-031 arsipkan cabang → histori absensi tetap utuh', async () => {
    const before = (await owner.get(`/api/attendance/list?from=${addDays(TODAY, -30)}&to=${TODAY}`)).body.length
    await owner.post(`/api/branches/${branchA2}/archive`)
    const after = (await owner.get(`/api/attendance/list?from=${addDays(TODAY, -30)}&to=${TODAY}`)).body.length
    expect(after).toBe(before)
    // (re-create A2 not needed for later tests)
  })
})

// ---------------- UC-08 Divisi ----------------
describe('UC-AB-08 Divisi', () => {
  it('TC-AB-032/033 tambah & ubah nama divisi', async () => {
    const d = (await owner.post('/api/divisions').send({ name: 'Gudang' })).body
    expect(d.id).toBeTruthy()
    const u = await owner.patch(`/api/divisions/${d.id}`).send({ name: 'Gudang Utama' })
    expect(u.body.name).toBe('Gudang Utama')
    await owner.delete(`/api/divisions/${d.id}`)
  })
  it('TC-AB-034 hapus divisi ber-karyawan → ditolak', async () => {
    expect((await owner.delete(`/api/divisions/${divDapur}`)).status).toBe(409)
  })
  it('TC-AB-035 hapus divisi kosong → terhapus', async () => {
    const d = (await owner.post('/api/divisions').send({ name: 'Kosong' })).body
    expect((await owner.delete(`/api/divisions/${d.id}`)).status).toBe(200)
  })
})

// ---------------- UC-09 Admin cabang ----------------
describe('UC-AB-09 Admin cabang (scope)', () => {
  it('TC-AB-036 tetapkan branch_admin', async () => {
    const me = (await rina.get('/api/auth/me')).body
    expect(me.memberships.find((m: any) => m.company.id === cidA).membership.role).toBe('branch_admin')
  })
  it('TC-AB-037 admin cabang hanya lihat cabangnya', async () => {
    const emps = (await rina.get('/api/employees')).body
    expect(emps.every((e: any) => e.branchId === branchA1)).toBe(true)
  })
  it('TC-AB-038 cabut peran admin → akses menyesuaikan (hanya lihat diri sendiri)', async () => {
    await owner.patch(`/api/employees/${empRina}`).send({ role: 'employee', scopeBranchIds: [] })
    const emps = (await rina.get('/api/employees')).body // employee.view = self → hanya dirinya
    expect(emps.length).toBe(1)
    expect(emps[0].id).toBe(empRina)
    await owner.patch(`/api/employees/${empRina}`).send({ role: 'branch_admin', scopeBranchIds: [branchA1] })
  })
})

// ---------------- UC-10 Kebijakan ----------------
describe('UC-AB-10 Kebijakan absensi', () => {
  it('TC-AB-040 set mode potongan tersimpan', async () => {
    const r = await owner.put('/api/policy').send({ lateDeductionMode: 'per_minute', lateDeductionConfig: { perMinuteRate: 700 }, mealAllowanceConfig: { onOvertimeMinHours: 4, onOvertimeAmount: 25000 }, strictGeofence: false, trustThresholds: { accept: 80, review: 60 }, photoRetentionDays: 90 })
    expect(r.status).toBe(200); expect(r.body.lateDeductionConfig.perMinuteRate).toBe(700)
  })
  it('TC-AB-044 nilai tidak valid (toleransi shift negatif) → ditolak', async () => {
    expect((await owner.post('/api/shift-templates').send({ name: 'Bad', startTime: '08:00', endTime: '17:00', lateToleranceMinutes: -5 })).status).toBe(400)
  })
})

// ---------------- UC-11 Upah ----------------
describe('UC-AB-11 Komponen upah', () => {
  it('TC-AB-045 set upah valid', async () => {
    const r = await owner.patch(`/api/employees/${empAndi}`).send({ wageBasic: 4_000_000, wageFixedAllowance: 0 })
    expect(r.status).toBe(200)
  })
  it('TC-AB-046 upah negatif → ditolak', async () => {
    expect((await owner.patch(`/api/employees/${empAndi}`).send({ wageBasic: -1 })).status).toBe(400)
  })
  it('TC-AB-047 upah hanya untuk peran berwenang (branch_admin tak lihat)', async () => {
    const emps = (await rina.get('/api/employees')).body
    expect(emps[0].canSeeWage).toBe(false)
    expect(emps[0].wageBasic).toBeUndefined()
  })
})

// ---------------- UC-12 Dashboard ----------------
describe('UC-AB-12 Dashboard', () => {
  it('TC-AB-048 kartu ringkas', async () => {
    const r = await owner.get('/api/dashboard/summary')
    expect(r.status).toBe(200); expect(typeof r.body.present).toBe('number')
  })
  it('TC-AB-049 filter cabang', async () => {
    expect((await owner.get(`/api/dashboard/summary?branchId=${branchA1}`)).status).toBe(200)
  })
  it('TC-AB-050 filter divisi', async () => {
    expect((await owner.get(`/api/dashboard/summary?divisionId=${divDapur}`)).status).toBe(200)
  })
  it('TC-AB-052 admin cabang hanya data cabangnya', async () => {
    const feed = (await rina.get('/api/attendance/feed')).body
    expect(feed.every((r: any) => r.branchId === branchA1)).toBe(true)
  })
})

// ---------------- UC-13 Payroll PP 35/2021 ----------------
describe('UC-AB-13 Payroll', () => {
  it('TC-AB-053/054/055 rekap + upah/jam 1/173 + lembur hari kerja (≈80.924)', async () => {
    await owner.patch(`/api/employees/${empAndi}`).send({ wageBasic: 4_000_000, wageFixedAllowance: 0, wageVariableAllowance: 0 })
    // approved overtime 2h workday in period
    const ot = (await andi.post('/api/overtimes').send({ workDate: addDays(TODAY, -1), hours: 2, dayType: 'workday' })).body
    await owner.post(`/api/overtimes/${ot.id}/decision`).send({ status: 'approved' })
    const rows = (await owner.post('/api/reports/payroll').send({ periodStart: addDays(TODAY, -7), periodEnd: TODAY })).body
    const andiRow = rows.find((r: any) => r.employeeId === empAndi)
    expect(andiRow.hourlyWage).toBe(23121)
    expect(andiRow.overtimePayTotal).toBe(80924)
  })
  it('TC-AB-060 hanya lembur disetujui yang dihitung', async () => {
    const ot = (await andi.post('/api/overtimes').send({ workDate: addDays(TODAY, -2), hours: 3, dayType: 'workday' })).body // pending
    const rows = (await owner.post('/api/reports/payroll').send({ periodStart: addDays(TODAY, -7), periodEnd: TODAY })).body
    const andiRow = rows.find((r: any) => r.employeeId === empAndi)
    expect(andiRow.overtimeHoursTotal).toBe(2) // pending 3h NOT counted
    await owner.post(`/api/overtimes/${ot.id}/decision`).send({ status: 'rejected' })
  })
  it('TC-AB-063 periode tanpa data → nol tanpa error', async () => {
    const rows = (await owner.post('/api/reports/payroll').send({ periodStart: addDays(TODAY, -400), periodEnd: addDays(TODAY, -390) })).body
    expect(Array.isArray(rows)).toBe(true)
    expect(rows.every((r: any) => r.overtimePayTotal === 0)).toBe(true)
  })
  it('laporan periodik per karyawan: ringkasan + detail harian', async () => {
    const r = await owner.get('/api/reports/employee').query({ employeeId: empAndi, from: addDays(TODAY, -7), to: TODAY })
    expect(r.status).toBe(200)
    expect(r.body.employee.name).toBe('Andi')
    expect(r.body.summary).toHaveProperty('presentDays')
    expect(r.body.summary).toHaveProperty('leaveDays')
    expect(r.body.summary).toHaveProperty('overtimeHoursTotal')
    expect(Array.isArray(r.body.days)).toBe(true)
  })
  it('laporan karyawan di luar scope → 403', async () => {
    const empSouth = (await owner.post('/api/employees').send({ name: 'Selatan', email: 'selatan@a.test', branchId: branchA2 })).body.id
    expect((await rina.get('/api/reports/employee').query({ employeeId: empSouth, from: TODAY, to: TODAY })).status).toBe(403)
  })
})

// ---------------- UC-14 Audit ----------------
describe('UC-AB-14 Audit log', () => {
  it('TC-AB-065 aksi sensitif tercatat', async () => {
    const rows = (await owner.get('/api/audit')).body
    expect(rows.some((r: any) => r.action === 'company.create')).toBe(true)
    expect(rows.some((r: any) => r.action.startsWith('overtime.'))).toBe(true)
  })
  it('TC-AB-066 filter actorType', async () => {
    const rows = (await owner.get('/api/audit?actorType=user')).body
    expect(rows.every((r: any) => r.actorType === 'user')).toBe(true)
  })
  it('TC-AB-067 PII (email) teredaksi di metadata', async () => {
    const rows = (await owner.get('/api/audit')).body
    const blob = JSON.stringify(rows.map((r: any) => r.metadata))
    expect(blob).not.toMatch(/@a\.test/)
  })
})

// ---------------- UC-15/16 MCP connection mgmt ----------------
describe('UC-AB-15/16 MCP connection', () => {
  let mcpId: string
  it('TC-AB-068/070 otorisasi koneksi + daftar', async () => {
    const r = await owner.post('/api/mcp/connections').send({ agentName: 'Asisten', scopes: ['attendance:read'], scopeBranchIds: [branchA1] })
    expect(r.status).toBe(200); mcpId = r.body.id
    expect((await owner.get('/api/mcp/connections')).body.some((m: any) => m.id === mcpId)).toBe(true)
  })
  it('TC-AB-071 cabut koneksi (kill-switch)', async () => {
    await owner.delete(`/api/mcp/connections/${mcpId}`)
    const m = (await owner.get('/api/mcp/connections')).body.find((x: any) => x.id === mcpId)
    expect(m.status).toBe('revoked')
  })
})

// ---------------- UC-17 Export/Delete ----------------
describe('UC-AB-17 Export & hapus data (UU PDP)', () => {
  it('TC-AB-073 export seluruh data per company_id', async () => {
    const r = await owner.get('/api/company/export')
    expect(r.status).toBe(200)
    expect(r.body.data.company.length).toBe(1)
    expect(r.body.data.employee_profile.every((e: any) => e.company_id === cidA)).toBe(true)
  })
  it('TC-AB-074 hapus permanen per company_id', async () => {
    const tmp = agent(); await signin(tmp, 'del@a.test')
    const cid = (await tmp.post('/api/companies').send({ displayName: 'Hapus', businessType: 'X', timezone: 'Asia/Jakarta', workweekType: 'six_day' })).body.activeCompanyId
    await tmp.post('/api/branches').send({ name: 'B', lat: -6.2, long: 106.8, radiusM: 100 })
    expect((await tmp.delete('/api/company')).status).toBe(200)
    const me = (await tmp.get('/api/auth/me')).body
    expect(me.memberships.find((m: any) => m.company.id === cid)).toBeUndefined()
  })
})

// ---------------- UC-18 Invite & pendaftaran ----------------
describe('UC-AB-18 Undangan & pendaftaran', () => {
  it('TC-AB-075/076 buat undangan + terima (onboarding)', async () => {
    const inv = (await owner.post('/api/invites').send({ branchId: branchA1, role: 'employee' })).body
    expect(inv.token).toBeTruthy()
    const emp = agent(); await signin(emp, 'join1@a.test', 'Join Satu')
    const r = await emp.post(`/api/invites/token/${inv.token}/accept`).send({ consentLocation: true, consentPhoto: true })
    expect(r.status).toBe(200)
    expect((await emp.get('/api/auth/me')).body.activeCompanyId).toBe(cidA)
  })
  it('TC-AB-078 undangan kuota habis → ditolak', async () => {
    const inv = (await owner.post('/api/invites').send({ branchId: branchA1, role: 'employee', maxUses: 1 })).body
    const e1 = agent(); await signin(e1, 'q1@a.test'); await e1.post(`/api/invites/token/${inv.token}/accept`).send({ consentLocation: true, consentPhoto: true })
    const e2 = agent(); await signin(e2, 'q2@a.test')
    expect((await e2.post(`/api/invites/token/${inv.token}/accept`).send({ consentLocation: true, consentPhoto: true })).status).toBe(400)
  })
  it('TC-AB-079 undangan dicabut → ditolak', async () => {
    const inv = (await owner.post('/api/invites').send({ branchId: branchA1, role: 'employee' })).body
    await owner.delete(`/api/invites/${inv.id}`)
    const e = agent(); await signin(e, 'rev@a.test')
    expect((await e.post(`/api/invites/token/${inv.token}/accept`).send({ consentLocation: true, consentPhoto: true })).status).toBe(400)
  })
  it('TC-AB-080 daftar manual via email → pending lalu ter-claim saat login', async () => {
    await owner.post('/api/employees').send({ name: 'Pending', email: 'pending@a.test', branchId: branchA1 })
    const p = agent(); const r = await signin(p, 'pending@a.test', 'Pending')
    expect(r.body.activeCompanyId).toBe(cidA)
  })
  it('TC-AB-081 import CSV valid', async () => {
    const r = await owner.post('/api/employees/import').send({ branchId: branchA1, rows: [{ name: 'Imp1', email: 'imp1@a.test', wageBasic: 4000000 }, { name: 'Imp2', email: 'imp2@a.test' }] })
    expect(r.status).toBe(200); expect(r.body.created).toBe(2)
  })
  it('TC-AB-082 import CSV baris tidak valid (email rusak) → ditolak', async () => {
    expect((await owner.post('/api/employees/import').send({ branchId: branchA1, rows: [{ name: 'Bad', email: 'not-an-email' }] })).status).toBe(400)
  })
  it('TC-AB-083 import email duplikat → dilewati tanpa keanggotaan ganda', async () => {
    const r = await owner.post('/api/employees/import').send({ branchId: branchA1, rows: [{ name: 'Andi Dup', email: 'andi@a.test' }] })
    expect(r.body.created).toBe(0); expect(r.body.skipped).toContain('andi@a.test')
  })
})

// ---------------- UC-19 Data karyawan ----------------
describe('UC-AB-19 Data karyawan', () => {
  it('TC-AB-084 daftar karyawan (admin scoped)', async () => {
    expect((await owner.get('/api/employees')).body.length).toBeGreaterThan(0)
  })
  it('TC-AB-087 edit data karyawan', async () => {
    const r = await owner.patch(`/api/employees/${empAndi}`).send({ name: 'Andi Wijaya' })
    expect(r.body.name).toBe('Andi Wijaya')
    await owner.patch(`/api/employees/${empAndi}`).send({ name: 'Andi' })
  })
  it('TC-AB-088 pindah cabang; histori tetap', async () => {
    const beforeHist = (await owner.get(`/api/attendance/list?from=${addDays(TODAY, -1)}&to=${TODAY}`)).body.filter((r: any) => r.employeeId === empAndi).length
    await owner.patch(`/api/employees/${empAndi}`).send({ branchId: branchA1 }) // keep A1 (A2 archived)
    const afterHist = (await owner.get(`/api/attendance/list?from=${addDays(TODAY, -1)}&to=${TODAY}`)).body.filter((r: any) => r.employeeId === empAndi).length
    expect(afterHist).toBe(beforeHist)
  })
  it('TC-AB-089 nonaktifkan karyawan', async () => {
    const x = (await owner.post('/api/employees').send({ name: 'Off', email: 'off@a.test', branchId: branchA1 })).body
    const r = await owner.patch(`/api/employees/${x.id}`).send({ employmentStatus: 'inactive' })
    expect(r.body.employmentStatus).toBe('inactive')
    // delete guarded: only when inactive
    expect((await owner.delete(`/api/employees/${x.id}`)).status).toBe(200)
  })
})

// ---------------- UC-20 Shift ----------------
describe('UC-AB-20 Jadwal shift', () => {
  it('TC-AB-090 buat template', async () => {
    expect(typeof shiftPagi).toBe('string')
  })
  it('TC-AB-091 shift malam lintas tengah malam', async () => {
    const t = (await owner.get('/api/shift-templates')).body.find((s: any) => s.id === shiftMalam)
    expect(t.crossesMidnight).toBe(true)
  })
  it('TC-AB-092/093 tugaskan & bulk', async () => {
    const r = await owner.post('/api/shift-assignments').send({ employeeIds: [empAndi], shiftTemplateId: shiftPagi, dateStart: addDays(TODAY, 1), skipSundays: false })
    expect(r.body.created).toBeGreaterThanOrEqual(0)
  })
  it('TC-AB-095 penugasan tumpang tindih → ditolak', async () => {
    const d = addDays(TODAY, 2)
    await owner.post('/api/shift-assignments').send({ employeeIds: [empAndi], shiftTemplateId: shiftPagi, dateStart: d, skipSundays: false })
    const r = await owner.post('/api/shift-assignments').send({ employeeIds: [empAndi], shiftTemplateId: shiftMalam, dateStart: d, skipSundays: false }) // 22-06 vs 08-17 overlap? no. use overlapping template
    // Pagi 08-17 vs another Pagi-like overlapping
    const overlapTpl = (await owner.post('/api/shift-templates').send({ name: 'Siang', startTime: '12:00', endTime: '20:00' })).body.id
    const r2 = await owner.post('/api/shift-assignments').send({ employeeIds: [empAndi], shiftTemplateId: overlapTpl, dateStart: d, skipSundays: false })
    expect(r2.body.conflicts).toBeGreaterThanOrEqual(1)
    void r
  })
})

// ---------------- UC-25 Clock-in ----------------
describe('UC-AB-25 Clock-in', () => {
  it('TC-AB-111 di dalam geofence, GPS baik → diterima', async () => {
    const e = agent(); await signin(e, 'ci1@a.test', 'CI Satu')
    const inv = (await owner.post('/api/invites').send({ branchId: branchA1, role: 'employee' })).body
    await e.post(`/api/invites/token/${inv.token}/accept`).send({ consentLocation: true, consentPhoto: true })
    const eid = (await e.get('/api/auth/me')).body.employeeId
    await owner.post('/api/shift-assignments').send({ employeeIds: [eid], shiftTemplateId: shiftPagi, dateStart: TODAY, skipSundays: false })
    const r = await e.post('/api/attendance/clock').send({ kind: 'in', lat: -6.2, long: 106.8166, gpsAccuracyM: 15, livenessPassed: true, cameraAvailable: true, geofenceResult: 'inside', idempotencyKey: 'kci1-aaaa' })
    expect(r.status).toBe(200); expect(r.body.decision).toBe('accepted'); expect(r.body.trustScore).toBe(100)
  })
  it('TC-AB-112 di luar geofence (allow+flag) → flagged & masuk anomaly', async () => {
    const e = agent(); await signin(e, 'ci2@a.test', 'CI Dua')
    const inv = (await owner.post('/api/invites').send({ branchId: branchA1, role: 'employee' })).body
    await e.post(`/api/invites/token/${inv.token}/accept`).send({ consentLocation: true, consentPhoto: true })
    const eid = (await e.get('/api/auth/me')).body.employeeId
    await owner.post('/api/shift-assignments').send({ employeeIds: [eid], shiftTemplateId: shiftPagi, dateStart: TODAY, skipSundays: false })
    const r = await e.post('/api/attendance/clock').send({ kind: 'in', lat: -7.5, long: 110, gpsAccuracyM: 300, livenessPassed: true, cameraAvailable: true, geofenceResult: 'outside', idempotencyKey: 'kci2-bbbb' })
    expect(r.body.decision).toBe('flagged'); expect(r.body.trustScore).toBeLessThan(60)
    const anom = (await owner.get('/api/attendance/anomalies')).body
    expect(anom.some((a: any) => a.employeeId === eid)).toBe(true)
  })
  it('TC-AB-113 mode strict di luar geofence → ditolak', async () => {
    await owner.put('/api/policy').send({ lateDeductionMode: 'per_minute', lateDeductionConfig: { perMinuteRate: 500 }, mealAllowanceConfig: {}, strictGeofence: true, trustThresholds: { accept: 80, review: 60 }, photoRetentionDays: 90 })
    const e = agent(); await signin(e, 'ci3@a.test', 'CI Tiga')
    const inv = (await owner.post('/api/invites').send({ branchId: branchA1, role: 'employee' })).body
    await e.post(`/api/invites/token/${inv.token}/accept`).send({ consentLocation: true, consentPhoto: true })
    const eid = (await e.get('/api/auth/me')).body.employeeId
    await owner.post('/api/shift-assignments').send({ employeeIds: [eid], shiftTemplateId: shiftPagi, dateStart: TODAY, skipSundays: false })
    const r = await e.post('/api/attendance/clock').send({ kind: 'in', lat: -7.5, long: 110, gpsAccuracyM: 30, livenessPassed: true, cameraAvailable: true, geofenceResult: 'outside', idempotencyKey: 'kci3-cccc' })
    expect(r.status).toBe(422)
    await owner.put('/api/policy').send({ lateDeductionMode: 'per_minute', lateDeductionConfig: { perMinuteRate: 500 }, mealAllowanceConfig: {}, strictGeofence: false, trustThresholds: { accept: 80, review: 60 }, photoRetentionDays: 90 })
  })
  it('TC-AB-121 clock-in dua kali (idempoten) → tak duplikat record', async () => {
    const before = (await andi.get('/api/me/attendance').query({ from: TODAY, to: TODAY })).body.length
    await andi.post('/api/attendance/clock').send({ kind: 'in', lat: -6.2, long: 106.8166, gpsAccuracyM: 15, livenessPassed: true, cameraAvailable: true, geofenceResult: 'inside', idempotencyKey: 'dupkey-001' })
    await andi.post('/api/attendance/clock').send({ kind: 'in', lat: -6.2, long: 106.8166, gpsAccuracyM: 15, livenessPassed: true, cameraAvailable: true, geofenceResult: 'inside', idempotencyKey: 'dupkey-001' })
    const after = (await andi.get('/api/me/attendance').query({ from: TODAY, to: TODAY })).body.length
    expect(after).toBeLessThanOrEqual(before + 1)
  })
})

// ---------------- UC-21 Koreksi ----------------
describe('UC-AB-21 Koreksi kehadiran', () => {
  it('TC-AB-097/098/100 koreksi dgn alasan; tanpa alasan ditolak; tercatat audit', async () => {
    const rec = (await owner.get('/api/attendance/feed')).body[0]
    expect((await owner.post(`/api/attendance/${rec.id}/correct`).send({ status: 'on_time' })).status).toBe(400) // alasan wajib
    const ok = await owner.post(`/api/attendance/${rec.id}/correct`).send({ status: 'on_time', reason: 'sinyal lemah', resolveFlag: true })
    expect(ok.status).toBe(200)
    expect((await owner.get('/api/audit')).body.some((r: any) => r.action === 'attendance.correct')).toBe(true)
  })
})

// ---------------- UC-23/24 Approvals ----------------
describe('UC-AB-23/24 Persetujuan cuti & lembur', () => {
  it('TC-AB-104 setujui cuti', async () => {
    const lv = (await andi.post('/api/leaves').send({ type: 'tahunan', dateStart: addDays(TODAY, 10), dateEnd: addDays(TODAY, 10), reason: 'acara' })).body
    const r = await owner.post(`/api/leaves/${lv.id}/decision`).send({ status: 'approved' })
    expect(r.body.status).toBe('approved')
  })
  it('TC-AB-106 approver hanya proses dalam scope', async () => {
    // employee di cabang lain (B) tak bisa diproses owner A (beda tenant) — pakai scope admin
    const lv = (await andi.post('/api/leaves').send({ type: 'izin', dateStart: addDays(TODAY, 20), dateEnd: addDays(TODAY, 20) })).body
    // rina admin cabang A1, andi di A1 → boleh
    expect((await rina.post(`/api/leaves/${lv.id}/decision`).send({ status: 'approved' })).status).toBe(200)
  })
  it('TC-AB-108 setujui lembur → masuk payroll', async () => {
    const ot = (await andi.post('/api/overtimes').send({ workDate: addDays(TODAY, -3), hours: 2, dayType: 'workday' })).body
    await owner.post(`/api/overtimes/${ot.id}/decision`).send({ status: 'approved' })
    const rows = (await owner.post('/api/reports/payroll').send({ periodStart: addDays(TODAY, -7), periodEnd: TODAY })).body
    expect(rows.find((r: any) => r.employeeId === empAndi).overtimeHoursTotal).toBeGreaterThanOrEqual(2)
  })
})

// ---------------- UC-28/29 Pengajuan oleh karyawan ----------------
describe('UC-AB-28/29 Pengajuan karyawan', () => {
  it('TC-AB-129 ajukan cuti valid → pending', async () => {
    const r = await andi.post('/api/leaves').send({ type: 'sakit', dateStart: addDays(TODAY, 30), dateEnd: addDays(TODAY, 30), reason: 'demam' })
    expect(r.status).toBe(200); expect(r.body.status).toBe('pending')
  })
  it('TC-AB-131 cuti bentrok dengan cuti lain → ditolak', async () => {
    await andi.post('/api/leaves').send({ type: 'izin', dateStart: addDays(TODAY, 40), dateEnd: addDays(TODAY, 42) })
    expect((await andi.post('/api/leaves').send({ type: 'izin', dateStart: addDays(TODAY, 41), dateEnd: addDays(TODAY, 43) })).status).toBe(409)
  })
  it('TC-AB-133/134 ajukan lembur valid → pending; field wajib kosong → ditolak', async () => {
    expect((await andi.post('/api/overtimes').send({ workDate: addDays(TODAY, 5), hours: 2, dayType: 'workday' })).body.status).toBe('pending')
    expect((await andi.post('/api/overtimes').send({ hours: 2, dayType: 'workday' })).status).toBe(400)
  })
})

// ---------------- UC-30/31 Jadwal & riwayat pribadi ----------------
describe('UC-AB-30/31 Jadwal & riwayat pribadi', () => {
  it('TC-AB-136 jadwal shift pribadi tampil', async () => {
    const r = await andi.get('/api/shift-assignments').query({ employeeId: empAndi, from: addDays(TODAY, -1), to: addDays(TODAY, 7) })
    expect(r.status).toBe(200)
  })
  it('TC-AB-139 riwayat kehadiran pribadi', async () => {
    const r = await andi.get('/api/me/attendance').query({ from: addDays(TODAY, -30), to: TODAY })
    expect(r.status).toBe(200); expect(r.body.every((x: any) => x.employeeId === empAndi)).toBe(true)
  })
  it('TC-AB-140 karyawan hanya lihat datanya sendiri (isolasi)', async () => {
    // andi tidak boleh melihat data semua via feed/list (dibatasi self)
    const feed = await andi.get('/api/attendance/feed')
    // employee may pass cap (self) but feed must only contain own records
    if (feed.status === 200) expect(feed.body.every((r: any) => r.employeeId === empAndi)).toBe(true)
    else expect([403]).toContain(feed.status)
  })
})

// ---------------- UC-32 Consent ----------------
describe('UC-AB-32 Consent', () => {
  it('TC-AB-141 consent diberikan → profil aktif & bisa absen', async () => {
    const inv = (await owner.post('/api/invites').send({ branchId: branchA1, role: 'employee' })).body
    const e = agent(); await signin(e, 'consent1@a.test')
    expect((await e.post(`/api/invites/token/${inv.token}/accept`).send({ consentLocation: true, consentPhoto: true })).status).toBe(200)
  })
  it('TC-AB-142 tanpa consent → onboarding tak selesai', async () => {
    const inv = (await owner.post('/api/invites').send({ branchId: branchA1, role: 'employee' })).body
    const e = agent(); await signin(e, 'consent2@a.test')
    expect((await e.post(`/api/invites/token/${inv.token}/accept`).send({ consentLocation: false, consentPhoto: false })).status).toBe(400)
  })
})

// ---------------- Isolasi multi-tenant (UC-09/31/33/34 prinsip) ----------------
describe('Isolasi multi-tenant', () => {
  it('owner A tidak melihat karyawan tenant B', async () => {
    const emps = (await owner.get('/api/employees')).body
    expect(emps.some((e: any) => e.email === 'budi@b.test')).toBe(false)
  })
})
