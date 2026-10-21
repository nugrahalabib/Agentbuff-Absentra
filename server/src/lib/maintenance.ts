/**
 * Periodic housekeeping (runs at startup and every 6 hours):
 *   • UU PDP data minimisation — attendance photos older than each tenant's
 *     `photo_retention_days` (default 90) are erased; the event row (time, geo,
 *     trust) stays for payroll/audit. One audit entry per tenant whose photos
 *     were purged (actor_type operator).
 *   • Expired sessions, refresh tokens and SSO replay-guard JTIs are deleted so
 *     those tables stay bounded.
 */
import { db } from './db.js'
import { audit } from './audit.js'

export const DEFAULT_PHOTO_RETENTION_DAYS = 90
const SIX_HOURS_MS = 6 * 60 * 60 * 1000

export function purgeExpiredPhotos(nowMs = Date.now()): Array<{ companyId: string; purged: number; retentionDays: number }> {
  const rows = db.prepare('SELECT c.id AS id, p.photo_retention_days AS days FROM company c LEFT JOIN policy p ON p.company_id = c.id').all() as { id: string; days: number | null }[]
  const update = db.prepare('UPDATE attendance_event SET photo_data = NULL WHERE company_id = ? AND photo_data IS NOT NULL AND event_time_server < ?')
  const out: Array<{ companyId: string; purged: number; retentionDays: number }> = []
  for (const r of rows) {
    const days = r.days != null && r.days > 0 ? r.days : DEFAULT_PHOTO_RETENTION_DAYS
    const cutoff = new Date(nowMs - days * 864e5).toISOString()
    const purged = update.run(r.id, cutoff).changes
    if (purged > 0) {
      audit({
        companyId: r.id, actorType: 'operator', actorId: 'system:retention', action: 'attendance.photo_purge',
        source: 'ui', metadata: { purged, retentionDays: days, before: cutoff },
      })
      out.push({ companyId: r.id, purged, retentionDays: days })
    }
  }
  return out
}

export function purgeExpiredAuth(nowMs = Date.now()): { sessions: number; refreshTokens: number; jtis: number } {
  const nowIso = new Date(nowMs).toISOString()
  // JTIs are only needed until the assertion itself expires (+ clock tolerance).
  const jtiCutoff = new Date(nowMs - 10 * 60_000).toISOString()
  return {
    sessions: db.prepare('DELETE FROM session WHERE expires_at < ?').run(nowIso).changes,
    refreshTokens: db.prepare('DELETE FROM refresh_token WHERE expires_at < ?').run(nowIso).changes,
    jtis: db.prepare('DELETE FROM used_jti WHERE expires_at < ?').run(jtiCutoff).changes,
  }
}

export function runMaintenance(nowMs = Date.now()) {
  const photos = purgeExpiredPhotos(nowMs)
  const auth = purgeExpiredAuth(nowMs)
  return { photos, auth }
}

/** Start the background job (unref'd so it never keeps the process alive). */
export function startMaintenance(intervalMs = SIX_HOURS_MS): () => void {
  const tick = () => {
    try {
      runMaintenance()
    } catch (e) {
      console.error('[absentra] maintenance failed:', e instanceof Error ? e.message : e)
    }
  }
  tick()
  const t = setInterval(tick, intervalMs)
  t.unref()
  return () => clearInterval(t)
}
