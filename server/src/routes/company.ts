import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { db, now } from '../lib/db.js'
import { id } from '../lib/ids.js'
import { mapCompany, mapPolicy } from '../lib/map.js'
import { requireAuth, requireCompany, requireCap, setSessionCompany } from '../lib/context.js'
import { audit } from '../lib/audit.js'
import { ownerStatusFresh } from '../lib/agentbuffGate.js'
import { LIMITS } from '../lib/rateLimit.js'
import { ALLOWED_TIMEZONES, LOGO_MAX_BYTES, PHOTO_MESSAGE, checkImageDataUrl, isAllowedTimezone } from '../lib/validate.js'

const timezoneSchema = z.string().refine(isAllowedTimezone, { message: `timezone harus salah satu dari ${ALLOWED_TIMEZONES.join(', ')}` })
const INVALID_TZ = { error: 'invalid_timezone', message: `Zona waktu harus WIB (Asia/Jakarta), WITA (Asia/Makassar), atau WIT (Asia/Jayapura).` }

export const companyRouter = Router()

const DEFAULT_POLICY = {
  lateDeductionMode: 'per_minute',
  lateDeductionConfig: { perMinuteRate: 500 },
  mealAllowanceConfig: { perPresentDay: 0, onOvertimeMinHours: 4, onOvertimeAmount: 25000 },
  strictGeofence: false,
  trustThresholds: { accept: 80, review: 60 },
  photoRetentionDays: 90,
}

/**
 * Only an entitled AgentBuff owner may create a company (Absentra is a paid
 * marketplace product). Invited staff signing in with Google have no AgentBuff
 * identity, so they cannot turn themselves into owners here. Separate middleware
 * so the handler below stays synchronous (Express 4 does not route rejected
 * promises to the error handler).
 */
function pastikanBolehBuatPerusahaan(req: Request, res: Response, next: NextFunction) {
  ownerStatusFresh(req.ctx!.userId)
    .then((hak) => (hak.entitled ? next() : res.status(403).json({ error: 'perlu_agentbuff', reason: hak.reason })))
    .catch(next)
}

