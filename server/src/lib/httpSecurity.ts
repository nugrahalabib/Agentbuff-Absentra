/**
 * HTTP-layer hardening: CSRF origin guard for cookie-authenticated mutations and
 * cookie flags that follow the real transport (HTTPS behind the proxy).
 *
 * Production is single-origin (the SPA and the API share one host), so a
 * state-changing `/api/*` request whose Origin is not the app origin can only be
 * a cross-site forgery. SameSite=Lax stays on the session cookie (the OIDC
 * redirect back to us needs it); this guard covers CSRF.
 */
import type { CookieOptions, NextFunction, Request, Response } from 'express'

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Enforced in production; tests opt in with ABSENTRA_ENFORCE_ORIGIN=1. */
export function originGuardEnforced(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.ABSENTRA_ENFORCE_ORIGIN === '1'
}

function normalizeOrigin(raw: string): string | null {
  try {
    return new URL(raw).origin
  } catch {
    return null
  }
}

/** The app's own origin: APP_ORIGIN when configured, else the request's host. */
export function appOriginFor(req: Request): string {
  const configured = process.env.APP_ORIGIN ? normalizeOrigin(process.env.APP_ORIGIN) : null
  return configured ?? `${req.protocol}://${req.get('host')}`
}

/**
 * Exempt: server-to-server endpoints that authenticate with a bearer/assertion,
 * never with the browser session (AgentBuff back-channel). `/mcp` is outside
 * `/api` and uses bearer tokens, so it never reaches the check.
 */
function exempt(path: string): boolean {
  return path.startsWith('/api/agentbuff/')
}

export function originGuard(req: Request, res: Response, next: NextFunction) {
  if (!originGuardEnforced()) return next()
  if (!STATE_CHANGING.has(req.method)) return next()
  const path = req.path
  if (!path.startsWith('/api/') || exempt(path)) return next()

  const origin = req.get('origin')
  if (origin) {
    if (normalizeOrigin(origin) === appOriginFor(req)) return next()
    return res.status(403).json({ error: 'forbidden_origin', message: 'Permintaan ditolak karena berasal dari situs lain.' })
  }
  // No Origin header: trust the browser's Fetch Metadata when present. Requests
  // with neither header are not from a browser and cannot ride a victim's cookie.
  const site = req.get('sec-fetch-site')
  if (!site || site === 'same-origin' || site === 'none') return next()
  return res.status(403).json({ error: 'forbidden_origin', message: 'Permintaan ditolak karena berasal dari situs lain.' })
}

/** Is this response going out over HTTPS (directly or via the trusted proxy)? */
export function isSecureRequest(req: Request): boolean {
  return req.secure || (process.env.APP_ORIGIN ?? '').startsWith('https://')
}

export function cookieOpts(req: Request, maxAgeMs: number, path = '/'): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure: isSecureRequest(req), maxAge: maxAgeMs, path }
}
