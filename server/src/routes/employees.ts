import { Router, type Request } from 'express'
import { z } from 'zod'
import { db, now } from '../lib/db.js'
import { id, token } from '../lib/ids.js'
import { mapEmployee } from '../lib/map.js'
import { requireAuth, requireCompany, requireCap, setSessionCompany } from '../lib/context.js'
import { can, type Actor } from '../domain/rbac.js'
import type { Role } from '../domain/types.js'
import { hashPassword } from '../lib/password.js'
import { audit } from '../lib/audit.js'
import { config } from '../lib/config.js'
import { LIMITS } from '../lib/rateLimit.js'
import { PHOTO_MESSAGE, PROFILE_PHOTO_MAX_BYTES, checkImageDataUrl } from '../lib/validate.js'

export const employeesRouter = Router()

/**
 * Role/scope rules (PRD §5): only the Owner may grant or change roles and
 * branch scopes; nobody can grant `owner` through these routes; a non-owner
 * (branch admin) may only manage plain employees inside its own branches; an
 * owner membership cannot be deactivated/deleted/demoted by anyone but itself,
 * and never when it is the last active owner.
 */
const MANAGER_ROLES = new Set<Role>(['hr', 'branch_admin'])

const actorOf = (req: Request): Actor => req.ctx!.actor!
const isOwner = (req: Request) => actorOf(req).membership.role === 'owner'

function scopeFilter(req: Request): string[] | null {
  const m = actorOf(req).membership
  return m.scopeBranchIds.length > 0 ? m.scopeBranchIds : null
}

