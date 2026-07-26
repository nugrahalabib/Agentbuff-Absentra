/** TC-AB-006: signature/exp/aud verification (the crypto core of Google ID-token
 * and SSO assertion validation). Uses a locally generated RS256 keypair. */
import { describe, it, expect, beforeAll } from 'vitest'
import { generateKeyPair, exportJWK, SignJWT, type JSONWebKeySet } from 'jose'
import { verifyWithJwks } from '../src/lib/jwt.js'

let priv: CryptoKey, jwks: JSONWebKeySet
const ISS = 'https://partner.example', AUD = 'absentra'

beforeAll(async () => {
  const kp = await generateKeyPair('RS256')
  priv = kp.privateKey
  const jwk = await exportJWK(kp.publicKey)
  jwks = { keys: [{ ...jwk, kid: 'k1', alg: 'RS256', use: 'sig' }] }
})

const sign = (claims: Record<string, unknown>, expSec: number) =>
  new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) + expSec).sign(priv)

describe('UC-AB-01 TC-AB-006 verifikasi token', () => {
  it('token valid → ok', async () => {
    const t = await sign({ iss: ISS, aud: AUD, sub: 'u1' }, 60)
    const r = await verifyWithJwks(t, jwks, { issuer: ISS, audience: AUD })
    expect(r.ok).toBe(true)
  })
  it('token kedaluwarsa → ditolak', async () => {
    const t = await sign({ iss: ISS, aud: AUD, sub: 'u1' }, -60)
    expect((await verifyWithJwks(t, jwks, { issuer: ISS, audience: AUD })).ok).toBe(false)
  })
  it('aud salah → ditolak', async () => {
    const t = await sign({ iss: ISS, aud: 'other', sub: 'u1' }, 60)
    expect((await verifyWithJwks(t, jwks, { issuer: ISS, audience: AUD })).ok).toBe(false)
  })
  it('signature salah (keypair berbeda) → ditolak', async () => {
    const other = await generateKeyPair('RS256')
    const bad = await new SignJWT({ iss: ISS, aud: AUD }).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) + 60).sign(other.privateKey)
    expect((await verifyWithJwks(bad, jwks, { issuer: ISS, audience: AUD })).ok).toBe(false)
  })
})
