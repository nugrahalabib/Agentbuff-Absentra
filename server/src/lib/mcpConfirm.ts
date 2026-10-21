/**
 * Server-enforced two-step confirmation for MCP write tools (PRD §7.5.3
 * human-in-the-loop). A `confirm: true` flag is self-supplied by the agent and
 * proves nothing, so:
 *   1. a write call WITHOUT `confirmationToken` only returns a preview + a
 *      single-use token (TTL 10 min) bound to (connection, tool, sha256 of the
 *      canonical arguments, the preview text);
 *   2. the write runs only when called again with that token and IDENTICAL
 *      arguments, and the world still yields the same preview (e.g. the "Budi"
 *      it resolves to, the wage it overwrites).
 */
import { createHash, randomBytes } from 'node:crypto'

export const CONFIRMATION_TTL_MS = 10 * 60_000
const MAX_PENDING = 10_000

interface Pending { connId: string; tool: string; hash: string; expiresAt: number }
const pending = new Map<string, Pending>()

/** Stable JSON (sorted keys) of the arguments, excluding the confirmation fields. */
export function canonicalArgs(args: Record<string, unknown>): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm)
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, norm((v as Record<string, unknown>)[k])]))
    }
    return v
  }
  const { confirm: _c, confirmationToken: _t, ...rest } = args ?? {}
  return JSON.stringify(norm(rest))
}

const bindingHash = (connId: string, tool: string, args: Record<string, unknown>, summary: string) =>
  createHash('sha256').update(`${connId}\u0000${tool}\u0000${canonicalArgs(args)}\u0000${summary}`).digest('hex')

function prune(nowMs: number) {
  for (const [k, p] of pending) if (p.expiresAt <= nowMs) pending.delete(k)
  if (pending.size > MAX_PENDING) {
    const excess = pending.size - MAX_PENDING
    let i = 0
    for (const k of pending.keys()) { if (i++ >= excess) break; pending.delete(k) }
  }
}

export function issueConfirmation(connId: string, tool: string, args: Record<string, unknown>, summary: string): { token: string; expiresAt: string } {
  const nowMs = Date.now()
  prune(nowMs)
  const token = `cfm_${randomBytes(24).toString('base64url')}`
  const expiresAt = nowMs + CONFIRMATION_TTL_MS
  pending.set(token, { connId, tool, hash: bindingHash(connId, tool, args, summary), expiresAt })
  return { token, expiresAt: new Date(expiresAt).toISOString() }
}

export type RedeemResult = 'ok' | 'unknown' | 'expired' | 'mismatch'

/** Single-use: the token is consumed whatever the outcome. */
export function redeemConfirmation(token: string, connId: string, tool: string, args: Record<string, unknown>, summary: string): RedeemResult {
  const p = pending.get(token)
  if (!p) return 'unknown'
  pending.delete(token)
  if (p.expiresAt <= Date.now()) return 'expired'
  if (p.connId !== connId || p.tool !== tool || p.hash !== bindingHash(connId, tool, args, summary)) return 'mismatch'
  return 'ok'
}

/** Test helper. */
export function clearConfirmations(): void {
  pending.clear()
}
