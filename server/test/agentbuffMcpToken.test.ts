/**
 * Sambung MCP otomatis dari AgentBuff — POST /api/agentbuff/mcp-token.
 * Kontrak: Docs/MASUK-DENGAN-AGENTBUFF.md §"Sambung MCP otomatis" (repo AgentBuff).
 *
 * AgentBuff dipalsukan dengan server HTTP lokal sungguhan (JWKS + /masuk/status),
 * jadi jalur produksi yang diuji utuh: createRemoteJWKSet, gerbang hak pemilik,
 * dan /mcp yang memakai token hasil terbitan. Tidak ada celah uji di kode produksi.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import type { Express } from 'express'

const CLIENT_ID = 'absentra'
const CLIENT_SECRET = 'rahasia-uji'
let ISS = ''
let app: Express
let db: any
let MCP_SCOPES: readonly string[]
let toolScopes: () => string[]
let kunci: CryptoKey
let server: Server
/** Jawaban /masuk/status per sub (bawaan: berhak). */
const statusPerSub = new Map<string, { aktif: boolean; alasan: string }>()
const panggilanStatus: string[] = []

beforeAll(async () => {
  const kp = await generateKeyPair('ES256')
  kunci = kp.privateKey
  const jwk = { ...(await exportJWK(kp.publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' }
  const basicDiharapkan = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`

  server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/masuk/jwks') {
      res.setHeader('content-type', 'application/json')
      return res.end(JSON.stringify({ keys: [jwk] }))
    }
    if (req.method === 'POST' && req.url === '/masuk/status') {
      let badan = ''
      req.on('data', (c) => { badan += c })
      req.on('end', () => {
        res.setHeader('content-type', 'application/json')
        if (req.headers.authorization !== basicDiharapkan) { res.statusCode = 401; return res.end('{}') }
        const q = new URLSearchParams(badan)
        const sub = q.get('sub') ?? ''
        panggilanStatus.push(sub)
        const s = statusPerSub.get(sub) ?? { aktif: true, alasan: 'ok' }
        res.end(JSON.stringify({ ...s, sub }))
      })
      return
    }
    res.statusCode = 404
    res.end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const port = (server.address() as { port: number }).port
  ISS = `http://127.0.0.1:${port}/masuk`

  const dir = mkdtempSync(join(tmpdir(), 'absentra-abmcp-'))
  process.env.ABSENTRA_DB = join(dir, 'test.db')
  process.env.AGENTBUFF_MASUK_ISSUER = ISS
  process.env.AGENTBUFF_MASUK_CLIENT_ID = CLIENT_ID
  process.env.AGENTBUFF_MASUK_CLIENT_SECRET = CLIENT_SECRET
  delete process.env.AGENTBUFF_GATE_DISABLED
  app = (await import('../src/app.js')).createApp()
  db = (await import('../src/lib/db.js')).db
  MCP_SCOPES = (await import('../src/lib/mcpKoneksi.js')).MCP_SCOPES
  toolScopes = (await import('../src/routes/mcpServer.js')).toolScopes
})

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()))
})

// ---------------- penolong ----------------

let urut = 0
const iso = (msLalu: number) => new Date(Date.now() - msLalu).toISOString()

function buatUser(email: string, sub: string | null): string {
  const uid = `usr_uji${++urut}`
  db.prepare('INSERT INTO user (id, google_sub, email, name, created_at, agentbuff_sub) VALUES (?,?,?,?,?,?)').run(uid, null, email, email.split('@')[0], iso(0), sub)
  return uid
}

