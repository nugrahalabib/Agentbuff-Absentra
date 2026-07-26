import { describe, expect, it } from 'vitest'
import { config } from '../src/lib/config.js'

describe('password auth allowlist', () => {
  it('isPasswordAllowed menghormati daftar email & wildcard *', () => {
    const prev = config.passwordAuthAllowlist
    ;(config as { passwordAuthAllowlist: string[] }).passwordAuthAllowlist = ['admin@x.com']
    expect(config.isPasswordAllowed('admin@x.com')).toBe(true)
    expect(config.isPasswordAllowed('Admin@X.com')).toBe(true)
    expect(config.isPasswordAllowed('user@x.com')).toBe(false)
    ;(config as { passwordAuthAllowlist: string[] }).passwordAuthAllowlist = ['*']
    expect(config.isPasswordAllowed('anyone@x.com')).toBe(true)
    ;(config as { passwordAuthAllowlist: string[] }).passwordAuthAllowlist = prev
  })
})
