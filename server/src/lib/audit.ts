import { db, now } from './db.js'
import { id } from './ids.js'
import type { ActorType, AuditSource } from '../domain/types.js'

/** Append-only audit log (PRD §9.4, §7.5.7). PII should be redacted in metadata. */
export function audit(opts: {
  companyId: string
  actorType: ActorType
  actorId: string
  action: string
  target?: string
  metadata?: Record<string, unknown>
  source?: AuditSource
  ip?: string
}) {
  // Redact PII (emails) from audit metadata (PRD §9.4 — audit must not leak PII).
  const redacted = opts.metadata
    ? JSON.parse(JSON.stringify(opts.metadata).replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted-email]'))
    : undefined
  db.prepare(
    `INSERT INTO audit_log (id, company_id, actor_type, actor_id, action, target, metadata, source, ip, created_at)
     VALUES (@id, @companyId, @actorType, @actorId, @action, @target, @metadata, @source, @ip, @createdAt)`,
  ).run({
    id: id('aud'),
    companyId: opts.companyId,
    actorType: opts.actorType,
    actorId: opts.actorId,
    action: opts.action,
    target: opts.target ?? null,
    metadata: redacted ? JSON.stringify(redacted) : null,
    source: opts.source ?? 'ui',
    ip: opts.ip ?? null,
    createdAt: now(),
  })
}