function branchInCompany(cid: string, branchId: string | null | undefined): boolean {
  if (!branchId) return false
  return !!db.prepare(`SELECT id FROM branch WHERE id=? AND company_id=? AND status='active'`).get(branchId, cid)
}
function divisionInCompany(cid: string, divisionId: string | null | undefined): boolean {
  if (!divisionId) return true
  return !!db.prepare('SELECT id FROM division WHERE id=? AND company_id=?').get(divisionId, cid)
}
function allBranchesInCompany(cid: string, ids: string[]): boolean {
  return ids.every((b) => branchInCompany(cid, b))
}
function activeOwnerCount(cid: string, exceptMembershipId?: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM membership WHERE company_id=? AND role='owner' AND status='active' AND id != ?`).get(cid, exceptMembershipId ?? '') as any).n
}
const touchesWage = (b: { wageBasic?: number; wageFixedAllowance?: number; wageVariableAllowance?: number }) =>
  !!(b.wageBasic || b.wageFixedAllowance || b.wageVariableAllowance)

/** Scope stored for a new membership. */
function newMembershipScope(req: Request, role: Role, branchId: string, explicit?: string[]): string[] {
  if (!isOwner(req)) return [branchId] // always a subset of the creating branch admin's own scope
  if (MANAGER_ROLES.has(role)) return explicit ?? [branchId] // owner-made admin defaults to ONE branch, not all
  return []
}

const FORBIDDEN = {
  out_of_scope: { error: 'out_of_scope', message: 'Di luar cabang yang Anda kelola.' },
  role_requires_owner: { error: 'role_requires_owner', message: 'Hanya pemilik yang dapat mengatur peran dan cakupan cabang.' },
  cannot_modify_owner: { error: 'cannot_modify_owner', message: 'Akun pemilik tidak dapat diubah dari sini.' },
  forbidden_target_role: { error: 'forbidden_target_role', message: 'Anda hanya dapat mengelola karyawan biasa.' },
  forbidden_wage: { error: 'forbidden_wage', message: 'Anda tidak berwenang mengatur upah.' },
}

// ---- Employees ----
employeesRouter.get('/employees', requireCompany, requireCap('employee.view'), (req, res) => {
  const cid = req.ctx!.companyId!
  const scope = scopeFilter(req)
  let rows = db.prepare('SELECT * FROM employee_profile WHERE company_id = ? ORDER BY name').all(cid) as any[]
  // Plain employees (employee.view = 'self') may only see their own record.
  if (actorOf(req).membership.role === 'employee') rows = rows.filter((e) => e.id === req.ctx!.employeeId)
  else if (scope) rows = rows.filter((e) => scope.includes(e.branch_id))
  const q = (req.query.q as string | undefined)?.trim().toLowerCase()
  if (q) rows = rows.filter((e) => e.name.toLowerCase().includes(q) || (e.email ?? '').toLowerCase().includes(q))
  res.json(rows.map((r) => {
    const e: any = mapEmployee(r)
    const mem = db.prepare('SELECT role, status, scope_branch_ids FROM membership WHERE id = ? AND company_id = ?').get(r.membership_id, cid) as any
    e.role = mem?.role ?? 'employee'
    e.membershipStatus = mem?.status ?? 'active'
    e.scopeBranchIds = mem ? JSON.parse(mem.scope_branch_ids) : []
    const canWage = can(actorOf(req), 'wage.set', { branchId: r.branch_id })
    if (!canWage) { delete e.wageBasic; delete e.wageFixedAllowance; delete e.wageVariableAllowance }
    e.canSeeWage = canWage
    return e
  }))
})

/** Manual add (PRD §6.3 jalur B): create a pending membership + profile by email. */
employeesRouter.post('/employees', requireCompany, requireCap('employee.manage'), (req, res) => {
  const body = z.object({
    name: z.string().trim().min(1).max(120),
    email: z.string().email().max(254),
    branchId: z.string(),
    divisionId: z.string().optional(),
    role: z.enum(['employee', 'hr', 'branch_admin']).default('employee'),
    scopeBranchIds: z.array(z.string()).max(200).optional(),
    wageBasic: z.number().nonnegative().max(1e10).default(0),
    wageFixedAllowance: z.number().nonnegative().max(1e10).default(0),
    wageVariableAllowance: z.number().nonnegative().max(1e10).default(0),
  }).parse(req.body)
  const cid = req.ctx!.companyId!
  const actor = actorOf(req)
  if (!branchInCompany(cid, body.branchId)) return res.status(400).json({ error: 'invalid_branch', message: 'Cabang tidak ditemukan.' })
  if (!divisionInCompany(cid, body.divisionId)) return res.status(400).json({ error: 'invalid_division', message: 'Divisi tidak ditemukan.' })
  if (!can(actor, 'employee.manage', { branchId: body.branchId })) return res.status(403).json(FORBIDDEN.out_of_scope)
  if (body.role !== 'employee' && !isOwner(req)) return res.status(403).json(FORBIDDEN.role_requires_owner)
  if (isOwner(req) && body.scopeBranchIds && !allBranchesInCompany(cid, body.scopeBranchIds)) return res.status(400).json({ error: 'invalid_branch', message: 'Cakupan cabang tidak valid.' })
  if (touchesWage(body) && !can(actor, 'wage.set', { branchId: body.branchId })) return res.status(403).json(FORBIDDEN.forbidden_wage)
  const email = body.email.toLowerCase().trim()

  // Link to an existing global user if one already signed in with this email.
  const existing = db.prepare('SELECT * FROM user WHERE email = ?').get(email) as any
  const userId = existing?.id ?? null
  const dupe = db.prepare('SELECT id FROM membership WHERE company_id=? AND (user_id=? OR user_id=?)').get(cid, userId ?? '∅', `pending:${email}`)
  if (dupe) return res.status(409).json({ error: 'already_member', message: 'Email ini sudah terdaftar di perusahaan.' })
  const memId = id('mem')
  const empId = id('emp')
  const status = userId ? 'active' : 'pending'
  const scope = newMembershipScope(req, body.role, body.branchId, body.scopeBranchIds)

  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO membership (id, company_id, user_id, role, scope_branch_ids, scope_division_ids, status, created_at)
                VALUES (?,?,?,?,?,?,?,?)`).run(
      memId, cid, userId ?? `pending:${email}`, body.role, JSON.stringify(scope), '[]', status, now(),
    )
    db.prepare(`INSERT INTO employee_profile (id, company_id, membership_id, user_id, name, email, branch_id, division_id, wage_basic, wage_fixed_allowance, wage_variable_allowance, employment_status, created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?, 'active', ?)`).run(
      empId, cid, memId, userId, body.name, email, body.branchId, body.divisionId ?? null,
      body.wageBasic, body.wageFixedAllowance, body.wageVariableAllowance, now(),
    )
  })
  tx()
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: 'employee.create', target: empId, metadata: { email, role: body.role } })
  res.json(mapEmployee(db.prepare('SELECT * FROM employee_profile WHERE id = ?').get(empId)))
})

