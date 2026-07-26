import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'

/** Hash a password (dev email/password auth). Format: `salt:hashHex`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored || !stored.includes(':')) return false
  const [salt, hash] = stored.split(':')
  const calc = scryptSync(password, salt, 64)
  const orig = Buffer.from(hash, 'hex')
  return calc.length === orig.length && timingSafeEqual(calc, orig)
}
