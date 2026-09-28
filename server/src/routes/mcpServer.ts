/**
 * MCP server (PRD §7.5) — Streamable HTTP + JSON-RPC 2.0 single endpoint.
 *
 * Thin adapter over the SAME Core data + the SAME `can()` authorization used by
 * the REST/UI layer (PRD §4.9, §5.3 — no parallel access path for agents). Every
 * call is:
 *   • bound to the connection's company_id (tenant isolation),
 *   • gated by the connection's MCP scope subset (least-privilege) AND `can()`,
 *   • narrowed to the connection's branch scope (if any),
 *   • audited (actor_type=agent, source=mcp, PII redacted),
 *   • rate-limited per connection,
 *   • for writes: requires human-in-the-loop confirmation (confirm:true), and
 *     resolves ambiguous references via elicitation.
 *
 * Primitives (PRD §7.5.6): Tools (`domain.action`), Resources (read-only,
 * `absentra://…`), Prompts (parameterized workflow templates so an agent knows
 * the correct end-to-end flow).
 */
import { Router } from 'express'
import { z } from 'zod'
import { db, now } from '../lib/db.js'
import { id, token } from '../lib/ids.js'
import { audit } from '../lib/audit.js'
import { config } from '../lib/config.js'
import { can, type Actor, type Capability } from '../domain/rbac.js'
import { computeRecapRow, type OvertimeBlock } from '../domain/payroll.js'
import { mapPolicy } from '../lib/map.js'
import { sha256 } from '../lib/mcpKoneksi.js'
import { companyOpen } from '../lib/agentbuffGate.js'

export const mcpServerRouter = Router()

const RATE_LIMIT = 20 // calls per minute per connection (PRD §7.5.7)
const buckets = new Map<string, { count: number; resetAt: number }>()
function rateLimited(connId: string): boolean {
  const nowMs = Date.now()
  const b = buckets.get(connId)
  if (!b || b.resetAt < nowMs) { buckets.set(connId, { count: 1, resetAt: nowMs + 60_000 }); return false }
  b.count++
  return b.count > RATE_LIMIT
}

interface Conn { id: string; companyId: string; scopes: string[]; scopeBranchIds: string[] }
function resolveConn(req: any): Conn | null {
  const auth = String(req.headers.authorization ?? '')
  const m = auth.match(/^Bearer\s+(.+)$/i)
  if (!m) return null
  const row = db.prepare("SELECT * FROM mcp_connection WHERE token_hash=? AND status='active'").get(sha256(m[1])) as any
  if (!row) return null
  db.prepare('UPDATE mcp_connection SET last_used_at=? WHERE id=?').run(now(), row.id)
  return { id: row.id, companyId: row.company_id, scopes: JSON.parse(row.scopes), scopeBranchIds: JSON.parse(row.scope_branch_ids) }
}

/**
 * Synthesize the authorizing principal as an Owner actor (only Owners hold
 * `mcp.connection.manage`, so a connection always carries Owner authority),
 * narrowed by the connection's branch scope. The MCP scope subset is the real
 * limiter and is checked separately — this keeps a single `can()` path.
 */
function connActor(conn: Conn): Actor {
  return {
    membership: { id: 'mcp', companyId: conn.companyId, userId: `agent:${conn.id}`, role: 'owner', scopeBranchIds: conn.scopeBranchIds, scopeDivisionIds: [], status: 'active' },
    employeeId: undefined,
  }
}
const inBranchScope = (conn: Conn, branchId: string | null | undefined) =>
  conn.scopeBranchIds.length === 0 || (branchId != null && conn.scopeBranchIds.includes(branchId))

const rpcErr = (id: any, code: number, message: string, data?: any) => ({ jsonrpc: '2.0', id, error: { code, message, data } })
const rpcOk = (id: any, result: any) => ({ jsonrpc: '2.0', id, result })

// ---- date helpers (UTC-based, mirror the REST routes) ----
function daysBetween(a: string, b: string): string[] {
  const out: string[] = []; const [sy, sm, sd] = a.split('-').map(Number); const [ey, em, ed] = b.split('-').map(Number)
  const d = new Date(Date.UTC(sy, sm - 1, sd)); const end = new Date(Date.UTC(ey, em - 1, ed))
  while (d <= end) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1) }
  return out
}
const dow = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay() }
const todayJkt = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())

// ---- CSV + time helpers (mirror web/src/lib/exporters.ts) ----
const csvEscape = (v: any) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
const toCsv = (header: string[], rows: any[][]) => [header.map(csvEscape).join(','), ...rows.map((r) => r.map(csvEscape).join(','))].join('\n')
const fmtTimeTz = (iso: string | null | undefined, tz: string) => iso ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(new Date(iso)) : ''
const companyTz = (cid: string) => (db.prepare('SELECT timezone FROM company WHERE id=?').get(cid) as any)?.timezone ?? 'Asia/Jakarta'

/** Convert Zod schema → JSON Schema for tools/list (agents need real parameter docs). */
function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, any> {
  const def: any = (schema as any)._def
  const typeName: string = def?.typeName ?? ''
  if (typeName === 'ZodObject') {
    const shape = typeof def.shape === 'function' ? def.shape() : def.shape
    const properties: Record<string, any> = {}
    const required: string[] = []
    for (const [key, val] of Object.entries(shape) as [string, z.ZodTypeAny][]) {
      properties[key] = zodToJsonSchema(val)
      let cur: any = val
      let optional = false
      while (cur?._def) {
        const tn = cur._def.typeName
        if (tn === 'ZodOptional' || tn === 'ZodDefault') { optional = true; cur = cur._def.innerType; continue }
        break
      }
      if (!optional) required.push(key)
    }
    return { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false }
  }
  if (typeName === 'ZodOptional' || typeName === 'ZodDefault') return zodToJsonSchema(def.innerType)
  if (typeName === 'ZodString') {
    const out: any = { type: 'string' }
    for (const c of def.checks ?? []) {
      if (c.kind === 'email') out.format = 'email'
      if (c.kind === 'min') out.minLength = c.value
      if (c.kind === 'regex') out.pattern = String(c.regex).slice(1, -1)
    }
    return out
  }
  if (typeName === 'ZodNumber') {
    const out: any = { type: 'number' }
    for (const c of def.checks ?? []) {
      if (c.kind === 'int') out.type = 'integer'
      if (c.kind === 'min') { out.minimum = c.value; if (c.inclusive === false) out.exclusiveMinimum = c.value }
      if (c.kind === 'max') { out.maximum = c.value }
    }
    return out
  }
  if (typeName === 'ZodBoolean') return { type: 'boolean' }
  if (typeName === 'ZodEnum') return { type: 'string', enum: def.values }
  if (typeName === 'ZodArray') return { type: 'array', items: zodToJsonSchema(def.type) }
  if (typeName === 'ZodLiteral') return { const: def.value }
  return { type: 'object' }
}

/** MCP content wrapper — keep original fields for existing clients/tests. */
function mcpToolResult(data: any) {
  if (data == null) return { content: [{ type: 'text', text: 'null' }] }
  return {
    content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
    ...data,
  }
}