/** Bulk import (PRD §7.2.4). Rows are parsed client-side from CSV. Always role employee. */
employeesRouter.post('/employees/import', requireCompany, requireCap('employee.manage'), (req, res) => {
  const body = z.object({
    branchId: z.string(),
    divisionId: z.string().optional(),
    rows: z.array(z.object({
      name: z.string().trim().min(1).max(120),
      email: z.string().email().max(254),
      wageBasic: z.number().nonnegative().max(1e10).default(0),
      wageFixedAllowance: z.number().nonnegative().max(1e10).default(0),
    })).min(1).max(500),
  }).parse(req.body)
  const cid = req.ctx!.companyId!
  const actor = actorOf(req)
  if (!branchInCompany(cid, body.branchId)) return res.status(400).json({ error: 'invalid_branch', message: 'Cabang tidak ditemukan.' })
  if (!divisionInCompany(cid, body.divisionId)) return res.status(400).json({ error: 'invalid_division', message: 'Divisi tidak ditemukan.' })
  if (!can(actor, 'employee.manage', { branchId: body.branchId })) return res.status(403).json(FORBIDDEN.out_of_scope)
  if (body.rows.some(touchesWage) && !can(actor, 'wage.set', { branchId: body.branchId })) return res.status(403).json(FORBIDDEN.forbidden_wage)
  const scope = JSON.stringify(newMembershipScope(req, 'employee', body.branchId))
  let created = 0
  const skipped: string[] = []
  const tx = db.transaction(() => {
    for (const row of body.rows) {
      const email = row.email.toLowerCase().trim()
      const existingUser = db.prepare('SELECT id FROM user WHERE email = ?').get(email) as any
      const userId = existingUser?.id ?? null
      // skip if this email already has a membership in this company
      const dupe = db.prepare(`SELECT m.id FROM membership m WHERE m.company_id=? AND (m.user_id=? OR m.user_id=?)`).get(cid, userId ?? '∅', `pending:${email}`)
      if (dupe) { skipped.push(email); continue }
      const memId = id('mem'); const empId = id('emp')
      db.prepare(`INSERT INTO membership (id, company_id, user_id, role, scope_branch_ids, scope_division_ids, status, created_at) VALUES (?,?,?,?,?,?,?,?)`)
        .run(memId, cid, userId ?? `pending:${email}`, 'employee', scope, '[]', userId ? 'active' : 'pending', now())
      db.prepare(`INSERT INTO employee_profile (id, company_id, membership_id, user_id, name, email, branch_id, division_id, wage_basic, wage_fixed_allowance, wage_variable_allowance, employment_status, created_at)
                  VALUES (?,?,?,?,?,?,?,?,?,?,0,'active',?)`)
        .run(empId, cid, memId, userId, row.name, email, body.branchId, body.divisionId ?? null, row.wageBasic, row.wageFixedAllowance, now())
      created++
    }
  })
  tx()
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: 'employee.import', metadata: { created, skipped: skipped.length } })
  res.json({ created, skipped })
})

/** Load the target profile + membership and apply the "who may touch whom" rules. */
function loadTarget(req: Request): { cur: any; mem: any } | { status: number; body: unknown } {
  const cid = req.ctx!.companyId!
  const cur = db.prepare('SELECT * FROM employee_profile WHERE id=? AND company_id=?').get(req.params.id, cid) as any
  if (!cur) return { status: 404, body: { error: 'not_found' } }
  const mem = db.prepare('SELECT * FROM membership WHERE id=? AND company_id=?').get(cur.membership_id, cid) as any
  if (!mem) return { status: 404, body: { error: 'not_found' } }
  if (!can(actorOf(req), 'employee.manage', { branchId: cur.branch_id })) return { status: 403, body: FORBIDDEN.out_of_scope }
  if (mem.role === 'owner' && !isOwner(req)) return { status: 403, body: FORBIDDEN.cannot_modify_owner }
  if (!isOwner(req) && mem.role !== 'employee') return { status: 403, body: FORBIDDEN.forbidden_target_role }
  return { cur, mem }
}

