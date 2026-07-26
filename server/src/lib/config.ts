/**
 * Runtime config. Loads server/.env (if present) so Google OAuth credentials can
 * be pasted into a gitignored file instead of exported each run. Real Google login
 * activates automatically once GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET are set.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
try {
  const text = readFileSync(join(here, '..', '..', '.env'), 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
  }
} catch { /* no .env file — fine */ }

/** Comma-separated emails allowed to use email+password (admin/dev bypass). */
function parseAllowlist(raw: string | undefined): string[] {
  if (!raw?.trim()) return []
  return raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
}

export const config = {
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  appOrigin: process.env.APP_ORIGIN ?? 'http://localhost:7707',
  passwordAuthAllowlist: parseAllowlist(process.env.PASSWORD_AUTH_ALLOWLIST),
  get googleEnabled() { return !!(this.googleClientId && this.googleClientSecret) },
  get googleRedirectUri() { return process.env.GOOGLE_REDIRECT_URI ?? `${this.appOrigin}/api/auth/google/callback` },
  get passwordAuthEnabled() { return this.passwordAuthAllowlist.length > 0 },
  isPasswordAllowed(email: string) {
    // '*' = allow all (tests / local emergency). Production should list explicit emails.
    if (this.passwordAuthAllowlist.includes('*')) return true
    return this.passwordAuthAllowlist.includes(email.toLowerCase().trim())
  },
}