/** Shared payroll computation (PP 35/2021) — reused by payroll.recap & payroll.export. */
function buildPayrollRows(cid: string, conn: Conn, periodStart: string, periodEnd: string, branchId?: string) {
  const company = db.prepare('SELECT * FROM company WHERE id=?').get(cid) as any
  const policy = mapPolicy(db.prepare('SELECT * FROM policy WHERE company_id=?').get(cid))
  const period = new Set(daysBetween(periodStart, periodEnd))
  let emps = db.prepare('SELECT * FROM employee_profile WHERE company_id=?').all(cid) as any[]
  if (branchId) emps = emps.filter((e) => e.branch_id === branchId)
  emps = emps.filter((e) => inBranchScope(conn, e.branch_id))
  return emps.map((e) => {
    const recs = (db.prepare('SELECT * FROM attendance_record WHERE company_id=? AND employee_id=?').all(cid, e.id) as any[]).filter((r) => period.has(r.work_date))
    const assigned = (db.prepare('SELECT * FROM shift_assignment WHERE company_id=? AND employee_id=?').all(cid, e.id) as any[]).filter((a) => period.has(a.work_date))
    const recordedDates = new Set(recs.map((r) => r.work_date))
    const approvedLeaveDates = new Set((db.prepare(`SELECT * FROM leave_request WHERE company_id=? AND employee_id=? AND status='approved'`).all(cid, e.id) as any[]).flatMap((l) => daysBetween(l.date_start, l.date_end)))
    const overtimeBlocks: OvertimeBlock[] = (db.prepare(`SELECT * FROM overtime_request WHERE company_id=? AND employee_id=? AND status='approved'`).all(cid, e.id) as any[])
      .filter((o) => period.has(o.work_date)).map((o) => ({ workDate: o.work_date, hours: o.hours, dayType: o.day_type }))
    return computeRecapRow({
      employeeId: e.id, name: e.name,
      wageBasic: e.wage_basic, wageFixedAllowance: e.wage_fixed_allowance, wageVariableAllowance: e.wage_variable_allowance,
      includeVariable: e.wage_variable_allowance > 0, workweek: company.workweek_type,
      presentDays: recs.length, lateMinutesTotal: recs.reduce((s, r) => s + r.late_minutes, 0),
      absentDays: assigned.filter((a) => !recordedDates.has(a.work_date) && !approvedLeaveDates.has(a.work_date)).length,
      leaveDays: [...approvedLeaveDates].filter((d) => period.has(d)).length, overtimeBlocks, policy,
    })
  })
}

// ---- reference resolvers (elicitation on ambiguity, PRD §7.5.6) ----
type Resolved = { status: 'not_found'; message: string } | { status: 'needs_clarification'; candidates: any[] } | { one: any }
function resolveOne(cid: string, table: 'employee_profile' | 'branch' | 'division' | 'shift_template', ref: string, label: string): Resolved {
  const byId = db.prepare(`SELECT * FROM ${table} WHERE company_id=? AND id=?`).get(cid, ref) as any
  if (byId) return { one: byId }
  const rows = db.prepare(`SELECT * FROM ${table} WHERE company_id=? AND name LIKE ?`).all(cid, `%${ref}%`) as any[]
  if (rows.length === 0) return { status: 'not_found', message: `${label} "${ref}" tidak ditemukan` }
  if (rows.length > 1) return { status: 'needs_clarification', candidates: rows.map((r) => ({ id: r.id, name: r.name, branchId: r.branch_id })) }
  return { one: rows[0] }
}

// ---- scope catalog (least-privilege; owners grant a subset per connection) ----
// Lives in lib/mcpKoneksi.ts (MCP_SCOPES) so connection issuance (UI + AgentBuff
// auto-connect) shares one list. Every tool's `scope` below must be in it.

interface ToolCtx { args: any; cid: string; conn: Conn; actor: Actor; auditCall: (action: string, meta?: any) => void; confirmOr: (summary: string, fn: () => any) => any }
interface Tool { name: string; description: string; scope: string; capability: Capability; write: boolean; schema: z.ZodTypeAny; run: (c: ToolCtx) => any }