employeesRouter.patch('/employees/:id', requireCompany, requireCap('employee.manage'), (req, res) => {
  const body = z.object({
    name: z.string().trim().min(1).max(120).optional(), branchId: z.string().optional(), divisionId: z.string().nullable().optional(),
    role: z.enum(['employee', 'hr', 'branch_admin']).optional(),
    scopeBranchIds: z.array(z.string()).max(200).optional(),
    employmentStatus: z.enum(['active', 'inactive']).optional(),
    wageBasic: z.number().nonnegative().max(1e10).optional(), wageFixedAllowance: z.number().nonnegative().max(1e10).optional(), wageVariableAllowance: z.number().nonnegative().max(1e10).optional(),
  }).parse(req.body)
  const cid = req.ctx!.companyId!
  const actor = actorOf(req)
  const t = loadTarget(req)
  if ('status' in t) return res.status(t.status).json(t.body)
  const { cur, mem } = t
  const owner = isOwner(req)
  const isSelf = mem.user_id === req.ctx!.userId

  const roleChanges = body.role !== undefined && body.role !== mem.role
  if (roleChanges && !owner) return res.status(403).json(FORBIDDEN.role_requires_owner)

  if (mem.role === 'owner') {
    // Another owner may fix name/branch/wage, but only the owner themself may
    // demote/deactivate — and never the last active owner.
    const demotes = roleChanges || body.employmentStatus === 'inactive'
    if (demotes || body.scopeBranchIds !== undefined) {
      if (!isSelf) return res.status(403).json(FORBIDDEN.cannot_modify_owner)
      if (demotes && activeOwnerCount(cid, mem.id) === 0) return res.status(409).json({ error: 'last_owner', message: 'Anda pemilik terakhir; tunjuk pemilik lain sebelum melepas peran ini.' })
    }
  }

  const newBranch = body.branchId ?? cur.branch_id
  if (body.branchId !== undefined && body.branchId !== cur.branch_id) {
    if (!branchInCompany(cid, body.branchId)) return res.status(400).json({ error: 'invalid_branch', message: 'Cabang tidak ditemukan.' })
    if (!can(actor, 'employee.manage', { branchId: body.branchId })) return res.status(403).json(FORBIDDEN.out_of_scope)
  }
  if (body.divisionId && !divisionInCompany(cid, body.divisionId)) return res.status(400).json({ error: 'invalid_division', message: 'Divisi tidak ditemukan.' })

  // Wage changes require wage.set (PRD §5.2).
  const wageTouched = body.wageBasic != null || body.wageFixedAllowance != null || body.wageVariableAllowance != null
  if (wageTouched && !can(actor, 'wage.set', { branchId: newBranch })) return res.status(403).json(FORBIDDEN.forbidden_wage)

  // Scope: owner-only. A non-owner's scopeBranchIds is ignored (they can only touch employees).
  let newScope: string | null = null
  if (owner && body.scopeBranchIds !== undefined) {
    if (!allBranchesInCompany(cid, body.scopeBranchIds)) return res.status(400).json({ error: 'invalid_branch', message: 'Cakupan cabang tidak valid.' })
    newScope = JSON.stringify(body.scopeBranchIds)
  } else if (owner && roleChanges && MANAGER_ROLES.has(body.role!)) {
    newScope = JSON.stringify([newBranch]) // promoted without an explicit scope → their own branch only
  }

  db.prepare(`UPDATE employee_profile SET name=?, branch_id=?, division_id=?, employment_status=?, wage_basic=?, wage_fixed_allowance=?, wage_variable_allowance=? WHERE id=? AND company_id=?`).run(
    body.name ?? cur.name, newBranch,
    body.divisionId === undefined ? cur.division_id : body.divisionId,
    body.employmentStatus ?? cur.employment_status,
    body.wageBasic ?? cur.wage_basic, body.wageFixedAllowance ?? cur.wage_fixed_allowance, body.wageVariableAllowance ?? cur.wage_variable_allowance,
    cur.id, cid,
  )
  if (roleChanges || newScope !== null || body.employmentStatus) {
    const pending = String(mem.user_id).startsWith('pending:')
    const newStatus = body.employmentStatus === 'inactive' ? 'disabled' : body.employmentStatus === 'active' ? (pending ? 'pending' : 'active') : mem.status
    db.prepare('UPDATE membership SET role=?, scope_branch_ids=?, status=? WHERE id=? AND company_id=?').run(
      body.role ?? mem.role, newScope ?? mem.scope_branch_ids, newStatus, mem.id, cid,
    )
  }
  audit({
    companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: wageTouched ? 'wage.set' : 'employee.update', target: cur.id,
    metadata: { role: roleChanges ? body.role : undefined, scope: newScope ? JSON.parse(newScope) : undefined, status: body.employmentStatus },
  })
  res.json(mapEmployee(db.prepare('SELECT * FROM employee_profile WHERE id = ?').get(cur.id)))
})

