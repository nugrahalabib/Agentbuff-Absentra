import { Router } from 'express'
import { z } from 'zod'
import { db, now } from '../lib/db.js'
import { id, token } from '../lib/ids.js'
import { mapEmployee } from '../lib/map.js'
import { requireAuth, requireCompany, requireCap, setSessionCompany } from '../lib/context.js'
import { can } from '../domain/rbac.js'
import { hashPassword } from '../lib/password.js'
import { audit } from '../lib/audit.js'
import { config } from '../lib/config.js'

export const employeesRouter = Router()

function scopeFilter(req: any): string[] | null {
  const m = req.ctx.actor.membership
  return m.scopeBranchIds.length > 0 ? m.scopeBranchIds : null
}

// ---- Employees ----
employeesRouter.get('/employees', requireCompany, requireCap('employee.view'), (req, res) => {
  const cid = req.ctx!.companyId!
  const scope = scopeFilter(req)
  let rows = db.prepare('SELECT * FROM employee_profile WHERE company_id = ? ORDER BY name').all(cid) as any[]
  // Plain employees (employee.view = 'self') may only see their own record.
  if (req.ctx!.actor!.membership.role === 'employee') rows = rows.filter((e) => e.id === req.ctx!.employeeId)
  else if (scope) rows = rows.filter((e) => scope.includes(e.branch_id))
  const q = (req.query.q as string | undefined)?.trim().toLowerCase()
  if (q) rows = rows.filter((e) => e.name.toLowerCase().includes(q) || (e.email ?? '').toLowerCase().includes(q))
  const canWage = can(req.ctx!.actor!, 'wage.set')
  res.json(rows.map((r) => {
    const e: any = mapEmployee(r)
    const mem = db.prepare('SELECT role, status FROM membership WHERE id = ?').get(r.membership_id) as any
    e.role = mem?.role ?? 'employee'
    e.membershipStatus = mem?.status ?? 'active'
    if (!canWage) { delete e.wageBasic; delete e.wageFixedAllowance; delete e.wageVariableAllowance }
    e.canSeeWage = canWage
    return e
  }))
})