const TOOLS: Tool[] = [
  // ============ READS ============
  { name: 'company.get', description: 'Profil perusahaan aktif (zona waktu, tipe minggu kerja).', scope: 'org:read', capability: 'dashboard.view', write: false,
    schema: z.object({}),
    run: ({ cid }) => { const c = db.prepare('SELECT id, display_name, business_type, timezone, workweek_type FROM company WHERE id=?').get(cid) as any; return { company: c } } },

  { name: 'branch.list', description: 'Daftar cabang + geofence.', scope: 'org:read', capability: 'attendance.view', write: false,
    schema: z.object({}),
    run: ({ cid, conn }) => {
      let rows = db.prepare("SELECT * FROM branch WHERE company_id=? AND status='active' ORDER BY created_at").all(cid) as any[]
      rows = rows.filter((b) => inBranchScope(conn, b.id))
      return { branches: rows.map((b) => { const g = db.prepare('SELECT * FROM geofence WHERE company_id=? AND branch_id=?').get(cid, b.id) as any; return { id: b.id, name: b.name, lat: b.lat, long: b.long, radiusM: g?.radius_m, type: g?.type } }) }
    } },

  { name: 'division.list', description: 'Daftar divisi.', scope: 'org:read', capability: 'attendance.view', write: false,
    schema: z.object({}),
    run: ({ cid }) => ({ divisions: (db.prepare('SELECT id, name FROM division WHERE company_id=? ORDER BY name').all(cid) as any[]) }) },

  { name: 'employee.list', description: 'Daftar karyawan (nama, cabang, status). Upah hanya jika scope mengizinkan.', scope: 'employee:read', capability: 'employee.view', write: false,
    schema: z.object({ branchId: z.string().optional(), q: z.string().optional() }),
    run: ({ cid, conn, args }) => {
      let rows = db.prepare('SELECT * FROM employee_profile WHERE company_id=? ORDER BY name').all(cid) as any[]
      rows = rows.filter((e) => inBranchScope(conn, e.branch_id))
      if (args.branchId) rows = rows.filter((e) => e.branch_id === args.branchId)
      if (args.q) { const q = String(args.q).toLowerCase(); rows = rows.filter((e) => e.name.toLowerCase().includes(q) || (e.email ?? '').toLowerCase().includes(q)) }
      return { employees: rows.map((e) => ({ id: e.id, name: e.name, branchId: e.branch_id, divisionId: e.division_id, employmentStatus: e.employment_status })) }
    } },

  { name: 'employee.search', description: 'Cari karyawan by nama/email (alias employee.list dengan q).', scope: 'employee:read', capability: 'employee.view', write: false,
    schema: z.object({ q: z.string().min(1), branchId: z.string().optional() }),
    run: ({ cid, conn, args }) => {
      const q = String(args.q).toLowerCase()
      let rows = db.prepare('SELECT * FROM employee_profile WHERE company_id=? ORDER BY name').all(cid) as any[]
      rows = rows.filter((e) => inBranchScope(conn, e.branch_id))
      if (args.branchId) rows = rows.filter((e) => e.branch_id === args.branchId)
      rows = rows.filter((e) => e.name.toLowerCase().includes(q) || (e.email ?? '').toLowerCase().includes(q))
      return { employees: rows.map((e) => ({ id: e.id, name: e.name, email: e.email, branchId: e.branch_id, employmentStatus: e.employment_status })) }
    } },

  { name: 'attendance.list', description: 'Daftar rekam kehadiran pada rentang tanggal (opsional filter cabang/karyawan).', scope: 'attendance:read', capability: 'attendance.view', write: false,
    schema: z.object({ from: z.string(), to: z.string(), branchId: z.string().optional(), employeeId: z.string().optional() }),
    run: ({ cid, conn, args, auditCall }) => {
      let rows = db.prepare('SELECT * FROM attendance_record WHERE company_id=? AND work_date>=? AND work_date<=? ORDER BY work_date DESC').all(cid, args.from, args.to) as any[]
      if (args.branchId) rows = rows.filter((r) => r.branch_id === args.branchId)
      if (args.employeeId) rows = rows.filter((r) => r.employee_id === args.employeeId)
      rows = rows.filter((r) => inBranchScope(conn, r.branch_id))
      auditCall('mcp.attendance.list', { period: `${args.from}..${args.to}`, rows: rows.length })
      return {
        records: rows.map((r) => ({
          id: r.id,
          employeeId: r.employee_id,
          name: (db.prepare('SELECT name FROM employee_profile WHERE id=?').get(r.employee_id) as any)?.name,
          workDate: r.work_date,
          status: r.status,
          lateMinutes: r.late_minutes,
          clockInAt: r.clock_in_at,
          clockOutAt: r.clock_out_at,
          trustScore: r.trust_score,
        })),
      }
    } },

  { name: 'dashboard.summary', description: 'Ringkasan dashboard hari ini (hadir, telat, belum, cuti, lembur).', scope: 'attendance:read', capability: 'dashboard.view', write: false,
    schema: z.object({ branchId: z.string().optional() }),
    run: ({ cid, conn, args }) => {
      const today = todayJkt()
      let emps = db.prepare("SELECT * FROM employee_profile WHERE company_id=? AND employment_status='active'").all(cid) as any[]
      emps = emps.filter((e) => inBranchScope(conn, e.branch_id))
      if (args.branchId) emps = emps.filter((e) => e.branch_id === args.branchId)
      const empIds = new Set(emps.map((e) => e.id))
      const recs = (db.prepare('SELECT * FROM attendance_record WHERE company_id=? AND work_date=?').all(cid, today) as any[])
        .filter((r) => empIds.has(r.employee_id))
      const onLeave = (db.prepare(`SELECT * FROM leave_request WHERE company_id=? AND status='approved' AND date_start<=? AND date_end>=?`).all(cid, today, today) as any[])
        .filter((l) => empIds.has(l.employee_id)).length
      const overtime = (db.prepare(`SELECT * FROM overtime_request WHERE company_id=? AND status='approved' AND work_date=?`).all(cid, today) as any[])
        .filter((o) => empIds.has(o.employee_id)).length
      const present = recs.filter((r) => r.status === 'on_time' || r.status === 'late').length
      const late = recs.filter((r) => r.status === 'late').length
      return {
        date: today,
        present,
        late,
        notYet: Math.max(0, emps.length - present - onLeave),
        onLeave,
        overtime,
        totalEmployees: emps.length,
      }
    } },

  { name: 'report.employee', description: 'Laporan periodik satu karyawan: ringkasan hadir/telat/alpa/cuti/lembur + detail harian.', scope: 'attendance:read', capability: 'report.export', write: false,
    schema: z.object({ employeeRef: z.string(), from: z.string(), to: z.string() }),
    run: ({ cid, conn, args, auditCall }) => {
      const emp = resolveOne(cid, 'employee_profile', args.employeeRef, 'Karyawan')
      if ('status' in emp) return emp
      if (!inBranchScope(conn, emp.one.branch_id)) return { status: 'forbidden', message: 'Karyawan di luar scope koneksi ini' }
      const period = new Set(daysBetween(args.from, args.to))
      const recs = (db.prepare('SELECT * FROM attendance_record WHERE company_id=? AND employee_id=?').all(cid, emp.one.id) as any[]).filter((r) => period.has(r.work_date))
      const leaves = (db.prepare(`SELECT * FROM leave_request WHERE company_id=? AND employee_id=? AND status='approved'`).all(cid, emp.one.id) as any[])
        .flatMap((l) => daysBetween(l.date_start, l.date_end).filter((d) => period.has(d)).map((d) => ({ date: d, type: l.type })))
      const ots = (db.prepare(`SELECT * FROM overtime_request WHERE company_id=? AND employee_id=? AND status='approved'`).all(cid, emp.one.id) as any[])
        .filter((o) => period.has(o.work_date))
      auditCall('mcp.report.employee', { employee: emp.one.name, period: `${args.from}..${args.to}` })
      return {
        employee: { id: emp.one.id, name: emp.one.name, branchId: emp.one.branch_id },
        period: { from: args.from, to: args.to },
        summary: {
          presentDays: recs.length,
          lateMinutesTotal: recs.reduce((s: number, r: any) => s + r.late_minutes, 0),
          leaveDays: leaves.length,
          overtimeHours: ots.reduce((s: number, o: any) => s + o.hours, 0),
        },
        attendance: recs.map((r: any) => ({ date: r.work_date, status: r.status, clockInAt: r.clock_in_at, clockOutAt: r.clock_out_at, lateMinutes: r.late_minutes })),
        leaves,
        overtimes: ots.map((o: any) => ({ date: o.work_date, hours: o.hours, dayType: o.day_type })),
      }
    } },

  { name: 'shift_template.list', description: 'Daftar template shift.', scope: 'shift:read', capability: 'attendance.view', write: false,
    schema: z.object({}),
    run: ({ cid }) => ({ templates: (db.prepare('SELECT id, name, start_time, end_time, break_minutes, late_tolerance_minutes FROM shift_template WHERE company_id=? ORDER BY start_time').all(cid) as any[]) }) },

  { name: 'shift.schedule', description: 'Jadwal shift pada rentang tanggal (opsional per karyawan).', scope: 'shift:read', capability: 'attendance.view', write: false,
    schema: z.object({ from: z.string(), to: z.string(), employeeId: z.string().optional() }),
    run: ({ cid, conn, args }) => {
      const days = new Set(daysBetween(args.from, args.to))
      let rows = db.prepare('SELECT * FROM shift_assignment WHERE company_id=?').all(cid) as any[]
      rows = rows.filter((r) => days.has(r.work_date) && (!args.employeeId || r.employee_id === args.employeeId))
      const empBranch = (eid: string) => (db.prepare('SELECT branch_id FROM employee_profile WHERE id=?').get(eid) as any)?.branch_id
      rows = rows.filter((r) => inBranchScope(conn, empBranch(r.employee_id)))
      return { assignments: rows.map((r) => ({ id: r.id, employeeId: r.employee_id, workDate: r.work_date, templateId: r.shift_template_id, status: r.status })) }
    } },

  { name: 'attendance.who_is_present', description: 'Siapa yang hadir hari ini.', scope: 'attendance:read', capability: 'attendance.view', write: false,
    schema: z.object({ branchId: z.string().optional() }),
    run: ({ cid, conn, args, auditCall }) => {
      const today = todayJkt()
      let rows = db.prepare('SELECT * FROM attendance_record WHERE company_id=? AND work_date=?').all(cid, today) as any[]
      if (args.branchId) rows = rows.filter((r) => r.branch_id === args.branchId)
      rows = rows.filter((r) => inBranchScope(conn, r.branch_id))
      auditCall('mcp.attendance.who_is_present', { branchId: args.branchId })
      return { content: rows.map((r) => ({ name: (db.prepare('SELECT name FROM employee_profile WHERE id=?').get(r.employee_id) as any)?.name, status: r.status })) }
    } },

  { name: 'attendance.recap', description: 'Rekap kehadiran (hadir/telat) cabang pada rentang tanggal.', scope: 'attendance:read', capability: 'attendance.view', write: false,
    schema: z.object({ periodStart: z.string(), periodEnd: z.string(), branchId: z.string().optional() }),
    run: ({ cid, conn, args, auditCall }) => {
      const period = new Set(daysBetween(args.periodStart, args.periodEnd))
      let emps = db.prepare('SELECT * FROM employee_profile WHERE company_id=?').all(cid) as any[]
      if (args.branchId) emps = emps.filter((e) => e.branch_id === args.branchId)
      emps = emps.filter((e) => inBranchScope(conn, e.branch_id))
      const recap = emps.map((e) => {
        const recs = (db.prepare('SELECT * FROM attendance_record WHERE company_id=? AND employee_id=?').all(cid, e.id) as any[]).filter((r) => period.has(r.work_date))
        return { name: e.name, present: recs.length, late: recs.filter((r) => r.status === 'late').length }
      })
      auditCall('mcp.attendance.recap', { period: `${args.periodStart}..${args.periodEnd}`, branchId: args.branchId })
      return { content: recap }
    } },

  { name: 'payroll.recap', description: 'Rekap payroll PP 35/2021 (lembur, potongan telat, uang makan). Hanya menghitung — tidak mencairkan gaji.', scope: 'payroll:read', capability: 'report.payroll.generate', write: false,
    schema: z.object({ periodStart: z.string(), periodEnd: z.string(), branchId: z.string().optional() }),
    run: ({ cid, conn, args, auditCall }) => {
      const rows = buildPayrollRows(cid, conn, args.periodStart, args.periodEnd, args.branchId)
      auditCall('mcp.payroll.recap', { period: `${args.periodStart}..${args.periodEnd}`, rows: rows.length })
      return { rows }
    } },

  { name: 'request.list_pending', description: 'Daftar pengajuan cuti & lembur yang menunggu persetujuan.', scope: 'request:read', capability: 'leave.approve', write: false,
    schema: z.object({}),
    run: ({ cid, conn }) => {
      const empBranch = (eid: string) => (db.prepare('SELECT branch_id FROM employee_profile WHERE id=?').get(eid) as any)?.branch_id
      const empName = (eid: string) => (db.prepare('SELECT name FROM employee_profile WHERE id=?').get(eid) as any)?.name
      const leaves = (db.prepare(`SELECT * FROM leave_request WHERE company_id=? AND status='pending'`).all(cid) as any[]).filter((l) => inBranchScope(conn, empBranch(l.employee_id)))
        .map((l) => ({ id: l.id, employee: empName(l.employee_id), type: l.type, dateStart: l.date_start, dateEnd: l.date_end }))
      const overtimes = (db.prepare(`SELECT * FROM overtime_request WHERE company_id=? AND status='pending'`).all(cid) as any[]).filter((o) => inBranchScope(conn, empBranch(o.employee_id)))
        .map((o) => ({ id: o.id, employee: empName(o.employee_id), workDate: o.work_date, hours: o.hours, dayType: o.day_type }))
      return { leaves, overtimes }
    } },

  { name: 'audit.recent', description: 'Catatan audit terbaru perusahaan.', scope: 'audit:read', capability: 'audit.view', write: false,
    schema: z.object({ limit: z.number().int().positive().max(200).default(50) }),
    run: ({ cid, args }) => ({ entries: (db.prepare('SELECT actor_type, actor_id, action, target, source, created_at FROM audit_log WHERE company_id=? ORDER BY created_at DESC LIMIT ?').all(cid, args.limit) as any[]) }) },

  // ============ WRITES (require confirm:true) ============
  { name: 'division.create', description: 'Buat divisi baru.', scope: 'org:write', capability: 'division.manage', write: true,
    schema: z.object({ name: z.string().min(1), confirm: z.boolean().optional() }),
    run: ({ cid, args, auditCall, confirmOr }) => confirmOr(`Buat divisi "${args.name}"`, () => {
      const did = id('div'); db.prepare('INSERT INTO division (id, company_id, name) VALUES (?,?,?)').run(did, cid, args.name)
      auditCall('mcp.division.create', { name: args.name })
      return { status: 'created', id: did, name: args.name }
    }) },

  { name: 'branch.create', description: 'Buat cabang baru dengan geofence lingkaran (lat/long + radius meter).', scope: 'org:write', capability: 'branch.manage', write: true,
    schema: z.object({ name: z.string().min(1), lat: z.number(), long: z.number(), radiusM: z.number().positive().max(5000).default(100), address: z.string().optional(), confirm: z.boolean().optional() }),
    run: ({ cid, args, auditCall, confirmOr }) => confirmOr(`Buat cabang "${args.name}" (radius ${args.radiusM} m)`, () => {
      const bid = id('br'); const gid = id('gf')
      db.prepare(`INSERT INTO branch (id, company_id, name, address, lat, long, status, created_at) VALUES (?,?,?,?,?,?, 'active', ?)`).run(bid, cid, args.name, args.address ?? null, args.lat, args.long, now())
      db.prepare(`INSERT INTO geofence (id, company_id, branch_id, type, center_lat, center_long, radius_m, buffer_m, polygon) VALUES (?,?,?, 'circle', ?,?,?,50,NULL)`).run(gid, cid, bid, args.lat, args.long, args.radiusM)
      auditCall('mcp.branch.create', { name: args.name })
      return { status: 'created', id: bid, name: args.name }
    }) },

  { name: 'shift_template.create', description: 'Buat template shift (jam mulai/selesai, toleransi telat).', scope: 'shift:write', capability: 'shift_template.manage', write: true,
    schema: z.object({ name: z.string().min(1), startTime: z.string().regex(/^\d{2}:\d{2}$/), endTime: z.string().regex(/^\d{2}:\d{2}$/), crossesMidnight: z.boolean().default(false), breakMinutes: z.number().int().nonnegative().default(60), lateToleranceMinutes: z.number().int().nonnegative().default(10), confirm: z.boolean().optional() }),
    run: ({ cid, args, auditCall, confirmOr }) => confirmOr(`Buat shift "${args.name}" ${args.startTime}–${args.endTime}`, () => {
      const sid = id('sht')
      db.prepare(`INSERT INTO shift_template (id, company_id, name, start_time, end_time, crosses_midnight, break_minutes, late_tolerance_minutes, geofence_id) VALUES (?,?,?,?,?,?,?,?,NULL)`)
        .run(sid, cid, args.name, args.startTime, args.endTime, args.crossesMidnight ? 1 : 0, args.breakMinutes, args.lateToleranceMinutes)
      auditCall('mcp.shift_template.create', { name: args.name })
      return { status: 'created', id: sid, name: args.name }
    }) },

  { name: 'employee.create', description: 'Tambah karyawan (membership pending by email). employeeRef cabang & divisi boleh berupa nama atau id.', scope: 'employee:write', capability: 'employee.manage', write: true,
    schema: z.object({ name: z.string().min(1), email: z.string().email(), branchRef: z.string(), divisionRef: z.string().optional(), role: z.enum(['employee', 'hr', 'branch_admin']).default('employee'), confirm: z.boolean().optional() }),
    run: ({ cid, conn, args, auditCall, confirmOr }) => {
      const br = resolveOne(cid, 'branch', args.branchRef, 'Cabang'); if ('status' in br) return br
      if (!inBranchScope(conn, br.one.id)) return { status: 'forbidden', message: 'Cabang di luar scope koneksi ini' }
      let divId: string | null = null
      if (args.divisionRef) { const dv = resolveOne(cid, 'division', args.divisionRef, 'Divisi'); if ('status' in dv) return dv; divId = dv.one.id }
      return confirmOr(`Tambah karyawan ${args.name} <${args.email}> ke cabang ${br.one.name}${divId ? '' : ''} sebagai ${args.role}`, () => {
        const email = args.email.toLowerCase().trim()
        const existing = db.prepare('SELECT id FROM user WHERE email=?').get(email) as any
        const userId = existing?.id ?? null
        const memId = id('mem'); const empId = id('emp')
        const tx = db.transaction(() => {
          db.prepare(`INSERT INTO membership (id, company_id, user_id, role, scope_branch_ids, scope_division_ids, status, created_at) VALUES (?,?,?,?,?,'[]',?,?)`)
            .run(memId, cid, userId ?? `pending:${email}`, args.role, '[]', userId ? 'active' : 'pending', now())
          db.prepare(`INSERT INTO employee_profile (id, company_id, membership_id, user_id, name, email, branch_id, division_id, wage_basic, wage_fixed_allowance, wage_variable_allowance, employment_status, created_at) VALUES (?,?,?,?,?,?,?,?,0,0,0,'active',?)`)
            .run(empId, cid, memId, userId, args.name, email, br.one.id, divId, now())
        })
        tx()
        auditCall('mcp.employee.create', { email, branch: br.one.name })
        return { status: 'created', id: empId, name: args.name, branch: br.one.name, pending: !userId }
      })
    } },

  { name: 'employee.invite', description: 'Buat link undangan karyawan (token + URL) untuk sebuah cabang.', scope: 'employee:write', capability: 'employee.invite', write: true,
    schema: z.object({ branchRef: z.string(), divisionRef: z.string().optional(), role: z.enum(['employee', 'hr', 'branch_admin']).default('employee'), maxUses: z.number().int().positive().default(1), expiresInDays: z.number().int().nonnegative().default(7), confirm: z.boolean().optional() }),
    run: ({ cid, conn, args, auditCall, confirmOr }) => {
      const br = resolveOne(cid, 'branch', args.branchRef, 'Cabang'); if ('status' in br) return br
      if (!inBranchScope(conn, br.one.id)) return { status: 'forbidden', message: 'Cabang di luar scope koneksi ini' }
      let divId: string | null = null
      if (args.divisionRef) { const dv = resolveOne(cid, 'division', args.divisionRef, 'Divisi'); if ('status' in dv) return dv; divId = dv.one.id }
      return confirmOr(`Buat undangan ${args.role} untuk cabang ${br.one.name} (maks ${args.maxUses} pakai, kedaluwarsa ${args.expiresInDays} hari)`, () => {
        const tk = token(); const iid = id('inv')
        const expires = new Date(Date.now() + args.expiresInDays * 864e5).toISOString()
        db.prepare(`INSERT INTO invite (id, company_id, branch_id, division_id, role, token, max_uses, used_count, expires_at, created_by, created_at, wage_basic, wage_fixed_allowance) VALUES (?,?,?,?,?,?,?,0,?,?,?,0,0)`)
          .run(iid, cid, br.one.id, divId, args.role, tk, args.maxUses, expires, `agent:${conn.id}`, now())
        auditCall('mcp.employee.invite', { branch: br.one.name, role: args.role })
        return { status: 'created', id: iid, token: tk, inviteUrl: `${config.appOrigin}/invite/${tk}`, expiresAt: expires }
      })
    } },

  { name: 'wage.set', description: 'Setel komponen upah karyawan (upah pokok + tunjangan tetap/variabel).', scope: 'employee:write', capability: 'wage.set', write: true,
    schema: z.object({ employeeRef: z.string(), wageBasic: z.number().nonnegative().optional(), wageFixedAllowance: z.number().nonnegative().optional(), wageVariableAllowance: z.number().nonnegative().optional(), confirm: z.boolean().optional() }),
    run: ({ cid, conn, args, auditCall, confirmOr }) => {
      const emp = resolveOne(cid, 'employee_profile', args.employeeRef, 'Karyawan'); if ('status' in emp) return emp
      if (!inBranchScope(conn, emp.one.branch_id)) return { status: 'forbidden', message: 'Karyawan di luar scope koneksi ini' }
      const e = emp.one
      return confirmOr(`Setel upah ${e.name}: pokok ${args.wageBasic ?? e.wage_basic}, tetap ${args.wageFixedAllowance ?? e.wage_fixed_allowance}, variabel ${args.wageVariableAllowance ?? e.wage_variable_allowance}`, () => {
        db.prepare('UPDATE employee_profile SET wage_basic=?, wage_fixed_allowance=?, wage_variable_allowance=? WHERE id=? AND company_id=?')
          .run(args.wageBasic ?? e.wage_basic, args.wageFixedAllowance ?? e.wage_fixed_allowance, args.wageVariableAllowance ?? e.wage_variable_allowance, e.id, cid)
        auditCall('mcp.wage.set', { employee: e.name })
        return { status: 'updated', id: e.id, name: e.name }
      })
    } },

  { name: 'shift.assign', description: 'Tugaskan shift ke satu karyawan pada satu tanggal.', scope: 'shift:write', capability: 'shift_assignment.manage', write: true,
    schema: z.object({ employeeRef: z.string(), shiftTemplate: z.string(), date: z.string(), confirm: z.boolean().optional() }),
    run: ({ cid, conn, args, auditCall }) => {
      // Behavior preserved verbatim (TC-144/146/147/154/155).
      const matches = db.prepare('SELECT * FROM employee_profile WHERE company_id=? AND name LIKE ?').all(cid, `%${args.employeeRef}%`) as any[]
      if (matches.length === 0) return { status: 'not_found', message: 'Karyawan tidak ditemukan' }
      if (matches.length > 1) return { status: 'needs_clarification', candidates: matches.map((m) => ({ id: m.id, name: m.name, branchId: m.branch_id })) }
      if (!inBranchScope(conn, matches[0].branch_id)) return { status: 'forbidden', message: 'Karyawan di luar scope koneksi ini' }
      const tpl = db.prepare('SELECT * FROM shift_template WHERE company_id=? AND name LIKE ?').get(cid, `%${args.shiftTemplate}%`) as any
      if (!tpl) return { status: 'not_found', message: 'Shift template tidak ditemukan' }
      if (!args.confirm) return { status: 'needs_confirmation', summary: `Tugaskan ${matches[0].name} ke ${tpl.name} pada ${args.date}` }
      db.prepare("INSERT OR IGNORE INTO shift_assignment (id, company_id, employee_id, shift_template_id, work_date, status) VALUES (?,?,?,?,?, 'scheduled')").run(id('sa'), cid, matches[0].id, tpl.id, args.date)
      auditCall('mcp.shift.assign', { employee: matches[0].name, template: tpl.name, date: args.date })
      return { status: 'assigned', employee: matches[0].name, template: tpl.name, date: args.date }
    } },

  { name: 'shift.bulk_assign', description: 'Tugaskan satu template ke banyak karyawan pada rentang tanggal.', scope: 'shift:write', capability: 'shift_assignment.manage', write: true,
    schema: z.object({ employeeRefs: z.array(z.string()).min(1), shiftTemplate: z.string(), dateStart: z.string(), dateEnd: z.string().optional(), skipSundays: z.boolean().default(true), confirm: z.boolean().optional() }),
    run: ({ cid, conn, args, auditCall, confirmOr }) => {
      const tpl = resolveOne(cid, 'shift_template', args.shiftTemplate, 'Shift template'); if ('status' in tpl) return tpl
      const empIds: string[] = []
      for (const ref of args.employeeRefs) {
        const r = resolveOne(cid, 'employee_profile', ref, 'Karyawan'); if ('status' in r) return r
        if (!inBranchScope(conn, r.one.branch_id)) return { status: 'forbidden', message: `Karyawan ${r.one.name} di luar scope` }
        empIds.push(r.one.id)
      }
      const dates = daysBetween(args.dateStart, args.dateEnd ?? args.dateStart).filter((d) => !(args.skipSundays && dow(d) === 0))
      return confirmOr(`Tugaskan ${tpl.one.name} ke ${empIds.length} karyawan × ${dates.length} hari (${dates.length * empIds.length} jadwal)`, () => {
        const insert = db.prepare(`INSERT OR IGNORE INTO shift_assignment (id, company_id, employee_id, shift_template_id, work_date, status) VALUES (?,?,?,?,?, 'scheduled')`)
        let created = 0
        const tx = db.transaction(() => { for (const e of empIds) for (const d of dates) { if (insert.run(id('sa'), cid, e, tpl.one.id, d).changes > 0) created++ } })
        tx()
        auditCall('mcp.shift.bulk_assign', { template: tpl.one.name, employees: empIds.length, dates: dates.length })
        return { status: 'assigned', created }
      })
    } },

  { name: 'leave.decide', description: 'Setujui / tolak pengajuan cuti (pakai id dari request.list_pending).', scope: 'request:write', capability: 'leave.approve', write: true,
    schema: z.object({ requestId: z.string(), decision: z.enum(['approved', 'rejected']), reason: z.string().optional(), confirm: z.boolean().optional() }),
    run: ({ cid, conn, args, auditCall, confirmOr }) => {
      const lv = db.prepare('SELECT * FROM leave_request WHERE id=? AND company_id=?').get(args.requestId, cid) as any
      if (!lv) return { status: 'not_found', message: 'Pengajuan cuti tidak ditemukan' }
      const empBranch = (db.prepare('SELECT branch_id FROM employee_profile WHERE id=?').get(lv.employee_id) as any)?.branch_id
      if (!inBranchScope(conn, empBranch)) return { status: 'forbidden', message: 'Pengajuan di luar scope koneksi ini' }
      return confirmOr(`${args.decision === 'approved' ? 'Setujui' : 'Tolak'} cuti #${lv.id} (${lv.date_start}..${lv.date_end})`, () => {
        db.prepare('UPDATE leave_request SET status=?, approver_id=?, decided_at=?, decided_reason=? WHERE id=?').run(args.decision, `agent:${conn.id}`, now(), args.reason ?? null, lv.id)
        auditCall(`mcp.leave.${args.decision}`, { id: lv.id, reason: args.reason })
        return { status: args.decision, id: lv.id }
      })
    } },

  { name: 'overtime.decide', description: 'Setujui / tolak pengajuan lembur (pakai id dari request.list_pending).', scope: 'request:write', capability: 'overtime.approve', write: true,
    schema: z.object({ requestId: z.string(), decision: z.enum(['approved', 'rejected']), reason: z.string().optional(), confirm: z.boolean().optional() }),
    run: ({ cid, conn, args, auditCall, confirmOr }) => {
      const ot = db.prepare('SELECT * FROM overtime_request WHERE id=? AND company_id=?').get(args.requestId, cid) as any
      if (!ot) return { status: 'not_found', message: 'Pengajuan lembur tidak ditemukan' }
      const empBranch = (db.prepare('SELECT branch_id FROM employee_profile WHERE id=?').get(ot.employee_id) as any)?.branch_id
      if (!inBranchScope(conn, empBranch)) return { status: 'forbidden', message: 'Pengajuan di luar scope koneksi ini' }
      return confirmOr(`${args.decision === 'approved' ? 'Setujui' : 'Tolak'} lembur #${ot.id} (${ot.hours} jam, ${ot.work_date})`, () => {
        db.prepare('UPDATE overtime_request SET status=?, approver_id=?, decided_at=?, decided_reason=? WHERE id=?').run(args.decision, `agent:${conn.id}`, now(), args.reason ?? null, ot.id)
        auditCall(`mcp.overtime.${args.decision}`, { id: ot.id })
        return { status: args.decision, id: ot.id }
      })
    } },

  { name: 'policy.set', description: 'Ubah kebijakan perusahaan (geofence ketat, ambang trust, retensi foto, mode potongan telat). Field opsional digabung dengan nilai sekarang.', scope: 'policy:write', capability: 'policy.manage', write: true,
    schema: z.object({
      strictGeofence: z.boolean().optional(),
      trustThresholds: z.object({ accept: z.number(), review: z.number() }).optional(),
      photoRetentionDays: z.number().int().positive().optional(),
      lateDeductionMode: z.enum(['grace_flat', 'per_minute', 'tiered']).optional(),
      minRestHours: z.number().int().nonnegative().max(48).optional(),
      confirm: z.boolean().optional(),
    }),
    run: ({ cid, args, auditCall, confirmOr }) => {
      const cur = db.prepare('SELECT * FROM policy WHERE company_id=?').get(cid) as any
      if (!cur) return { status: 'not_found', message: 'Policy belum ada' }
      const changes = Object.entries(args).filter(([k]) => k !== 'confirm').map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')
      return confirmOr(`Ubah kebijakan: ${changes || '(tidak ada)'}`, () => {
        db.prepare('UPDATE policy SET strict_geofence=?, trust_thresholds=?, photo_retention_days=?, late_deduction_mode=?, min_rest_hours=? WHERE company_id=?').run(
          args.strictGeofence != null ? (args.strictGeofence ? 1 : 0) : cur.strict_geofence,
          args.trustThresholds ? JSON.stringify(args.trustThresholds) : cur.trust_thresholds,
          args.photoRetentionDays ?? cur.photo_retention_days,
          args.lateDeductionMode ?? cur.late_deduction_mode,
          args.minRestHours ?? cur.min_rest_hours ?? 0, cid,
        )
        auditCall('mcp.policy.set', { changes })
        return { status: 'updated', policy: mapPolicy(db.prepare('SELECT * FROM policy WHERE company_id=?').get(cid)) }
      })
    } },

  { name: 'company.update', description: 'Ubah profil perusahaan (nama, jenis usaha, zona waktu, alamat, tipe minggu kerja). Field opsional digabung dengan nilai sekarang.', scope: 'org:write', capability: 'company.update', write: true,
    schema: z.object({ displayName: z.string().min(1).optional(), legalName: z.string().min(1).optional(), businessType: z.string().min(1).optional(), timezone: z.string().min(1).optional(), address: z.string().optional(), workweekType: z.enum(['five_day', 'six_day']).optional(), confirm: z.boolean().optional() }),
    run: ({ cid, args, auditCall, confirmOr }) => {
      const cur = db.prepare('SELECT * FROM company WHERE id=?').get(cid) as any
      const changes = Object.entries(args).filter(([k]) => k !== 'confirm').map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')
      return confirmOr(`Ubah profil perusahaan: ${changes || '(tidak ada)'}`, () => {
        db.prepare('UPDATE company SET display_name=?, legal_name=?, business_type=?, timezone=?, address=?, workweek_type=? WHERE id=?').run(
          args.displayName ?? cur.display_name, args.legalName ?? cur.legal_name, args.businessType ?? cur.business_type,
          args.timezone ?? cur.timezone, args.address ?? cur.address, args.workweekType ?? cur.workweek_type, cid,
        )
        auditCall('mcp.company.update', { changes })
        const c = db.prepare('SELECT id, display_name, business_type, timezone, workweek_type FROM company WHERE id=?').get(cid)
        return { status: 'updated', company: c }
      })
    } },

  { name: 'attendance.correct', description: 'Koreksi satu rekam kehadiran (status/menit telat/jam pulang) & opsional selesaikan flag anomali. Wajib sertakan alasan.', scope: 'attendance:write', capability: 'attendance.correct', write: true,
    schema: z.object({ recordId: z.string(), status: z.enum(['on_time', 'late', 'absent']).optional(), lateMinutes: z.number().int().nonnegative().optional(), clockOutAt: z.string().optional(), resolveFlag: z.boolean().optional(), reason: z.string().min(1), confirm: z.boolean().optional() }),
    run: ({ cid, conn, args, auditCall, confirmOr }) => {
      const rec = db.prepare('SELECT * FROM attendance_record WHERE id=? AND company_id=?').get(args.recordId, cid) as any
      if (!rec) return { status: 'not_found', message: 'Rekam kehadiran tidak ditemukan' }
      if (!inBranchScope(conn, rec.branch_id)) return { status: 'forbidden', message: 'Rekam di luar scope koneksi ini' }
      const who = (db.prepare('SELECT name FROM employee_profile WHERE id=?').get(rec.employee_id) as any)?.name ?? '—'
      return confirmOr(`Koreksi kehadiran ${who} (${rec.work_date}): ${args.status ?? rec.status}${args.resolveFlag ? ', selesaikan flag' : ''} — alasan: ${args.reason}`, () => {
        const policy = mapPolicy(db.prepare('SELECT * FROM policy WHERE company_id=?').get(cid))
        const newTrust = args.resolveFlag ? Math.max(rec.trust_score, policy.trustThresholds.review) : rec.trust_score
        db.prepare('UPDATE attendance_record SET status=?, late_minutes=?, clock_out_at=?, trust_score=? WHERE id=?').run(
          args.status ?? rec.status, args.lateMinutes ?? rec.late_minutes, args.clockOutAt ?? rec.clock_out_at, newTrust, rec.id,
        )
        auditCall('mcp.attendance.correct', { recordId: rec.id, status: args.status, resolveFlag: args.resolveFlag, reason: args.reason })
        return { status: 'corrected', id: rec.id, employee: who }
      })
    } },

  { name: 'attendance.export', description: 'Ekspor riwayat kehadiran satu rentang tanggal sebagai CSV (siap dibuka di Excel).', scope: 'attendance:read', capability: 'report.export', write: false,
    schema: z.object({ from: z.string(), to: z.string(), branchId: z.string().optional() }),
    run: ({ cid, conn, args, auditCall }) => {
      const tz = companyTz(cid)
      const branchName = (id: string) => (db.prepare('SELECT name FROM branch WHERE id=?').get(id) as any)?.name ?? '—'
      const empName = (id: string) => (db.prepare('SELECT name FROM employee_profile WHERE id=?').get(id) as any)?.name ?? '—'
      const statusLabel: Record<string, string> = { on_time: 'Tepat waktu', late: 'Telat', absent: 'Tidak hadir' }
      let rows = db.prepare('SELECT * FROM attendance_record WHERE company_id=? AND work_date>=? AND work_date<=? ORDER BY work_date DESC, created_at DESC').all(cid, args.from, args.to) as any[]
      if (args.branchId) rows = rows.filter((r) => r.branch_id === args.branchId)
      rows = rows.filter((r) => inBranchScope(conn, r.branch_id))
      const csv = toCsv(
        ['Nama', 'Cabang', 'Tanggal', 'Masuk', 'Keluar', 'Status', 'Telat(menit)', 'Trust', 'PulangCepat'],
        rows.map((r) => [empName(r.employee_id), branchName(r.branch_id), r.work_date, fmtTimeTz(r.clock_in_at, tz), fmtTimeTz(r.clock_out_at, tz), statusLabel[r.status] ?? r.status, r.late_minutes, r.trust_score, r.left_early ? 'Ya' : '']),
      )
      auditCall('mcp.attendance.export', { period: `${args.from}..${args.to}`, rows: rows.length })
      return { filename: `absensi-${args.from}-${args.to}.csv`, mimeType: 'text/csv', rowCount: rows.length, csv }
    } },

  { name: 'payroll.export', description: 'Ekspor rekap payroll PP 35/2021 satu periode sebagai CSV (hanya hitung, tidak mencairkan).', scope: 'payroll:read', capability: 'report.export', write: false,
    schema: z.object({ periodStart: z.string(), periodEnd: z.string(), branchId: z.string().optional() }),
    run: ({ cid, conn, args, auditCall }) => {
      const rows = buildPayrollRows(cid, conn, args.periodStart, args.periodEnd, args.branchId)
      const csv = toCsv(
        ['Nama', 'Upah/jam', 'Hari hadir', 'Hari alpa', 'Hari cuti', 'Total menit telat', 'Potongan telat', 'Uang makan', 'Jam lembur', 'Upah lembur'],
        rows.map((r) => [r.name, r.hourlyWage, r.presentDays, r.absentDays, r.leaveDays, r.lateMinutesTotal, r.lateDeduction, r.mealAllowance, r.overtimeHoursTotal, r.overtimePayTotal]),
      )
      auditCall('mcp.payroll.export', { period: `${args.periodStart}..${args.periodEnd}`, rows: rows.length })
      return { filename: `payroll-${args.periodStart}-${args.periodEnd}.csv`, mimeType: 'text/csv', rowCount: rows.length, csv }
    } },
]

