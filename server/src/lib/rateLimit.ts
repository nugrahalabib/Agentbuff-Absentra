/**
 * Tiny in-memory sliding-window rate limiter (no external deps). Single-process
 * deploy, so memory is the right store; keys are namespaced per limiter.
 *
 * `ABSENTRA_RATE_LIMIT_DISABLED=1` turns limits off for local test suites only —
 * it is ignored when NODE_ENV=production.
 */
import type { NextFunction, Request, Response } from 'express'

type KeyFn = (req: Request) => string | null | undefined

const MAX_KEYS = 20_000

export function rateLimitDisabled(): boolean {
  return process.env.ABSENTRA_RATE_LIMIT_DISABLED === '1' && process.env.NODE_ENV !== 'production'
}

export interface Limiter {
  (req: Request, res: Response, next: NextFunction): void
  /** Test helper: forget every recorded hit. */
  reset(): void
}

export function rateLimit(opts: { name: string; max: number; windowMs?: number; key: KeyFn }): Limiter {
  const windowMs = opts.windowMs ?? 60_000
  const hits = new Map<string, number[]>()

  const prune = (cutoff: number) => {
    for (const [k, arr] of hits) {
      const kept = arr.filter((t) => t > cutoff)
      if (kept.length) hits.set(k, kept)
      else hits.delete(k)
    }
  }

  const mw = ((req: Request, res: Response, next: NextFunction) => {
    if (rateLimitDisabled()) return next()
    const k = opts.key(req)
    if (!k) return next()
    const t = Date.now()
    const cutoff = t - windowMs
    const arr = (hits.get(k) ?? []).filter((x) => x > cutoff)
    if (arr.length >= opts.max) {
      hits.set(k, arr)
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((arr[0] + windowMs - t) / 1000))))
      res.status(429).json({ error: 'rate_limited', message: 'Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.' })
      return
    }
    arr.push(t)
    hits.set(k, arr)
    if (hits.size > MAX_KEYS) prune(cutoff)
    next()
  }) as Limiter
  mw.reset = () => hits.clear()
  return mw
}

/** Key by client IP (Express resolves it through `trust proxy`). */
export const byIp = (name: string): KeyFn => (req) => `${name}:ip:${req.ip ?? 'unknown'}`

/** Key by signed-in user (falls back to IP before sign-in). */
export const byUser = (name: string): KeyFn => (req) =>
  req.ctx?.userId ? `${name}:u:${req.ctx.userId}` : `${name}:ip:${req.ip ?? 'unknown'}`

/** The limits applied by the routes (PRD §9.4 abuse protection). */
export const LIMITS = {
  signin: rateLimit({ name: 'signin', max: 10, key: byIp('signin') }),
  inviteAccept: rateLimit({ name: 'invite_accept', max: 20, key: byIp('invite_accept') }),
  clock: rateLimit({ name: 'clock', max: 12, key: byUser('clock') }),
  profilePhoto: rateLimit({ name: 'profile_photo', max: 10, key: byUser('profile_photo') }),
  logo: rateLimit({ name: 'logo', max: 10, key: byUser('logo') }),
  refresh: rateLimit({ name: 'refresh', max: 30, key: byIp('refresh') }),
  sso: rateLimit({ name: 'sso', max: 20, key: byIp('sso') }),
}

export function resetAllLimits(): void {
  for (const l of Object.values(LIMITS)) l.reset()
}