/** Manual add (PRD §6.3 jalur B): create a pending membership + profile by email. */
employeesRouter.post('/employees', requireCompany, requireCap('employee.manage'), (req, res) => {
  const body = z.object({
    name: z.string().min(1),
    email: z.string().email(),
    branchId: z.string(),
    divisionId: z.string().optional(),
    role: z.enum(['employee', 'hr', 'branch_admin']).default('employee'),
    scopeBranchIds: z.array(z.string()).default([]),
    wageBasic: z.number().nonnegative().default(0),
    wageFixedAllowance: z.number().nonnegative().default(0),
    wageVariableAllowance: z.number().nonnegative().default(0),
  }).parse(req.body)
  const cid = req.ctx!.companyId!
  const email = body.email.toLowerCase().trim()

  // Link to an existing global user if one already signed in with this email.
  const existing = db.prepare('SELECT * FROM user WHERE email = ?').get(email) as any
  const userId = existing?.id ?? null
  const memId = id('mem')
  const empId = id('emp')
  const status = userId ? 'active' : 'pending'

  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO membership (id, company_id, user_id, role, scope_branch_ids, scope_division_ids, status, created_at)
                VALUES (?,?,?,?,?,?,?,?)`).run(
      memId, cid, userId ?? `pending:${email}`, body.role, JSON.stringify(body.scopeBranchIds), '[]', status, now(),
    )
    db.prepare(`INSERT INTO employee_profile (id, company_id, membership_id, user_id, name, email, branch_id, division_id, wage_basic, wage_fixed_allowance, wage_variable_allowance, employment_status, created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?, 'active', ?)`).run(
      empId, cid, memId, userId, body.name, email, body.branchId, body.divisionId ?? null,
      body.wageBasic, body.wageFixedAllowance, body.wageVariableAllowance, now(),
    )
  })
  tx()
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: 'employee.create', target: empId, metadata: { email } })
  res.json(mapEmployee(db.prepare('SELECT * FROM employee_profile WHERE id = ?').get(empId)))
})

/** Bulk import (PRD §7.2.4). Rows are parsed client-side from CSV. */
employeesRouter.post('/employees/import', requireCompany, requireCap('employee.manage'), (req, res) => {
  const body = z.object({
    branchId: z.string(),
    divisionId: z.string().optional(),
    rows: z.array(z.object({
      name: z.string().min(1),
      email: z.string().email(),
      wageBasic: z.number().nonnegative().default(0),
      wageFixedAllowance: z.number().nonnegative().default(0),
    })).min(1).max(500),
  }).parse(req.body)
  const cid = req.ctx!.companyId!
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
        .run(memId, cid, userId ?? `pending:${email}`, 'employee', '[]', '[]', userId ? 'active' : 'pending', now())
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

employeesRouter.patch('/employees/:id', requireCompany, requireCap('employee.manage'), (req, res) => {
  const body = z.object({
    name: z.string().optional(), branchId: z.string().optional(), divisionId: z.string().nullable().optional(),
    role: z.enum(['employee', 'hr', 'branch_admin', 'owner']).optional(),
    scopeBranchIds: z.array(z.string()).optional(),
    employmentStatus: z.enum(['active', 'inactive']).optional(),
    wageBasic: z.number().nonnegative().optional(), wageFixedAllowance: z.number().nonnegative().optional(), wageVariableAllowance: z.number().nonnegative().optional(),
  }).parse(req.body)
  const cid = req.ctx!.companyId!
  const cur = db.prepare('SELECT * FROM employee_profile WHERE id=? AND company_id=?').get(req.params.id, cid) as any
  if (!cur) return res.status(404).json({ error: 'not_found' })

  // Wage changes require wage.set (PRD §5.2).
  const touchesWage = body.wageBasic != null || body.wageFixedAllowance != null || body.wageVariableAllowance != null
  if (touchesWage && !can(req.ctx!.actor!, 'wage.set')) return res.status(403).json({ error: 'forbidden_wage' })

  db.prepare(`UPDATE employee_profile SET name=?, branch_id=?, division_id=?, employment_status=?, wage_basic=?, wage_fixed_allowance=?, wage_variable_allowance=? WHERE id=?`).run(
    body.name ?? cur.name, body.branchId ?? cur.branch_id,
    body.divisionId === undefined ? cur.division_id : body.divisionId,
    body.employmentStatus ?? cur.employment_status,
    body.wageBasic ?? cur.wage_basic, body.wageFixedAllowance ?? cur.wage_fixed_allowance, body.wageVariableAllowance ?? cur.wage_variable_allowance,
    cur.id,
  )
  if (body.role || body.scopeBranchIds || body.employmentStatus) {
    const mem = db.prepare('SELECT * FROM membership WHERE id=?').get(cur.membership_id) as any
    const newStatus = body.employmentStatus === 'inactive' ? 'disabled' : body.employmentStatus === 'active' ? 'active' : mem.status
    db.prepare('UPDATE membership SET role=?, scope_branch_ids=?, status=? WHERE id=?').run(
      body.role ?? mem.role,
      body.scopeBranchIds ? JSON.stringify(body.scopeBranchIds) : mem.scope_branch_ids,
      newStatus,
      mem.id,
    )
  }
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: touchesWage ? 'wage.set' : 'employee.update', target: cur.id })
  res.json(mapEmployee(db.prepare('SELECT * FROM employee_profile WHERE id = ?').get(cur.id)))
})

/** Admin-assisted password reset (no email infra; PRD auth is admin-managed).
 * Owner/Branch-admin sets/auto-generates a temporary password for an employee. */
employeesRouter.post('/employees/:id/reset-password', requireCompany, requireCap('employee.manage'), (req, res) => {
  const body = z.object({ newPassword: z.string().min(6).optional() }).parse(req.body)
  const cid = req.ctx!.companyId!
  const emp = db.prepare('SELECT * FROM employee_profile WHERE id=? AND company_id=?').get(req.params.id, cid) as any
  if (!emp) return res.status(404).json({ error: 'not_found' })
  const scope = scopeFilter(req)
  if (scope && !scope.includes(emp.branch_id)) return res.status(403).json({ error: 'out_of_scope' })
  const mem = db.prepare('SELECT user_id FROM membership WHERE id=?').get(emp.membership_id) as any
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
  const cur = db.prepare('SELECT * FROM employee_profile WHERE id=? AND company_id=?').get(req.params.id, cid) as any
  if (!cur) return res.status(404).json({ error: 'not_found' })
  if (cur.employment_status !== 'inactive') return res.status(409).json({ error: 'must_deactivate_first' })
  db.prepare('DELETE FROM employee_profile WHERE id=?').run(cur.id)
  db.prepare('DELETE FROM membership WHERE id=?').run(cur.membership_id)
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: 'employee.delete', target: cur.id })
  res.json({ ok: true })
})

/** Employee uploads their own profile photo so managers can recognise them (#3). */
employeesRouter.post('/me/profile-photo', requireCompany, (req, res) => {
  const body = z.object({ photoData: z.string().min(10) }).parse(req.body)
  const employeeId = req.ctx!.employeeId
  if (!employeeId) return res.status(400).json({ error: 'no_employee_profile' })
  db.prepare('UPDATE employee_profile SET photo_data=? WHERE id=? AND company_id=?').run(body.photoData, employeeId, req.ctx!.companyId)
  res.json({ ok: true })
})

// ---- Invites ----
employeesRouter.get('/invites', requireCompany, requireCap('employee.invite'), (req, res) => {
  const rows = db.prepare('SELECT * FROM invite WHERE company_id = ? ORDER BY created_at DESC').all(req.ctx!.companyId) as any[]
  res.json(rows.map((r) => ({ id: r.id, branchId: r.branch_id, divisionId: r.division_id, role: r.role, token: r.token, maxUses: r.max_uses, usedCount: r.used_count, expiresAt: r.expires_at })))
})

employeesRouter.post('/invites', requireCompany, requireCap('employee.invite'), (req, res) => {
  const body = z.object({
    branchId: z.string(), divisionId: z.string().optional(),
    role: z.enum(['employee', 'hr', 'branch_admin']).default('employee'),
    maxUses: z.number().int().positive().default(1),
    expiresInDays: z.number().int().nonnegative().default(7), // 0 = langsung kedaluwarsa
    wageBasic: z.number().nonnegative().default(0),
    wageFixedAllowance: z.number().nonnegative().default(0),
  }).parse(req.body)
  const cid = req.ctx!.companyId!
  const tk = token()
  const expires = new Date(Date.now() + body.expiresInDays * 864e5).toISOString()
  const iid = id('inv')
  db.prepare(`INSERT INTO invite (id, company_id, branch_id, division_id, role, token, max_uses, used_count, expires_at, created_by, created_at, wage_basic, wage_fixed_allowance)
              VALUES (?,?,?,?,?,?,?,0,?,?,?,?,?)`).run(
    iid, cid, body.branchId, body.divisionId ?? null, body.role, tk, body.maxUses, expires, req.ctx!.userId, now(), body.wageBasic, body.wageFixedAllowance,
  )
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: 'employee.invite', target: iid })
  res.json({ id: iid, token: tk, expiresAt: expires })
})

employeesRouter.delete('/invites/:id', requireCompany, requireCap('employee.invite'), (req, res) => {
  db.prepare('DELETE FROM invite WHERE id=? AND company_id=?').run(req.params.id, req.ctx!.companyId)
  res.json({ ok: true })
})

/** Public info for the accept screen (no auth needed to view). */
employeesRouter.get('/invites/token/:token', (req, res) => {
  const inv = db.prepare('SELECT * FROM invite WHERE token = ?').get(req.params.token) as any
  if (!inv) return res.status(404).json({ error: 'invalid' })
  const expired = inv.expires_at < now() || inv.used_count >= inv.max_uses
  const company = db.prepare('SELECT display_name FROM company WHERE id = ?').get(inv.company_id) as any
  const branch = db.prepare('SELECT name FROM branch WHERE id = ?').get(inv.branch_id) as any
  res.json({ valid: !expired, companyName: company?.display_name, branchName: branch?.name, role: inv.role })
})

/** Accept invite — requires sign-in + explicit consent (PDP, PRD §6.3). */
employeesRouter.post('/invites/token/:token/accept', requireAuth, (req, res) => {
  const body = z.object({ consentLocation: z.boolean(), consentPhoto: z.boolean() }).parse(req.body)
  if (!body.consentLocation || !body.consentPhoto) return res.status(400).json({ error: 'consent_required' })
  const inv = db.prepare('SELECT * FROM invite WHERE token = ?').get(req.params.token) as any
  if (!inv || inv.expires_at < now() || inv.used_count >= inv.max_uses) return res.status(400).json({ error: 'invalid_or_expired' })

  const userId = req.ctx!.userId
  const user = db.prepare('SELECT * FROM user WHERE id = ?').get(userId) as any
  const already = db.prepare('SELECT id FROM membership WHERE company_id = ? AND user_id = ?').get(inv.company_id, userId)
  if (already) return res.status(409).json({ error: 'already_member' })

  const memId = id('mem')
  const empId = id('emp')
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO membership (id, company_id, user_id, role, scope_branch_ids, scope_division_ids, status, created_at)
                VALUES (?,?,?,?,?,?, 'active', ?)`).run(memId, inv.company_id, userId, inv.role, '[]', '[]', now())
    db.prepare(`INSERT INTO employee_profile (id, company_id, membership_id, user_id, name, email, branch_id, division_id, wage_basic, wage_fixed_allowance, wage_variable_allowance, employment_status, consent_location_at, consent_photo_at, created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,0, 'active', ?, ?, ?)`).run(
      empId, inv.company_id, memId, userId, user.name, user.email, inv.branch_id, inv.division_id,
      inv.wage_basic, inv.wage_fixed_allowance, now(), now(), now(),
    )
    db.prepare('UPDATE invite SET used_count = used_count + 1 WHERE id = ?').run(inv.id)
  })
  tx()
  // Make the joined company the active tenant so the new employee lands in the app
  // (not the owner onboarding wizard).
  setSessionCompany(req.ctx!.sessionId, inv.company_id)
  audit({ companyId: inv.company_id, actorType: 'user', actorId: userId, action: 'invite.accept', target: empId })
  res.json({ companyId: inv.company_id })
})