/** Distinct scopes the tools require (tests assert they are all in MCP_SCOPES). */
export const toolScopes = (): string[] => [...new Set(TOOLS.map((t) => t.scope))]

// ---- Resources (read-only, tenant-scoped) ----
function readResource(uri: string, conn: Conn): { ok: any } | { err: [number, string] } {
  const cid = conn.companyId
  const m = uri.match(/^absentra:\/\/company\/([^/]+)\/([a-z-]+)$/)
  if (!m) return { err: [-32602, 'unsupported_resource'] }
  if (m[1] !== cid) return { err: [-32002, 'forbidden_tenant'] } // (TC-153)
  const kind = m[2]
  const json = (text: any) => ({ ok: { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(text) }] } })
  switch (kind) {
    case 'policy': return json(db.prepare('SELECT * FROM policy WHERE company_id=?').get(cid))
    case 'branches': {
      let rows = db.prepare("SELECT id, name, lat, long FROM branch WHERE company_id=? AND status='active'").all(cid) as any[]
      rows = rows.filter((b) => inBranchScope(conn, b.id))
      return json(rows)
    }
    case 'divisions': return json(db.prepare('SELECT id, name FROM division WHERE company_id=?').all(cid))
    case 'employees': {
      let rows = db.prepare('SELECT id, name, branch_id, division_id, employment_status FROM employee_profile WHERE company_id=?').all(cid) as any[]
      rows = rows.filter((e) => inBranchScope(conn, e.branch_id))
      return json(rows)
    }
    case 'shift-templates': return json(db.prepare('SELECT id, name, start_time, end_time FROM shift_template WHERE company_id=?').all(cid))
    default: return { err: [-32602, 'unsupported_resource'] }
  }
}
const RESOURCES = [
  { uri: 'absentra://company/{id}/policy', name: 'Kebijakan perusahaan' },
  { uri: 'absentra://company/{id}/branches', name: 'Daftar cabang' },
  { uri: 'absentra://company/{id}/divisions', name: 'Daftar divisi' },
  { uri: 'absentra://company/{id}/employees', name: 'Daftar karyawan' },
  { uri: 'absentra://company/{id}/shift-templates', name: 'Daftar template shift' },
]