function buatPerusahaan(userId: string, nama: string, role = 'owner', dibuatMsLalu = 0, status = 'active'): string {
  const cid = `co_uji${++urut}`
  db.prepare(`INSERT INTO company (id, legal_name, display_name, business_type, timezone, workweek_type, created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(cid, nama, nama, 'Kuliner', 'Asia/Jakarta', 'six_day', iso(dibuatMsLalu))
  db.prepare(`INSERT INTO membership (id, company_id, user_id, role, scope_branch_ids, scope_division_ids, status, created_at) VALUES (?,?,?,?, '[]','[]', ?, ?)`)
    .run(`mem_uji${++urut}`, cid, userId, role, status, iso(dibuatMsLalu))
  db.prepare(`INSERT INTO policy (company_id) VALUES (?)`).run(cid)
  return cid
}

interface Opsi {
  sub?: string
  email?: string
  emailVerified?: boolean
  aud?: string
  iss?: string
  typ?: string | null
  purpose?: string | null
  jti?: string
  iatDetikLalu?: number
  expDetik?: number // relatif terhadap sekarang
  kid?: string | null
  kunciLain?: CryptoKey
}

async function assertion(o: Opsi = {}): Promise<string> {
  const t = Math.floor(Date.now() / 1000)
  const klaim: Record<string, unknown> = {}
  if (o.purpose !== null) klaim.purpose = o.purpose ?? 'mcp_token'
  if (o.email) { klaim.email = o.email; klaim.email_verified = o.emailVerified ?? true }
  const header: Record<string, unknown> = { alg: 'ES256' }
  if (o.typ !== null) header.typ = o.typ ?? 'mcp-token+jwt'
  if (o.kid !== null) header.kid = o.kid ?? 'k1'
  return new SignJWT(klaim)
    .setProtectedHeader(header as any)
    .setIssuer(o.iss ?? ISS)
    .setAudience(o.aud ?? CLIENT_ID)
    .setSubject(o.sub ?? 'abs_tidak_ada')
    .setJti(o.jti ?? randomUUID())
    .setIssuedAt(t - (o.iatDetikLalu ?? 0))
    .setExpirationTime(t + (o.expDetik ?? 120))
    .sign(o.kunciLain ?? kunci)
}

const minta = (a: string | null) => {
  const r = request(app).post('/api/agentbuff/mcp-token').send({})
  return a === null ? r : r.set('Authorization', `Bearer ${a}`)
}
const rpc = (tok: string, method: string, params?: unknown) =>
  request(app).post('/mcp').set('Authorization', `Bearer ${tok}`).send({ jsonrpc: '2.0', id: 1, method, params })

const koneksiOtomatis = (userId: string) =>
  db.prepare(`SELECT * FROM mcp_connection WHERE created_by = ? AND agent_name = 'AgentBuff (otomatis)' ORDER BY created_at, rowid`).all(userId) as any[]

// ---------------- skenario ----------------

describe('POST /api/agentbuff/mcp-token — berhasil', () => {
  it('assertion sah → 200, koneksi berlabel + cakupan penuh, token benar-benar dipakai /mcp', async () => {
    const uid = buatUser('pemilik1@abmcp.test', 'abs_pemilik1')
    buatPerusahaan(uid, 'Warung Lama', 'owner', 3 * 864e5)
    const cidBaru = buatPerusahaan(uid, 'Warung Baru', 'owner', 864e5)
    buatPerusahaan(uid, 'Tempat Kerja Lain', 'employee', 1000) // lebih baru, tetapi bukan pemilik
    buatPerusahaan(uid, 'Usaha Nonaktif', 'owner', 500, 'disabled') // terbaru, tetapi keanggotaan tidak aktif

    const log = vi.spyOn(console, 'log'), err = vi.spyOn(console, 'error'), warn = vi.spyOn(console, 'warn')
    const r = await minta(await assertion({ sub: 'abs_pemilik1' }))
    expect(r.status).toBe(200)
    expect(r.headers['cache-control']).toBe('no-store')
    expect(r.body.expires_at).toBeNull()
    expect(r.body.tenant_name).toBe('Warung Baru')
    expect(r.body.token).toMatch(/^mcp_[a-z0-9]{56}$/)

    const semuaLog = [...log.mock.calls, ...err.mock.calls, ...warn.mock.calls].flat().map(String).join('\n')
    expect(semuaLog).not.toContain(r.body.token)
    log.mockRestore(); err.mockRestore(); warn.mockRestore()

    const [k] = koneksiOtomatis(uid)
    expect(k.company_id).toBe(cidBaru)
    expect(k.status).toBe('active')
    expect(k.oauth_client_id).toBe('agentbuff_otomatis')
    expect(JSON.parse(k.scopes)).toEqual([...MCP_SCOPES])
    expect(JSON.parse(k.scope_branch_ids)).toEqual([]) // kosong = semua cabang
    expect(k.token_hash).not.toContain(r.body.token)

    const jejak = db.prepare(`SELECT * FROM audit_log WHERE company_id = ? AND action = 'mcp.connection.create'`).all(cidBaru) as any[]
    expect(jejak).toHaveLength(1)
    expect(jejak[0].actor_id).toBe('agentbuff:otomatis')
    expect(jejak[0].actor_type).toBe('agent')
    expect(JSON.stringify(jejak[0])).not.toContain(r.body.token)

    const init = await rpc(r.body.token, 'initialize')
    expect(init.status).toBe(200)
    expect(init.body.result.serverInfo.name).toBe('absentra-mcp')
    const daftar = await rpc(r.body.token, 'tools/list')
    const nama = (daftar.body.result.tools as any[]).map((t) => t.name)
    expect(nama).toEqual(expect.arrayContaining(['company.get', 'audit.recent', 'policy.set', 'payroll.recap', 'attendance.correct']))
    const perusahaan = await rpc(r.body.token, 'tools/call', { name: 'company.get', arguments: {} })
    expect(perusahaan.body.result.company.id).toBe(cidBaru)
  })

  it('setiap cakupan yang dipakai alat MCP ada di MCP_SCOPES (token otomatis tidak pernah kurang cakupan)', () => {
    for (const s of toolScopes()) expect(MCP_SCOPES).toContain(s)
  })

  it('panggilan kedua mencabut token otomatis pertama; koneksi buatan tangan tidak tersentuh', async () => {
    const uid = buatUser('pemilik2@abmcp.test', 'abs_pemilik2')
    const cid = buatPerusahaan(uid, 'Kedai Dua')
    const { terbitkanKoneksiMcp } = await import('../src/lib/mcpKoneksi.js')
    const tangan = terbitkanKoneksiMcp({ companyId: cid, agentName: 'Claude Desktop', scopes: ['attendance:read'], createdBy: uid })

    const r1 = await minta(await assertion({ sub: 'abs_pemilik2' }))
    const r2 = await minta(await assertion({ sub: 'abs_pemilik2' }))
    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    expect(r2.body.token).not.toBe(r1.body.token)

    const semua = koneksiOtomatis(uid)
    expect(semua.map((k) => k.status)).toEqual(['revoked', 'active'])
    expect((await rpc(r1.body.token, 'initialize')).status).toBe(401)
    expect((await rpc(r2.body.token, 'initialize')).status).toBe(200)

    expect((db.prepare('SELECT status FROM mcp_connection WHERE id = ?').get(tangan.id) as any).status).toBe('active')
    expect((await rpc(tangan.accessToken, 'initialize')).status).toBe(200)
    const cabut = db.prepare(`SELECT * FROM audit_log WHERE company_id = ? AND action = 'mcp.connection.revoke'`).all(cid) as any[]
    expect(cabut.map((a) => a.target)).toEqual([semua[0].id])
  })

  it('pemilik lama (belum punya sub) cocok lewat email terverifikasi → sub disimpan', async () => {
    const uid = buatUser('lama@abmcp.test', null)
    buatPerusahaan(uid, 'Toko Lama')
    const r = await minta(await assertion({ sub: 'abs_lama', email: 'Lama@ABMCP.test' }))
    expect(r.status).toBe(200)
    expect(r.body.tenant_name).toBe('Toko Lama')
    expect((db.prepare('SELECT agentbuff_sub FROM user WHERE id = ?').get(uid) as any).agentbuff_sub).toBe('abs_lama')
    expect(panggilanStatus).toContain('abs_lama') // gerbang ditanya dengan sub yang baru disimpan
    // Panggilan berikutnya cukup dengan sub.
    expect((await minta(await assertion({ sub: 'abs_lama' }))).status).toBe(200)
  })
})

describe('POST /api/agentbuff/mcp-token — assertion ditolak (401)', () => {
  let sah: () => Promise<string>
  beforeAll(() => {
    const uid = buatUser('tolak@abmcp.test', 'abs_tolak')
    buatPerusahaan(uid, 'Usaha Tolak')
    sah = () => assertion({ sub: 'abs_tolak' })
  })

  const tolak = async (a: string | null) => {
    const r = await minta(a)
    expect(r.status).toBe(401)
    expect(r.body).toEqual({ error: 'assertion_invalid' })
  }

  it('pembanding: assertion sah memang diterima', async () => {
    expect((await minta(await sah())).status).toBe(200)
  })
  it('tanpa Authorization', async () => { await tolak(null) })
  it('id_token biasa (tanpa purpose, typ JWT)', async () => { await tolak(await assertion({ sub: 'abs_tolak', purpose: null, typ: 'JWT' })) })
  it('typ benar tetapi tanpa purpose', async () => { await tolak(await assertion({ sub: 'abs_tolak', purpose: null })) })
  it('purpose lain', async () => { await tolak(await assertion({ sub: 'abs_tolak', purpose: 'login' })) })
  it('typ salah', async () => { await tolak(await assertion({ sub: 'abs_tolak', typ: 'JWT' })) })
  it('tanpa typ', async () => { await tolak(await assertion({ sub: 'abs_tolak', typ: null })) })
  it('aud salah', async () => { await tolak(await assertion({ sub: 'abs_tolak', aud: 'kostcloud' })) })
  it('iss salah', async () => { await tolak(await assertion({ sub: 'abs_tolak', iss: 'https://evil.test/masuk' })) })
  it('kedaluwarsa', async () => { await tolak(await assertion({ sub: 'abs_tolak', iatDetikLalu: 200, expDetik: -100 })) })
  it('iat terlalu tua walau exp masih jauh', async () => { await tolak(await assertion({ sub: 'abs_tolak', iatDetikLalu: 300, expDetik: 600 })) })
  it('tanda tangan kunci lain (kid sama)', async () => {
    const lain = await generateKeyPair('ES256')
    await tolak(await assertion({ sub: 'abs_tolak', kunciLain: lain.privateKey }))
  })
  it('tanpa kid', async () => { await tolak(await assertion({ sub: 'abs_tolak', kid: null })) })
  it('jti diputar ulang', async () => {
    const a = await assertion({ sub: 'abs_tolak', jti: 'jti-sekali-pakai' })
    expect((await minta(a)).status).toBe(200)
    await tolak(a)
  })
})

describe('POST /api/agentbuff/mcp-token — pemilik/hak', () => {
  it('sub & email tak dikenal → 404 belum_ada_akun', async () => {
    const r = await minta(await assertion({ sub: 'abs_asing', email: 'asing@abmcp.test' }))
    expect(r.status).toBe(404)
    expect(r.body).toEqual({ error: 'belum_ada_akun' })
  })

  it('pemilik tanpa perusahaan → 404', async () => {
    buatUser('kosong@abmcp.test', 'abs_kosong')
    const r = await minta(await assertion({ sub: 'abs_kosong' }))
    expect(r.status).toBe(404)
    expect(r.body).toEqual({ error: 'belum_ada_akun' })
  })

  it('hanya karyawan (bukan pemilik) → 404, sub TIDAK disimpan lewat email', async () => {
    const uid = buatUser('karyawan@abmcp.test', null)
    buatPerusahaan(uid, 'Tempat Kerja', 'employee')
    const r = await minta(await assertion({ sub: 'abs_karyawan', email: 'karyawan@abmcp.test' }))
    expect(r.status).toBe(404)
    expect((db.prepare('SELECT agentbuff_sub FROM user WHERE id = ?').get(uid) as any).agentbuff_sub).toBeNull()
  })

  it('email tidak terverifikasi → tidak dipakai (404), sub tidak disimpan', async () => {
    const uid = buatUser('belumverif@abmcp.test', null)
    buatPerusahaan(uid, 'Usaha Belum Verif')
    const r = await minta(await assertion({ sub: 'abs_belumverif', email: 'belumverif@abmcp.test', emailVerified: false }))
    expect(r.status).toBe(404)
    expect((db.prepare('SELECT agentbuff_sub FROM user WHERE id = ?').get(uid) as any).agentbuff_sub).toBeNull()
  })

  it('email milik akun yang sudah tertaut ke sub lain → 404, tautan tidak ditimpa', async () => {
    const uid = buatUser('tertaut@abmcp.test', 'abs_asli')
    buatPerusahaan(uid, 'Usaha Tertaut')
    const r = await minta(await assertion({ sub: 'abs_penyusup', email: 'tertaut@abmcp.test' }))
    expect(r.status).toBe(404)
    expect((db.prepare('SELECT agentbuff_sub FROM user WHERE id = ?').get(uid) as any).agentbuff_sub).toBe('abs_asli')
  })

  it('hak pemilik tidak aktif → 403 tidak_berhak + alasan, tidak ada token diterbitkan', async () => {
    const uid = buatUser('lapsed@abmcp.test', 'abs_lapsed')
    buatPerusahaan(uid, 'Usaha Berhenti')
    statusPerSub.set('abs_lapsed', { aktif: false, alasan: 'akses_berakhir' })
    const r = await minta(await assertion({ sub: 'abs_lapsed' }))
    expect(r.status).toBe(403)
    expect(r.body).toEqual({ error: 'tidak_berhak', reason: 'akses_berakhir' })
    expect(koneksiOtomatis(uid)).toHaveLength(0)
  })

  it('lebih dari 10 permintaan/menit untuk sub yang sama → 429', async () => {
    const uid = buatUser('sering@abmcp.test', 'abs_sering')
    buatPerusahaan(uid, 'Usaha Sering')
    for (let i = 0; i < 10; i++) expect((await minta(await assertion({ sub: 'abs_sering' }))).status).toBe(200)
    const r = await minta(await assertion({ sub: 'abs_sering' }))
    expect(r.status).toBe(429)
    expect(r.body).toEqual({ error: 'terlalu_sering' })
    // Pemilik lain tidak ikut terkena.
    expect((await minta(await assertion({ sub: 'abs_pemilik1' }))).status).toBe(200)
    // Hanya satu token otomatis yang tetap aktif walau diterbitkan 10 kali.
    expect(koneksiOtomatis(uid).filter((k) => k.status === 'active')).toHaveLength(1)
  })
})