/** Owner onboarding — create a company; the creator becomes Owner (PRD §6.1, §7.2.1). */
companyRouter.post('/companies', requireAuth, pastikanBolehBuatPerusahaan, (req, res) => {
  const body = z.object({
    displayName: z.string().trim().min(1).max(120),
    legalName: z.string().trim().min(1).max(200).optional(),
    businessType: z.string().trim().min(1).max(80),
    timezone: z.string().min(1),
    address: z.string().max(500).optional(),
    workweekType: z.enum(['five_day', 'six_day']),
  }).parse(req.body)
  if (!isAllowedTimezone(body.timezone)) return res.status(400).json(INVALID_TZ)

  const userId = req.ctx!.userId
  const user = db.prepare('SELECT * FROM user WHERE id = ?').get(userId) as any
  const cid = id('co')
  const mid = id('mem')

  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO company (id, legal_name, display_name, business_type, timezone, address, workweek_type, created_at)
                VALUES (?,?,?,?,?,?,?,?)`).run(
      cid, body.legalName ?? body.displayName, body.displayName, body.businessType, body.timezone, body.address ?? null, body.workweekType, now(),
    )
    db.prepare(`INSERT INTO membership (id, company_id, user_id, role, scope_branch_ids, scope_division_ids, status, created_at)
                VALUES (?,?,?,?,?,?,?,?)`).run(mid, cid, userId, 'owner', '[]', '[]', 'active', now())
    db.prepare(`INSERT INTO policy (company_id, late_deduction_mode, late_deduction_config, meal_allowance_config, strict_geofence, trust_thresholds, photo_retention_days)
                VALUES (?,?,?,?,?,?,?)`).run(
      cid, DEFAULT_POLICY.lateDeductionMode, JSON.stringify(DEFAULT_POLICY.lateDeductionConfig),
      JSON.stringify(DEFAULT_POLICY.mealAllowanceConfig), 0, JSON.stringify(DEFAULT_POLICY.trustThresholds), DEFAULT_POLICY.photoRetentionDays,
    )
  })
  tx()

  setSessionCompany(req.ctx!.sessionId, cid)
  audit({ companyId: cid, actorType: 'user', actorId: userId, action: 'company.create', target: cid, metadata: { name: body.displayName } })
  void user
  const company = db.prepare('SELECT * FROM company WHERE id = ?').get(cid)
  res.json({ company: mapCompany(company), activeCompanyId: cid })
})

companyRouter.get('/company', requireCompany, (req, res) => {
  const c = db.prepare('SELECT * FROM company WHERE id = ?').get(req.ctx!.companyId) as any
  res.json(mapCompany(c))
})

companyRouter.patch('/company', requireCompany, requireCap('company.update'), (req, res) => {
  const body = z.object({
    displayName: z.string().trim().min(1).max(120).optional(),
    legalName: z.string().trim().min(1).max(200).optional(),
    businessType: z.string().trim().min(1).max(80).optional(),
    timezone: z.string().min(1).optional(),
    address: z.string().max(500).optional(),
    workweekType: z.enum(['five_day', 'six_day']).optional(),
  }).parse(req.body)
  if (body.timezone !== undefined && !isAllowedTimezone(body.timezone)) return res.status(400).json(INVALID_TZ)
  const cid = req.ctx!.companyId!
  const cur = db.prepare('SELECT * FROM company WHERE id = ?').get(cid) as any
  db.prepare(`UPDATE company SET display_name=?, legal_name=?, business_type=?, timezone=?, address=?, workweek_type=? WHERE id=?`).run(
    body.displayName ?? cur.display_name,
    body.legalName ?? cur.legal_name,
    body.businessType ?? cur.business_type,
    body.timezone ?? cur.timezone,
    body.address ?? cur.address,
    body.workweekType ?? cur.workweek_type,
    cid,
  )
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: 'company.update', target: cid })
  res.json(mapCompany(db.prepare('SELECT * FROM company WHERE id = ?').get(cid)))
})

const TENANT_TABLES = ['company', 'membership', 'branch', 'geofence', 'division', 'employee_profile', 'shift_template', 'shift_assignment', 'attendance_record', 'attendance_event', 'leave_request', 'overtime_request', 'policy', 'mcp_connection', 'invite', 'identity_bridge', 'external_identity', 'audit_log']

/** Export every tenant-owned row by company_id (UU PDP hak akses, PRD §4.7/§9.5). */
companyRouter.get('/company/export', requireCompany, requireCap('company.update'), (req, res) => {
  const cid = req.ctx!.companyId!
  const dump: Record<string, unknown[]> = {}
  for (const tbl of TENANT_TABLES) {
    const col = tbl === 'company' ? 'id' : 'company_id'
    dump[tbl] = db.prepare(`SELECT * FROM ${tbl} WHERE ${col} = ?`).all(cid) as unknown[]
  }
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: 'company.export', target: cid })
  res.setHeader('content-disposition', `attachment; filename="absentra-export-${cid}.json"`)
  res.json({ exportedAt: now(), companyId: cid, data: dump })
})

/**
 * Permanent tenant deletion by company_id (UU PDP hak hapus, PRD §9.5). Every
 * statement is `WHERE company_id = <this tenant>` — other tenants' rows
 * (including their audit_log) are never touched. Requires re-typing the
 * company's display name as an explicit confirmation.
 */
companyRouter.delete('/company', requireCompany, requireCap('company.update'), (req, res) => {
  const body = z.object({ confirmName: z.string().optional() }).parse(req.body ?? {})
  const cid = req.ctx!.companyId!
  const c = db.prepare('SELECT display_name FROM company WHERE id = ?').get(cid) as any
  if (!c || (body.confirmName ?? '').trim() !== String(c.display_name).trim()) {
    return res.status(400).json({ error: 'confirm_name_mismatch', message: 'Ketik nama perusahaan persis untuk mengonfirmasi penghapusan permanen.' })
  }
  const tx = db.transaction(() => {
    for (const tbl of TENANT_TABLES) {
      const col = tbl === 'company' ? 'id' : 'company_id'
      db.prepare(`DELETE FROM ${tbl} WHERE ${col} = ?`).run(cid)
    }
    // No session or refresh token may keep pointing at the deleted tenant.
    db.prepare('UPDATE session SET company_id = NULL WHERE company_id = ?').run(cid)
    db.prepare('UPDATE refresh_token SET company_id = NULL WHERE company_id = ?').run(cid)
  })
  tx()
  setSessionCompany(req.ctx!.sessionId, null)
  res.json({ ok: true, deletedCompanyId: cid })
})

/** Upload company logo as a data URL — validates format & size (TC-025/026). */
companyRouter.post('/company/logo', requireCompany, requireCap('company.update'), LIMITS.logo, (req, res) => {
  const body = z.object({ logoData: z.string() }).parse(req.body)
  // JPEG/PNG/WebP only (no SVG: it can carry script), decoded size <= 300 KB.
  const check = checkImageDataUrl(body.logoData, LOGO_MAX_BYTES)
  if (!check.ok) return res.status(400).json({ error: check.error, message: PHOTO_MESSAGE[check.error] })
  db.prepare('UPDATE company SET logo_url=? WHERE id=?').run(body.logoData, req.ctx!.companyId)
  audit({ companyId: req.ctx!.companyId!, actorType: 'user', actorId: req.ctx!.userId, action: 'company.logo', target: req.ctx!.companyId! })
  res.json(mapCompany(db.prepare('SELECT * FROM company WHERE id=?').get(req.ctx!.companyId)))
})

companyRouter.get('/policy', requireCompany, (req, res) => {
  const p = db.prepare('SELECT * FROM policy WHERE company_id = ?').get(req.ctx!.companyId) as any
  res.json(mapPolicy(p))
})

const money = z.number().nonnegative().max(1e9)
export const lateDeductionConfigSchema = z.object({
  graceMinutes: z.number().int().nonnegative().max(1440).optional(),
  flatAmount: money.optional(),
  perMinuteRate: money.optional(),
  tiers: z.array(z.object({ uptoMinutes: z.number().int().positive().max(1440), amount: money })).max(20).optional(),
})
export const mealAllowanceConfigSchema = z.object({
  perPresentDay: money.optional(),
  onOvertimeMinHours: z.number().nonnegative().max(24).optional(),
  onOvertimeAmount: money.optional(),
})
export const trustThresholdsSchema = z.object({ accept: z.number().min(0).max(100), review: z.number().min(0).max(100) })
  .refine((t) => t.review <= t.accept, { message: 'review must be <= accept' })

companyRouter.put('/policy', requireCompany, requireCap('policy.manage'), (req, res) => {
  const body = z.object({
    lateDeductionMode: z.enum(['grace_flat', 'per_minute', 'tiered']),
    lateDeductionConfig: lateDeductionConfigSchema,
    mealAllowanceConfig: mealAllowanceConfigSchema,
    strictGeofence: z.boolean(),
    trustThresholds: trustThresholdsSchema,
    photoRetentionDays: z.number().int().positive().max(3650),
    minRestHours: z.number().int().nonnegative().max(48).optional(),
  }).parse(req.body)
  const cid = req.ctx!.companyId!
  // A tiered policy with no tiers would silently deduct nothing — refuse it.
  if (body.lateDeductionMode === 'tiered' && !(body.lateDeductionConfig.tiers?.length)) {
    return res.status(400).json({ error: 'tiers_required', message: 'Mode potongan bertingkat membutuhkan minimal satu tingkat.' })
  }
  const cur = db.prepare('SELECT min_rest_hours FROM policy WHERE company_id=?').get(cid) as any
  db.prepare(`UPDATE policy SET late_deduction_mode=?, late_deduction_config=?, meal_allowance_config=?, strict_geofence=?, trust_thresholds=?, photo_retention_days=?, min_rest_hours=? WHERE company_id=?`).run(
    body.lateDeductionMode, JSON.stringify(body.lateDeductionConfig), JSON.stringify(body.mealAllowanceConfig),
    body.strictGeofence ? 1 : 0, JSON.stringify(body.trustThresholds), body.photoRetentionDays,
    body.minRestHours ?? cur?.min_rest_hours ?? 0, // omitted = keep the current value
    cid,
  )
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: 'policy.update', target: cid })
  res.json(mapPolicy(db.prepare('SELECT * FROM policy WHERE company_id = ?').get(cid)))
})
