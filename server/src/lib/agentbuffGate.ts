/**
 * AgentBuff marketplace gate (client side) — company freeze.
 *
 * Absentra is sold as a product in the AgentBuff marketplace. A company runs only
 * while its OWNER is entitled on AgentBuff: account active, OP Buff subscription
 * or free trial live, and owns this product. Owners sign in with "Masuk dengan
 * AgentBuff" (agentbuffMasuk.ts); here the owner is re-checked periodically via
 * AgentBuff's `/masuk/status`, so a lapsed subscription freezes the company —
 * data is NEVER touched, only access.
 *
 * Key = the owner's `agentbuff_sub`. An owner who predates "Masuk dengan
 * AgentBuff" is checked by email; when entitled AgentBuff returns their `sub`
 * and we store it, so the migration happens by itself.
 *
 * Fails SAFE: short cache (10 min) + outage grace (1 h) — a brief AgentBuff blip
 * never freezes a paying customer, while a genuine lapse freezes the company
 * within the cache TTL.
 *
 * Transition: until the Masuk credentials are configured the gate keeps using the
 * legacy partner endpoint (`/api/partner/entitlement`), so nothing changes.
 */
import { db } from './db.js'
import { masukSiap, statusPemilik } from './agentbuffMasuk.js'

const GATE_URL = process.env.AGENTBUFF_ENTITLEMENT_URL ?? ''
const GATE_SECRET = process.env.AGENTBUFF_PARTNER_SECRET ?? ''
const PRODUCT_KEY = process.env.ABSENTRA_PRODUCT_KEY ?? 'absentra'
const GATE_DISABLED = process.env.AGENTBUFF_GATE_DISABLED === '1'
const LEGACY_READY = !!GATE_URL && !!GATE_SECRET

const TTL_MS = 10 * 60_000 // re-check an owner at most every 10 min
const GRACE_MS = 60 * 60_000 // during an AgentBuff outage, trust a recent "entitled" up to 1h
const TIMEOUT_MS = 8_000

export interface Entitlement {
  entitled: boolean
  // ok | akses_berakhir | belum_beli | belum_aktif | diblokir | dicabut | tidak_dikenal
  // (legacy: not_registered | access_lapsed | not_purchased) | gate_unreachable | gate_disabled | no_owner
  reason: string
  name?: string
  email?: string
}

type CacheEntry = { res: Entitlement; at: number }
const cache = new Map<string, CacheEntry>()

/** Enforced by default. AGENTBUFF_GATE_DISABLED=1 runs Absentra standalone (local dev). */
export function gateEnabled(): boolean {
  return !GATE_DISABLED && (masukSiap() || LEGACY_READY)
}
export function gateProductKey(): string {
  return PRODUCT_KEY
}

async function fetchLegacy(email: string): Promise<Entitlement | null> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    const r = await fetch(GATE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-partner-secret': GATE_SECRET },
      body: JSON.stringify({ email, productKey: PRODUCT_KEY }),
      signal: ctrl.signal,
    })
    clearTimeout(t)
    if (!r.ok) return null
    const data = (await r.json()) as Entitlement
    return typeof data?.entitled === 'boolean' ? data : null
  } catch {
    return null
  }
}

interface Owner {
  id: string
  email: string
  agentbuff_sub: string | null
}

async function askOwner(owner: Owner): Promise<Entitlement | null> {
  if (masukSiap()) {
    const s = await statusPemilik(owner.agentbuff_sub, owner.email)
    if (!s) return null
    if (s.sub && !owner.agentbuff_sub) {
      try {
        db.prepare('UPDATE user SET agentbuff_sub = ? WHERE id = ? AND agentbuff_sub IS NULL').run(s.sub, owner.id)
      } catch { /* unique clash = already linked elsewhere; keep checking by email */ }
    }
    return { entitled: s.aktif, reason: s.alasan }
  }
  return LEGACY_READY ? fetchLegacy(owner.email.toLowerCase().trim()) : null
}

