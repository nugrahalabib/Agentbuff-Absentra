/**
 * Penerbitan koneksi MCP (PRD §7.5.3) — satu jalur untuk layar "Koneksi Agen"
 * (routes/mcp.ts) dan sambung otomatis dari AgentBuff (routes/agentbuffMcp.ts),
 * supaya format token, penyimpanan hash, dan cakupannya tidak pernah menyimpang.
 *
 * Token bearer terikat ke satu company_id + subset cakupan. Hanya hash-nya yang
 * disimpan; nilai aslinya dikembalikan SEKALI ke pemanggil dan tidak pernah dicatat.
 */
import { createHash } from 'node:crypto'
import { db, now } from './db.js'
import { id, token } from './ids.js'

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

/** Katalog cakupan MCP (least-privilege; pemilik memilih subset per koneksi). */
export const MCP_SCOPES = [
  'attendance:read', 'attendance:write',
  'shift:read', 'shift:write',
  'employee:read', 'employee:write',
  'org:read', 'org:write',
  'policy:read', 'policy:write',
  'request:read', 'request:write',
  'payroll:read', 'audit:read',
] as const

export interface KoneksiBaru {
  id: string
  accessToken: string
}

export function terbitkanKoneksiMcp(opts: {
  companyId: string
  agentName: string
  scopes: readonly string[]
  scopeBranchIds?: readonly string[] // kosong = semua cabang
  createdBy: string | null
  oauthClientId?: string
}): KoneksiBaru {
  const mid = id('mcp')
  const accessToken = `mcp_${token()}${token()}`
  db.prepare(
    `INSERT INTO mcp_connection (id, company_id, agent_name, oauth_client_id, scopes, scope_branch_ids, status, created_at, token_hash, created_by)
     VALUES (?,?,?,?,?,?, 'active', ?, ?, ?)`,
  ).run(
    mid, opts.companyId, opts.agentName, opts.oauthClientId ?? `cli_${id('')}`.slice(0, 16),
    JSON.stringify(opts.scopes), JSON.stringify(opts.scopeBranchIds ?? []), now(), sha256(accessToken), opts.createdBy,
  )
  return { id: mid, accessToken }
}