/** Admin-assisted password reset (no email infra; PRD auth is admin-managed).
 * Owner/Branch-admin sets/auto-generates a temporary password for an employee. */
employeesRouter.post('/employees/:id/reset-password', requireCompany, requireCap('employee.manage'), (req, res) => {
  const body = z.object({ newPassword: z.string().min(6).max(200).optional() }).parse(req.body)
  const cid = req.ctx!.companyId!
  const t = loadTarget(req)
  if ('status' in t) return res.status(t.status).json(t.body)
  const { cur: emp, mem } = t
  if (mem.role === 'owner') return res.status(403).json(FORBIDDEN.cannot_modify_owner) // owners change their own password
  if (!emp.user_id && (!mem?.user_id || String(mem.user_id).startsWith('pending:'))) {
    return res.status(409).json({ error: 'not_registered_yet' }) // belum punya akun (belum terima undangan)
  }
  const userId = emp.user_id ?? mem.user_id
  const user = db.prepare('SELECT email FROM user WHERE id=?').get(userId) as any
  if (!user || !config.isPasswordAllowed(user.email)) {
    return res.status(403).json({ error: 'password_auth_forbidden', message: 'Karyawan masuk via Google; reset password tidak berlaku.' })
  }
  const temp = body.newPassword ?? `Abs${token().slice(0, 6)}`
  db.prepare('UPDATE user SET password_hash=? WHERE id=?').run(hashPassword(temp), userId)
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: 'employee.password_reset', target: emp.id })
  res.json({ temporaryPassword: temp })
})

/** Permanently delete an employee — only when already deactivated (PRD §6.9 keeps
 * historical attendance rows; the membership + profile are removed). */
employeesRouter.delete('/employees/:id', requireCompany, requireCap('employee.manage'), (req, res) => {
  const cid = req.ctx!.companyId!
  const t = loadTarget(req)
  if ('status' in t) return res.status(t.status).json(t.body)
  const { cur, mem } = t
  if (mem.role === 'owner') return res.status(403).json(FORBIDDEN.cannot_modify_owner)
  if (cur.employment_status !== 'inactive') return res.status(409).json({ error: 'must_deactivate_first' })
  db.prepare('DELETE FROM employee_profile WHERE id=? AND company_id=?').run(cur.id, cid)
  db.prepare('DELETE FROM membership WHERE id=? AND company_id=?').run(cur.membership_id, cid)
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: 'employee.delete', target: cur.id })
  res.json({ ok: true })
})

/** Employee uploads their own profile photo so managers can recognise them (#3). */
employeesRouter.post('/me/profile-photo', requireCompany, LIMITS.profilePhoto, (req, res) => {
  const body = z.object({ photoData: z.string().min(10) }).parse(req.body)
  const employeeId = req.ctx!.employeeId
  if (!employeeId) return res.status(400).json({ error: 'no_employee_profile' })
  const check = checkImageDataUrl(body.photoData, PROFILE_PHOTO_MAX_BYTES)
  if (!check.ok) return res.status(400).json({ error: check.error, message: PHOTO_MESSAGE[check.error] })
  db.prepare('UPDATE employee_profile SET photo_data=? WHERE id=? AND company_id=?').run(body.photoData, employeeId, req.ctx!.companyId)
  res.json({ ok: true })
})

/**
 * Record (or withdraw) the signed-in employee's UU PDP consent. Location
 * consent is required before the first clock-in; photo consent is optional
 * (without it attendance photos are never stored). `false` withdraws.
 */
employeesRouter.post('/me/consent', requireCompany, (req, res) => {
  const body = z.object({ consentLocation: z.boolean(), consentPhoto: z.boolean() }).parse(req.body)
  const cid = req.ctx!.companyId!
  const employeeId = req.ctx!.employeeId
  if (!employeeId) return res.status(400).json({ error: 'no_employee_profile' })
  const cur = db.prepare('SELECT consent_location_at, consent_photo_at FROM employee_profile WHERE id=? AND company_id=?').get(employeeId, cid) as any
  if (!cur) return res.status(404).json({ error: 'not_found' })
  const at = now()
  const loc = body.consentLocation ? (cur.consent_location_at ?? at) : null
  const photo = body.consentPhoto ? (cur.consent_photo_at ?? at) : null
  db.prepare('UPDATE employee_profile SET consent_location_at=?, consent_photo_at=? WHERE id=? AND company_id=?').run(loc, photo, employeeId, cid)
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: 'consent.update', target: employeeId, metadata: { location: body.consentLocation, photo: body.consentPhoto } })
  res.json({ consentLocation: !!loc, consentPhoto: !!photo, consentLocationAt: loc, consentPhotoAt: photo })
})