/** Ongoing check (company-freeze): cache + outage grace so blips don't freeze payers. */
async function checkOwner(owner: Owner): Promise<Entitlement> {
  const key = owner.id
  const now = Date.now()
  const cached = cache.get(key)
  if (cached && now - cached.at < TTL_MS) return cached.res

  const fresh = await askOwner(owner)
  if (fresh) {
    cache.set(key, { res: fresh, at: now })
    return fresh
  }
  // AgentBuff unreachable — keep a recently-confirmed entitled owner in (grace),
  // otherwise deny (fail closed).
  if (cached && cached.res.entitled && now - cached.at < GRACE_MS) return cached.res
  return { entitled: false, reason: 'gate_unreachable' }
}

/**
 * Entitlement of one OWNER right now (AgentBuff auto-connect MCP). Same cache +
 * outage grace as the company freeze — the AgentBuff contract allows caching.
 */
export async function ownerEntitlement(userId: string): Promise<Entitlement> {
  if (!gateEnabled()) return { entitled: true, reason: 'gate_disabled' }
  const u = db.prepare('SELECT id, email, agentbuff_sub FROM user WHERE id = ?').get(userId) as Owner | undefined
  if (!u) return { entitled: false, reason: 'tidak_dikenal' }
  return checkOwner(u)
}

/** Forget the cached verdict for a user (called right after they sign in again). */
export function forgetOwner(userId: string): void {
  cache.delete(userId)
}

/** Legacy login gate (Google path while Masuk isn't configured): always fresh, no grace. */
export async function checkEntitlementStrict(email: string): Promise<Entitlement> {
  if (!gateEnabled() || masukSiap()) return { entitled: true, reason: 'gate_disabled' }
  const fresh = await fetchLegacy(email.toLowerCase().trim())
  return fresh ?? { entitled: false, reason: 'gate_unreachable' }
}

/** The active OWNER of a company (the party the marketplace gate is tied to). */
export function companyOwner(companyId: string): Owner | null {
  const row = db
    .prepare(
      "SELECT u.id AS id, u.email AS email, u.agentbuff_sub AS agentbuff_sub FROM membership m JOIN user u ON u.id = m.user_id WHERE m.company_id = ? AND m.role = 'owner' AND m.status = 'active' ORDER BY m.created_at LIMIT 1",
    )
    .get(companyId) as Owner | undefined
  return row ?? null
}

/** Backward-compatible helper (owner email only). */
export function companyOwnerEmail(companyId: string): string | null {
  return companyOwner(companyId)?.email ?? null
}

/**
 * Company-freeze gate: is the company OPEN for work right now? A company is frozen
 * the moment its owner's AgentBuff access lapses (sub/trial ended) — every member
 * (owner + staff) is blocked, but nothing is deleted. Reactivating in AgentBuff
 * lifts the freeze on the next check.
 */
export async function companyOpen(companyId: string): Promise<Entitlement> {
  if (!gateEnabled()) return { entitled: true, reason: 'gate_disabled' }
  const owner = companyOwner(companyId)
  if (!owner) return { entitled: true, reason: 'no_owner' } // don't hard-block a mis-seeded company
  return checkOwner(owner)
}

/** Status of a specific user as an owner-to-be (company creation). Always fresh. */
export async function ownerStatusFresh(userId: string): Promise<Entitlement> {
  if (!gateEnabled()) return { entitled: true, reason: 'gate_disabled' }
  const u = db.prepare('SELECT id, email, agentbuff_sub FROM user WHERE id = ?').get(userId) as Owner | undefined
  if (!u) return { entitled: false, reason: 'tidak_dikenal' }
  if (masukSiap() && !u.agentbuff_sub) return { entitled: false, reason: 'perlu_agentbuff' }
  forgetOwner(u.id)
  const res = await askOwner(u)
  if (res) cache.set(u.id, { res, at: Date.now() })
  return res ?? { entitled: false, reason: 'gate_unreachable' }
}