// ---- Prompts = parameterized workflow templates (PRD §7.5.6) ----
// They teach an agent the CORRECT end-to-end flow + which tools to call in order.
interface Prompt { name: string; description: string; arguments: { name: string; description: string; required?: boolean }[]; build: (a: Record<string, string>) => string }
const PROMPTS: Prompt[] = [
  {
    name: 'onboard_company',
    description: 'Alur lengkap menyiapkan perusahaan baru dari nol hingga karyawan siap absen.',
    arguments: [{ name: 'companyName', description: 'Nama perusahaan (untuk konteks)', required: false }],
    build: (a) => [
      `Tujuan: menyiapkan Absentra untuk ${a.companyName ?? 'perusahaan ini'} hingga karyawan bisa absen. Ikuti urutan ini; setiap aksi tulis butuh konfirmasi (panggil ulang dengan confirm:true).`,
      '',
      '1. Cek konteks: panggil `company.get` lalu `branch.list` & `division.list` untuk tahu apa yang sudah ada.',
      '2. Buat cabang: `branch.create` (name, lat, long, radiusM) untuk tiap lokasi kerja. Geofence lingkaran dibuat otomatis.',
      '3. Buat divisi: `division.create` (mis. "Dapur", "Kasir", "Gudang").',
      '4. Buat template shift: `shift_template.create` (name, startTime, endTime, lateToleranceMinutes).',
      '5. Tambah / undang karyawan:',
      '   • `employee.create` (name, email, branchRef, divisionRef) untuk menambah langsung, ATAU',
      '   • `employee.invite` (branchRef) untuk membuat link undangan yang dibagikan ke karyawan.',
      '6. (Opsional) Setel upah: `wage.set` (employeeRef, wageBasic, wageFixedAllowance) — perlu agar rekap payroll akurat.',
      '7. Jadwalkan shift: `shift.bulk_assign` (employeeRefs, shiftTemplate, dateStart, dateEnd).',
      '8. (Opsional) Sesuaikan kebijakan: `policy.set` (strictGeofence, trustThresholds, photoRetentionDays).',
      '',
      'Selalu konfirmasi ringkasan ke pengguna sebelum mengirim confirm:true. Jika nama cabang/karyawan ambigu, tool akan minta klarifikasi (status: needs_clarification) — tanyakan ke pengguna mana yang dimaksud.',
    ].join('\n'),
  },
  {
    name: 'weekly_attendance_review',
    description: 'Tinjau kehadiran satu minggu & soroti anomali/keterlambatan untuk ditindaklanjuti.',
    arguments: [{ name: 'periodStart', description: 'Tanggal mulai YYYY-MM-DD', required: true }, { name: 'periodEnd', description: 'Tanggal akhir YYYY-MM-DD', required: true }, { name: 'branchId', description: 'Batasi ke cabang tertentu (opsional)', required: false }],
    build: (a) => [
      `Tujuan: tinjau kehadiran ${a.periodStart} s/d ${a.periodEnd}${a.branchId ? ` untuk cabang ${a.branchId}` : ''}.`,
      '',
      '1. `attendance.recap` (periodStart, periodEnd, branchId?) → ambil hadir & telat per karyawan.',
      '2. `attendance.who_is_present` → kondisi hari ini.',
      '3. Soroti: karyawan dengan telat tinggi atau kehadiran rendah. Bandingkan dengan jadwal via `shift.schedule`.',
      '4. Cek pengajuan menunggu: `request.list_pending`. Sarankan keputusan, lalu (atas persetujuan pengguna) `leave.decide` / `overtime.decide` dengan confirm:true.',
      '5. Ringkas temuan dalam Bahasa Indonesia yang jelas.',
    ].join('\n'),
  },
  {
    name: 'run_payroll',
    description: 'Hasilkan rekap payroll PP 35/2021 untuk satu periode (hanya hitung, tidak mencairkan).',
    arguments: [{ name: 'periodStart', description: 'Tanggal mulai YYYY-MM-DD', required: true }, { name: 'periodEnd', description: 'Tanggal akhir YYYY-MM-DD', required: true }],
    build: (a) => [
      `Tujuan: rekap payroll periode ${a.periodStart} s/d ${a.periodEnd}.`,
      '',
      '1. Pastikan lembur sudah final: `request.list_pending` → jika ada lembur menunggu, minta pengguna memutuskan dulu (hanya lembur yang DISETUJUI yang dihitung).',
      '2. (Opsional) cek `wage.set` sudah benar via `employee.list`.',
      '3. `payroll.recap` (periodStart, periodEnd, branchId?) → menghasilkan baris rekap: upah pokok, lembur (multiplier per jenis hari), potongan telat, uang makan, total.',
      '4. Sajikan tabel ringkas + total. Ingatkan: ini rekap siap-payroll, BUKAN pencairan gaji (NG2).',
    ].join('\n'),
  },
]