// ---- Invites ----
employeesRouter.get('/invites', requireCompany, requireCap('employee.invite'), (req, res) => {
  const scope = scopeFilter(req)
  let rows = db.prepare('SELECT * FROM invite WHERE company_id = ? ORDER BY created_at DESC').all(req.ctx!.companyId) as any[]
  if (scope) rows = rows.filter((r) => scope.includes(r.branch_id))
  res.json(rows.map((r) => ({ id: r.id, branchId: r.branch_id, divisionId: r.division_id, role: r.role, token: r.token, maxUses: r.max_uses, usedCount: r.used_count, expiresAt: r.expires_at, scopeBranchIds: r.scope_branch_ids ? JSON.parse(r.scope_branch_ids) : null })))
})

employeesRouter.post('/invites', requireCompany, requireCap('employee.invite'), (req, res) => {
  const body = z.object({
    branchId: z.string(), divisionId: z.string().optional(),
    role: z.enum(['employee', 'hr', 'branch_admin']).default('employee'),
    scopeBranchIds: z.array(z.string()).max(200).optional(),
    maxUses: z.number().int().positive().max(500).default(1),
    expiresInDays: z.number().int().nonnegative().max(90).default(7), // 0 = langsung kedaluwarsa
    wageBasic: z.number().nonnegative().max(1e10).default(0),
    wageFixedAllowance: z.number().nonnegative().max(1e10).default(0),
  }).parse(req.body)
  const cid = req.ctx!.companyId!
  const actor = actorOf(req)
  if (!branchInCompany(cid, body.branchId)) return res.status(400).json({ error: 'invalid_branch', message: 'Cabang tidak ditemukan.' })
  if (!divisionInCompany(cid, body.divisionId)) return res.status(400).json({ error: 'invalid_division', message: 'Divisi tidak ditemukan.' })
  if (!can(actor, 'employee.invite', { branchId: body.branchId })) return res.status(403).json(FORBIDDEN.out_of_scope)
  if (body.role !== 'employee' && !isOwner(req)) return res.status(403).json(FORBIDDEN.role_requires_owner)
  if (touchesWage(body) && !can(actor, 'wage.set', { branchId: body.branchId })) return res.status(403).json(FORBIDDEN.forbidden_wage)
  let scope: string | null = null
  if (MANAGER_ROLES.has(body.role)) {
    const list = body.scopeBranchIds ?? [body.branchId]
    if (!allBranchesInCompany(cid, list)) return res.status(400).json({ error: 'invalid_branch', message: 'Cakupan cabang tidak valid.' })
    scope = JSON.stringify(list)
  }
  const tk = token()
  const expires = new Date(Date.now() + body.expiresInDays * 864e5).toISOString()
  const iid = id('inv')
  db.prepare(`INSERT INTO invite (id, company_id, branch_id, division_id, role, token, max_uses, used_count, expires_at, created_by, created_at, wage_basic, wage_fixed_allowance, scope_branch_ids)
              VALUES (?,?,?,?,?,?,?,0,?,?,?,?,?,?)`).run(
    iid, cid, body.branchId, body.divisionId ?? null, body.role, tk, body.maxUses, expires, req.ctx!.userId, now(), body.wageBasic, body.wageFixedAllowance, scope,
  )
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: 'employee.invite', target: iid, metadata: { role: body.role } })
  res.json({ id: iid, token: tk, expiresAt: expires })
})

employeesRouter.delete('/invites/:id', requireCompany, requireCap('employee.invite'), (req, res) => {
  const cid = req.ctx!.companyId!
  const inv = db.prepare('SELECT * FROM invite WHERE id=? AND company_id=?').get(req.params.id, cid) as any
  if (!inv) return res.status(404).json({ error: 'not_found' })
  if (!can(actorOf(req), 'employee.invite', { branchId: inv.branch_id })) return res.status(403).json(FORBIDDEN.out_of_scope)
  db.prepare('DELETE FROM invite WHERE id=? AND company_id=?').run(inv.id, cid)
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: 'employee.invite_revoke', target: inv.id })
  res.json({ ok: true })
})

