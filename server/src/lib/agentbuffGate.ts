/**
 * AgentBuff marketplace entitlement gate (client side).
 *
 * Absentra is sold as a product in the AgentBuff marketplace. Only a person whose
 * AgentBuff access is LIVE (active OP Buff subscription OR active free trial) AND
 * who OWNS this product may run a company here. This module asks AgentBuff's
 * `/api/partner/entitlement` endpoint whether an email is entitled.
 *
 * PRODUCTION-FIT: the endpoint URL, shared secret, and product key are ALL env-
 * driven, so pointing at the deployed AgentBuff (https://agentbuff.id/…) later is
 * a config change — no code change. Fails SAFE:
 *   • the LOGIN gate (checkEntitlementStrict) always re-checks fresh and denies on
 *     any doubt — a lapsed owner can't get back in.
 *   • the ONGOING company-freeze check (checkEntitlement) uses a short cache + an
 *     outage grace window, so a brief AgentBuff blip never freezes a paying
 *     customer, while a genuine lapse freezes the company within the cache TTL.
 * Data is NEVER touched by this gate — it only allows/denies access.
 */
import { db } from './db.js'

const GATE_URL = process.env.AGENTBUFF_ENTITLEMENT_URL ?? ''
const GATE_SECRET = process.env.AGENTBUFF_PARTNER_SECRET ?? ''
const PRODUCT_KEY = process.env.ABSENTRA_PRODUCT_KEY ?? 'absentra'
// Enforced by default. Set AGENTBUFF_GATE_DISABLED=1 to run Absentra standalone
// (local dev without an AgentBuff to call). Also inert if URL/secret unset.
const GATE_ENABLED =
  process.env.AGENTBUFF_GATE_DISABLED !== '1' && !!GATE_URL && !!GATE_SECRET

const TTL_MS = 10 * 60_000 // re-check an owner at most every 10 min
const GRACE_MS = 60 * 60_000 // during an AgentBuff outage, trust a recent "entitled" up to 1h
const TIMEOUT_MS = 8_000

export interface Entitlement {
  entitled: boolean
  reason: string // ok | not_registered | access_lapsed | not_purchased | gate_unreachable | gate_disabled
  name?: string
  email?: string
}

type CacheEntry = { res: Entitlement; at: number }
const cache = new Map<string, CacheEntry>()

export function gateEnabled(): boolean {
  return GATE_ENABLED
}
export function gateProductKey(): string {
  return PRODUCT_KEY
}

async function fetchEntitlement(email: string): Promise<Entitlement | null> {
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

/** Ongoing check (company-freeze): cache + outage grace so blips don't freeze payers. */
export async function checkEntitlement(email: string): Promise<Entitlement> {
  if (!GATE_ENABLED) return { entitled: true, reason: 'gate_disabled' }
  const key = email.toLowerCase().trim()
  const now = Date.now()
  const cached = cache.get(key)
  if (cached && now - cached.at < TTL_MS) return cached.res

  const fresh = await fetchEntitlement(key)
  if (fresh) {
    cache.set(key, { res: fresh, at: now })
    return fresh
  }
  // AgentBuff unreachable — keep a recently-confirmed entitled owner in (grace),
  // otherwise deny (fail closed).
  if (cached && cached.res.entitled && now - cached.at < GRACE_MS) return cached.res
  return { entitled: false, reason: 'gate_unreachable' }
}

/** Login gate: always fresh, no grace — a lapsed owner is denied at the door. */
export async function checkEntitlementStrict(email: string): Promise<Entitlement> {
  if (!GATE_ENABLED) return { entitled: true, reason: 'gate_disabled' }
  const key = email.toLowerCase().trim()
  const fresh = await fetchEntitlement(key)
  if (fresh) {
    cache.set(key, { res: fresh, at: Date.now() })
    return fresh
  }
  return { entitled: false, reason: 'gate_unreachable' }
}

/** The active OWNER's email for a company (the party the marketplace gate is tied to). */
export function companyOwnerEmail(companyId: string): string | null {
  const row = db
    .prepare(
      "SELECT u.email AS email FROM membership m JOIN user u ON u.id = m.user_id WHERE m.company_id = ? AND m.role = 'owner' AND m.status = 'active' ORDER BY m.created_at LIMIT 1",
    )
    .get(companyId) as { email?: string } | undefined
  return row?.email ?? null
}

/**
 * Company-freeze gate: is the company OPEN for work right now? A company is frozen
 * the moment its owner's AgentBuff access lapses (sub/trial ended) — every member
 * (owner + staff) is blocked, but nothing is deleted. Reactivating in AgentBuff
 * lifts the freeze on the next check.
 */
export async function companyOpen(companyId: string): Promise<Entitlement> {
  if (!GATE_ENABLED) return { entitled: true, reason: 'gate_disabled' }
  const ownerEmail = companyOwnerEmail(companyId)
  if (!ownerEmail) return { entitled: true, reason: 'no_owner' } // don't hard-block a mis-seeded company
  return checkEntitlement(ownerEmail)
}