mcpServerRouter.post('/', async (req, res) => {
  const conn = resolveConn(req)
  if (!conn) return res.status(401).json(rpcErr(req.body?.id ?? null, -32000, 'unauthorized'))
  // AGENTBUFF FREEZE: the agent stops too when the company's owner access lapses.
  const open = await companyOpen(conn.companyId)
  if (!open.entitled) return res.status(403).json(rpcErr(req.body?.id ?? null, -32010, 'company_frozen', { reason: open.reason }))
  const { id: rid, method, params } = req.body ?? {}

  if (method === 'initialize') {
    return res.json(rpcOk(rid, { protocolVersion: '2025-11-25', capabilities: { tools: {}, resources: {}, prompts: {} }, serverInfo: { name: 'absentra-mcp', version: '0.2.0' } }))
  }
  if (method === 'tools/list') {
    // Only advertise tools the connection's scope can actually call (least-privilege visibility).
    const visible = TOOLS.filter((t) => conn.scopes.includes(t.scope))
    return res.json(rpcOk(rid, {
      tools: visible.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: zodToJsonSchema(t.schema),
      })),
    }))
  }
  if (method === 'resources/list') {
    return res.json(rpcOk(rid, { resources: RESOURCES.map((r) => ({ uri: r.uri.replace('{id}', conn.companyId), name: r.name, mimeType: 'application/json' })) }))
  }
  if (method === 'prompts/list') {
    return res.json(rpcOk(rid, { prompts: PROMPTS.map((p) => ({ name: p.name, description: p.description, arguments: p.arguments })) }))
  }
  if (method === 'prompts/get') {
    const p = PROMPTS.find((x) => x.name === params?.name)
    if (!p) return res.json(rpcErr(rid, -32602, 'unknown_prompt'))
    const text = p.build((params?.arguments ?? {}) as Record<string, string>)
    return res.json(rpcOk(rid, { description: p.description, messages: [{ role: 'user', content: { type: 'text', text } }] }))
  }

  if (method === 'resources/read') {
    const r = readResource(String(params?.uri ?? ''), conn)
    if ('err' in r) return res.json(rpcErr(rid, r.err[0], r.err[1]))
    return res.json(rpcOk(rid, r.ok))
  }

  if (method === 'tools/call') {
    if (rateLimited(conn.id)) return res.json(rpcErr(rid, -32029, 'rate_limited')) // (TC-151)
    const tool = TOOLS.find((t) => t.name === params?.name)
    if (!tool) return res.json(rpcErr(rid, -32601, 'unknown_tool'))
    if (!conn.scopes.includes(tool.scope)) return res.json(rpcErr(rid, -32001, 'forbidden_scope', { required: tool.scope })) // (TC-145)
    const actor = connActor(conn)
    if (!can(actor, tool.capability)) return res.json(rpcErr(rid, -32003, 'forbidden_capability', { capability: tool.capability })) // single can() path
    const parsed = tool.schema.safeParse(params?.arguments ?? {})
    if (!parsed.success) return res.json(rpcErr(rid, -32602, 'invalid_params', parsed.error.issues)) // (TC-148)
    const cid = conn.companyId
    const auditCall = (action: string, meta?: any) => audit({ companyId: cid, actorType: 'agent', actorId: conn.id, action, source: 'mcp', metadata: meta })
    // Human-in-the-loop: a write without confirm:true returns a summary and does NOT execute (TC-147/154/155).
    const confirmOr = (summary: string, fn: () => any) => (parsed.data as any).confirm ? fn() : { status: 'needs_confirmation', summary }
    try {
      const result = tool.run({ args: parsed.data, cid, conn, actor, auditCall, confirmOr })
      return res.json(rpcOk(rid, mcpToolResult(result)))
    } catch (e: any) {
      return res.json(rpcErr(rid, -32603, 'tool_error', { message: String(e?.message ?? e) }))
    }
  }

  return res.json(rpcErr(rid ?? null, -32601, 'method_not_found'))
})