/** Public info for the accept screen (no auth needed to view). */
employeesRouter.get('/invites/token/:token', (req, res) => {
  const inv = db.prepare('SELECT * FROM invite WHERE token = ?').get(req.params.token) as any
  if (!inv) return res.status(404).json({ error: 'invalid' })
  const expired = inv.expires_at < now() || inv.used_count >= inv.max_uses
  const company = db.prepare('SELECT display_name FROM company WHERE id = ?').get(inv.company_id) as any
  const branch = db.prepare('SELECT name FROM branch WHERE id = ? AND company_id = ?').get(inv.branch_id, inv.company_id) as any
  res.json({ valid: !expired, companyName: company?.display_name, branchName: branch?.name, role: inv.role })
})

/**
 * Accept invite — requires sign-in + explicit LOCATION consent (UU PDP, PRD §6.3).
 * Photo consent is opt-in: without it attendance photos are simply never stored.
 */
employeesRouter.post('/invites/token/:token/accept', LIMITS.inviteAccept, requireAuth, (req, res) => {
  const body = z.object({ consentLocation: z.boolean(), consentPhoto: z.boolean().default(false) }).parse(req.body)
  if (!body.consentLocation) return res.status(400).json({ error: 'consent_required', message: 'Izin lokasi diperlukan untuk absensi.' })
  const inv = db.prepare('SELECT * FROM invite WHERE token = ?').get(req.params.token) as any
  if (!inv || inv.expires_at < now() || inv.used_count >= inv.max_uses) return res.status(400).json({ error: 'invalid_or_expired' })
  if (!branchInCompany(inv.company_id, inv.branch_id)) return res.status(400).json({ error: 'invalid_or_expired' })

  const userId = req.ctx!.userId
  const user = db.prepare('SELECT * FROM user WHERE id = ?').get(userId) as any
  const already = db.prepare('SELECT id FROM membership WHERE company_id = ? AND (user_id = ? OR user_id = ?)').get(inv.company_id, userId, `pending:${user.email}`)
  if (already) return res.status(409).json({ error: 'already_member' })

  const role = (['employee', 'hr', 'branch_admin'] as const).includes(inv.role) ? inv.role : 'employee'
  const scope = MANAGER_ROLES.has(role) ? (inv.scope_branch_ids ?? JSON.stringify([inv.branch_id])) : '[]'
  const memId = id('mem')
  const empId = id('emp')
  const at = now()
  const tx = db.transaction(() => {
    const used = db.prepare('UPDATE invite SET used_count = used_count + 1 WHERE id = ? AND used_count < max_uses').run(inv.id)
    if (used.changes !== 1) throw new Error('invite_exhausted')
    db.prepare(`INSERT INTO membership (id, company_id, user_id, role, scope_branch_ids, scope_division_ids, status, created_at)
                VALUES (?,?,?,?,?,?, 'active', ?)`).run(memId, inv.company_id, userId, role, scope, '[]', at)
    db.prepare(`INSERT INTO employee_profile (id, company_id, membership_id, user_id, name, email, branch_id, division_id, wage_basic, wage_fixed_allowance, wage_variable_allowance, employment_status, consent_location_at, consent_photo_at, created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,0, 'active', ?, ?, ?)`).run(
      empId, inv.company_id, memId, userId, user.name, user.email, inv.branch_id, inv.division_id,
      inv.wage_basic, inv.wage_fixed_allowance, at, body.consentPhoto ? at : null, at,
    )
  })
  try {
    tx()
  } catch (e) {
    if (e instanceof Error && e.message === 'invite_exhausted') return res.status(400).json({ error: 'invalid_or_expired' })
    throw e
  }
  // Make the joined company the active tenant so the new employee lands in the app
  // (not the owner onboarding wizard).
  setSessionCompany(req.ctx!.sessionId, inv.company_id)
  audit({ companyId: inv.company_id, actorType: 'user', actorId: userId, action: 'invite.accept', target: empId, metadata: { consentPhoto: body.consentPhoto } })
  res.json({ companyId: inv.company_id })
})
