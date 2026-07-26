import { Router } from 'express'
import { z } from 'zod'
import { db, now } from '../lib/db.js'
import { id } from '../lib/ids.js'
import { mapCompany, mapPolicy } from '../lib/map.js'
import { requireAuth, requireCompany, requireCap, setSessionCompany } from '../lib/context.js'
import { audit } from '../lib/audit.js'

export const companyRouter = Router()

const DEFAULT_POLICY = {
  lateDeductionMode: 'per_minute',
  lateDeductionConfig: { perMinuteRate: 500 },
  mealAllowanceConfig: { perPresentDay: 0, onOvertimeMinHours: 4, onOvertimeAmount: 25000 },
  strictGeofence: false,
  trustThresholds: { accept: 80, review: 60 },
  photoRetentionDays: 90,
}

/** Owner onboarding — create a company; the creator becomes Owner (PRD §6.1, §7.2.1). */
companyRouter.post('/companies', requireAuth, (req, res) => {
  const body = z.object({
    displayName: z.string().min(1),
    legalName: z.string().min(1).optional(),
    businessType: z.string().min(1),
    timezone: z.string().min(1),
    address: z.string().optional(),
    workweekType: z.enum(['five_day', 'six_day']),
  }).parse(req.body)

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
    displayName: z.string().min(1).optional(),
    legalName: z.string().min(1).optional(),
    businessType: z.string().min(1).optional(),
    timezone: z.string().min(1).optional(),
    address: z.string().optional(),
    workweekType: z.enum(['five_day', 'six_day']).optional(),
  }).parse(req.body)
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

const TENANT_TABLES = ['company', 'membership', 'branch', 'geofence', 'division', 'employee_profile', 'shift_template', 'shift_assignment', 'attendance_record', 'attendance_event', 'leave_request', 'overtime_request', 'policy', 'mcp_connection', 'invite', 'audit_log']

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

/** Permanent tenant deletion by company_id (UU PDP hak hapus, PRD §9.5). */
companyRouter.delete('/company', requireCompany, requireCap('company.update'), (req, res) => {
  const cid = req.ctx!.companyId!
  const tx = db.transaction(() => {
    for (const tbl of TENANT_TABLES) {
      const col = tbl === 'company' ? 'id' : 'company_id'
      db.prepare(`DELETE FROM ${tbl} WHERE ${col} = ?`).run(cid)
    }
  })
  tx()
  setSessionCompany(req.ctx!.sessionId, null)
  res.json({ ok: true, deletedCompanyId: cid })
})

/** Upload company logo as a data URL — validates format & size (TC-025/026). */
companyRouter.post('/company/logo', requireCompany, requireCap('company.update'), (req, res) => {
  const body = z.object({ logoData: z.string() }).parse(req.body)
  if (!/^data:image\/(png|jpe?g|svg\+xml|webp);base64,/.test(body.logoData)) return res.status(400).json({ error: 'unsupported_format' })
  if (body.logoData.length > 1_500_000) return res.status(400).json({ error: 'too_large' }) // ~1MB
  db.prepare('UPDATE company SET logo_url=? WHERE id=?').run(body.logoData, req.ctx!.companyId)
  audit({ companyId: req.ctx!.companyId!, actorType: 'user', actorId: req.ctx!.userId, action: 'company.logo', target: req.ctx!.companyId! })
  res.json(mapCompany(db.prepare('SELECT * FROM company WHERE id=?').get(req.ctx!.companyId)))
})

companyRouter.get('/policy', requireCompany, (req, res) => {
  const p = db.prepare('SELECT * FROM policy WHERE company_id = ?').get(req.ctx!.companyId) as any
  res.json(mapPolicy(p))
})

companyRouter.put('/policy', requireCompany, requireCap('policy.manage'), (req, res) => {
  const body = z.object({
    lateDeductionMode: z.enum(['grace_flat', 'per_minute', 'tiered']),
    lateDeductionConfig: z.record(z.any()),
    mealAllowanceConfig: z.record(z.any()),
    strictGeofence: z.boolean(),
    trustThresholds: z.object({ accept: z.number(), review: z.number() }),
    photoRetentionDays: z.number().int().positive(),
    minRestHours: z.number().int().nonnegative().max(48).optional(),
  }).parse(req.body)
  const cid = req.ctx!.companyId!
  db.prepare(`UPDATE policy SET late_deduction_mode=?, late_deduction_config=?, meal_allowance_config=?, strict_geofence=?, trust_thresholds=?, photo_retention_days=?, min_rest_hours=? WHERE company_id=?`).run(
    body.lateDeductionMode, JSON.stringify(body.lateDeductionConfig), JSON.stringify(body.mealAllowanceConfig),
    body.strictGeofence ? 1 : 0, JSON.stringify(body.trustThresholds), body.photoRetentionDays, body.minRestHours ?? 0, cid,
  )
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: 'policy.update', target: cid })
  res.json(mapPolicy(db.prepare('SELECT * FROM policy WHERE company_id = ?').get(cid)))
})
