/**
 * "Masuk dengan AgentBuff" — klien OpenID Connect (authorization code + PKCE).
 *
 * PEMILIK perusahaan masuk (dan mendaftar) dengan akun AgentBuff-nya. AgentBuff
 * sendiri yang memastikan ia berhak (akun aktif + langganan/trial hidup +
 * memiliki Absentra) SEBELUM kode diterbitkan. Karyawan tetap masuk dengan
 * akun undangan dari pemilik/admin (Google sesuai email undangan). Kontrak:
 * Docs/MASUK-DENGAN-AGENTBUFF.md di repo AgentBuff.
 *
 * id_token diterima LANGSUNG dari token endpoint lewat TLS dengan autentikasi
 * aplikasi, dan tetap diverifikasi penuh: tanda tangan ES256 lewat JWKS
 * AgentBuff (jose, kunci disinggahkan), iss, aud, exp, nonce.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'

const ISSUER = (process.env.AGENTBUFF_MASUK_ISSUER ?? 'https://agentbuff.id/masuk').replace(/\/+$/, '')
const CLIENT_ID = process.env.AGENTBUFF_MASUK_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.AGENTBUFF_MASUK_CLIENT_SECRET ?? ''
const TIMEOUT_MS = 10_000
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/jwks`))

export function masukSiap(): boolean {
  return !!(CLIENT_ID && CLIENT_SECRET)
}

const b64url = (b: Buffer) => b.toString('base64url')

export interface BahanMasuk {
  state: string
  nonce: string
  verifier: string
  challenge: string
}

export function bahanBaru(): BahanMasuk {
  const verifier = b64url(randomBytes(32))
  return {
    state: b64url(randomBytes(24)),
    nonce: b64url(randomBytes(24)),
    verifier,
    challenge: b64url(createHash('sha256').update(verifier, 'ascii').digest()),
  }
}

export function urlOtorisasi(bahan: BahanMasuk, redirectUri: string, pilihAkun = false): string {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'openid email profile',
    state: bahan.state,
    nonce: bahan.nonce,
    code_challenge: bahan.challenge,
    code_challenge_method: 'S256',
  })
  if (pilihAkun) q.set('prompt', 'select_account')
  return `${ISSUER}/authorize?${q.toString()}`
}

function basicAuth(): string {
  return `Basic ${Buffer.from(`${encodeURIComponent(CLIENT_ID)}:${encodeURIComponent(CLIENT_SECRET)}`).toString('base64')}`
}

async function postForm(path: string, badan: Record<string, string>): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    return await fetch(`${ISSUER}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', authorization: basicAuth() },
      body: new URLSearchParams(badan),
      signal: ctrl.signal,
    })
  } finally {
    clearTimeout(t)
  }
}

export interface AkunAgentBuff {
  sub: string
  email: string
  name: string | null
  picture: string | null
}

function samaWaktuTetap(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** Tukar kode → akun terverifikasi. Melempar Error berpesan singkat bila gagal. */
export async function tukarKode(code: string, verifier: string, nonce: string, redirectUri: string): Promise<AkunAgentBuff> {
  const res = await postForm('/token', { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier })
  if (!res.ok) throw new Error(`token_${res.status}`)
  const tok = (await res.json()) as { id_token?: string }
  let k: JWTPayload & Record<string, unknown>
  try {
    const hasil = await jwtVerify(tok.id_token ?? '', JWKS, { issuer: ISSUER, audience: CLIENT_ID, algorithms: ['ES256'], clockTolerance: 60 })
    k = hasil.payload as JWTPayload & Record<string, unknown>
  } catch {
    throw new Error('id_token_tidak_sah')
  }
  if (typeof k.nonce !== 'string' || !samaWaktuTetap(k.nonce, nonce)) throw new Error('nonce_tidak_cocok')
  const email = typeof k.email === 'string' ? k.email.trim().toLowerCase() : ''
  if (typeof k.sub !== 'string' || !k.sub || !email || k.email_verified !== true) throw new Error('email_tidak_terverifikasi')
  return {
    sub: k.sub,
    email,
    name: typeof k.name === 'string' ? k.name : null,
    picture: typeof k.picture === 'string' ? k.picture : null,
  }
}

export interface StatusPemilik {
  aktif: boolean
  alasan: string
  sub: string | null
}

/**
 * Pemeriksaan berkala hak pemilik (`/masuk/status`). Kunci `sub` bila sudah
 * diketahui; email hanya untuk pemilik lama yang belum pernah masuk lewat
 * AgentBuff. `null` = AgentBuff tidak terjangkau / jawaban tak dikenal.
 */
export async function statusPemilik(sub: string | null, email: string | null): Promise<StatusPemilik | null> {
  try {
    const badan: Record<string, string> = sub ? { sub } : { email: (email ?? '').trim().toLowerCase() }
    const res = await postForm('/status', badan)
    if (!res.ok) return null
    const d = (await res.json()) as { aktif?: unknown; alasan?: unknown; sub?: unknown }
    if (typeof d.aktif !== 'boolean') return null
    return { aktif: d.aktif, alasan: typeof d.alasan === 'string' ? d.alasan : d.aktif ? 'ok' : 'akses_berakhir', sub: typeof d.sub === 'string' ? d.sub : null }
  } catch {
    return null
  }
}
