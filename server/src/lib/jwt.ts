/**
 * Signed-assertion / ID-token verification (PRD §7.1.2 Google OIDC, §7.1.3 SSO).
 * Verifies signature (via JWKS), `iss`, `aud`, and `exp`. Used by Google ID-token
 * validation and the Custom SSO Gateway. Returns a tagged result (never throws).
 */
import { jwtVerify, createLocalJWKSet, createRemoteJWKSet, type JWTPayload, type JSONWebKeySet } from 'jose'

export type VerifyResult = { ok: true; payload: JWTPayload } | { ok: false; reason: string }

export async function verifyWithJwks(
  token: string,
  jwks: JSONWebKeySet,
  opts: { issuer?: string | string[]; audience?: string | string[] },
): Promise<VerifyResult> {
  try {
    const keyset = createLocalJWKSet(jwks)
    const { payload } = await jwtVerify(token, keyset, { issuer: opts.issuer, audience: opts.audience, clockTolerance: 5 })
    return { ok: true, payload }
  } catch (e: any) {
    return { ok: false, reason: e?.code ?? e?.message ?? 'verify_failed' }
  }
}

const googleJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))

/** Verify a Google ID Token: signature via Google JWKS + iss/aud/exp (PRD §7.1.2). */
export async function verifyGoogleIdToken(idToken: string, clientId: string): Promise<VerifyResult> {
  try {
    const { payload } = await jwtVerify(idToken, googleJwks, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: clientId,
      clockTolerance: 5,
    })
    return { ok: true, payload }
  } catch (e: any) {
    return { ok: false, reason: e?.code ?? e?.message ?? 'verify_failed' }
  }
}
