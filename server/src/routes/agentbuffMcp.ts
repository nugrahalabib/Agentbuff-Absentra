/**
 * Sambung MCP otomatis dari AgentBuff — `POST /api/agentbuff/mcp-token`.
 * Kontrak: Docs/MASUK-DENGAN-AGENTBUFF.md §"Sambung MCP otomatis" (repo AgentBuff).
 *
 * SERVER AgentBuff (bukan peramban) memanggil ini dengan `Authorization: Bearer
 * <assertion>`: JWT ES256 bertanda tangan kunci Masuk AgentBuff, `typ:
 * mcp-token+jwt`, `purpose: mcp_token`. Tanpa cookie/sesi. Kita menerbitkan
 * token MCP BIASA untuk perusahaan pemilik (tabel mcp_connection, audit, batas
 * laju /mcp, dan cabut dari layar Koneksi Agen tetap berlaku) — AgentBuff hanya
 * perantara yang memasangnya di konektor agen pemilik.
 *
 * Urutan: verifikasi assertion → batas laju per sub → anti-putar-ulang jti →
 * cari PEMILIK (sub, lalu email terverifikasi; cocok lewat email → simpan sub)
 * → perusahaan aktif terbaru tempat ia pemilik → hak lewat gerbang (/masuk/status,
 * cache) → cabut token otomatis lama milik pemilik yang sama → terbitkan baru.
 *
 * Token TIDAK PERNAH dicatat (log maupun audit) — hanya dikembalikan sekali.
 */
import { Router, type Request, type Response } from 'express'
import { db } from '../lib/db.js'
import { audit } from '../lib/audit.js'
import { masukSiap, verifikasiAssertionMcp } from '../lib/agentbuffMasuk.js'
import { ownerEntitlement } from '../lib/agentbuffGate.js'
import { MCP_SCOPES, terbitkanKoneksiMcp } from '../lib/mcpKoneksi.js'

export const agentbuffMcpRouter = Router()

/** Label koneksi yang terlihat pemilik di layar Koneksi Agen. */
export const LABEL_OTOMATIS = 'AgentBuff (otomatis)'
/** oauth_client_id penanda koneksi otomatis — koneksi buatan tangan tidak pernah ikut tercabut. */
export const KLIEN_OTOMATIS = 'agentbuff_otomatis'
const AKTOR_AUDIT = 'agentbuff:otomatis'

// ---- anti-putar-ulang jti (assertion hidup maks ~4 menit termasuk toleransi jam) ----
const JTI_SIMPAN_MS = 10 * 60_000
const jtiTerpakai = new Map<string, number>() // jti → kedaluwarsa (ms)

/** true = jti baru (lalu dicatat); false = sudah pernah dipakai. */
function klaimJti(jti: string): boolean {
  const t = Date.now()
  for (const [k, sampai] of jtiTerpakai) if (sampai <= t) jtiTerpakai.delete(k)
  if (jtiTerpakai.has(jti)) return false
  jtiTerpakai.set(jti, t + JTI_SIMPAN_MS)
  return true
}

// ---- batas laju: 10 permintaan / menit per pemilik (sub) ----
const BATAS_PER_MENIT = 10
const laju = new Map<string, { n: number; reset: number }>()

function terlaluSering(sub: string): boolean {
  const t = Date.now()
  for (const [k, v] of laju) if (v.reset <= t) laju.delete(k)
  const b = laju.get(sub)
  if (!b) { laju.set(sub, { n: 1, reset: t + 60_000 }); return false }
  b.n++
  return b.n > BATAS_PER_MENIT
}

interface Pemilik { id: string; email: string; agentbuff_sub: string | null }
interface Perusahaan { id: string; display_name: string }

/** Perusahaan AKTIF terbaru tempat user ini pemilik (satu pemilik bisa punya beberapa). */
function perusahaanTerbaru(userId: string): Perusahaan | null {
  const row = db.prepare(
    `SELECT c.id AS id, c.display_name AS display_name
       FROM membership m JOIN company c ON c.id = m.company_id
      WHERE m.user_id = ? AND m.role = 'owner' AND m.status = 'active'
      ORDER BY c.created_at DESC, c.rowid DESC LIMIT 1`,
  ).get(userId) as Perusahaan | undefined
  return row ?? null
}

/**
 * Cari PEMILIK: `agentbuff_sub = sub`, lalu email terverifikasi — hanya akun yang
 * memang pemilik perusahaan, dan hanya bila belum tertaut ke identitas AgentBuff
 * lain (dua orang tidak pernah digabung). Cocok lewat email → `sub` disimpan.
 */
function cariPemilik(sub: string, email: string | null): Pemilik | null {
  const bySub = db.prepare('SELECT id, email, agentbuff_sub FROM user WHERE agentbuff_sub = ?').get(sub) as Pemilik | undefined
  if (bySub) return bySub
  if (!email) return null
  const byEmail = db.prepare('SELECT id, email, agentbuff_sub FROM user WHERE email = ?').get(email) as Pemilik | undefined
  if (!byEmail || byEmail.agentbuff_sub) return null
  if (!perusahaanTerbaru(byEmail.id)) return null
  const r = db.prepare('UPDATE user SET agentbuff_sub = ? WHERE id = ? AND agentbuff_sub IS NULL').run(sub, byEmail.id)
  if (r.changes !== 1) return null
  return { ...byEmail, agentbuff_sub: sub }
}

/** Cabut token otomatis lama milik pemilik ini (satu token otomatis per pemilik), lalu terbitkan yang baru. */
function gantiTokenOtomatis(pemilik: Pemilik, perusahaan: Perusahaan): string {
  const tx = db.transaction(() => {
    const lama = db.prepare(
      `SELECT id, company_id FROM mcp_connection
        WHERE created_by = ? AND oauth_client_id = ? AND agent_name = ? AND status = 'active'`,
    ).all(pemilik.id, KLIEN_OTOMATIS, LABEL_OTOMATIS) as { id: string; company_id: string }[]
    const cabut = db.prepare(`UPDATE mcp_connection SET status = 'revoked' WHERE id = ? AND company_id = ?`)
    for (const k of lama) {
      cabut.run(k.id, k.company_id)
      audit({
        companyId: k.company_id, actorType: 'agent', actorId: AKTOR_AUDIT, action: 'mcp.connection.revoke', target: k.id, source: 'sso',
        metadata: { via: 'agentbuff', atasNama: pemilik.id, alasan: 'diganti_token_otomatis_baru' },
      })
    }
    const baru = terbitkanKoneksiMcp({
      companyId: perusahaan.id, agentName: LABEL_OTOMATIS, scopes: MCP_SCOPES, scopeBranchIds: [],
      createdBy: pemilik.id, oauthClientId: KLIEN_OTOMATIS,
    })
    audit({
      companyId: perusahaan.id, actorType: 'agent', actorId: AKTOR_AUDIT, action: 'mcp.connection.create', target: baru.id, source: 'sso',
      metadata: { via: 'agentbuff', atasNama: pemilik.id, scopes: [...MCP_SCOPES], dicabut: lama.length },
    })
    return baru.accessToken
  })
  return tx()
}

agentbuffMcpRouter.post('/agentbuff/mcp-token', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store')
  try {
    if (!masukSiap()) return res.status(503).json({ error: 'agentbuff_not_configured' })
    const m = String(req.headers.authorization ?? '').match(/^Bearer\s+(\S+)$/i)
    const a = m ? await verifikasiAssertionMcp(m[1]) : null
    if (!a) return res.status(401).json({ error: 'assertion_invalid' })
    if (terlaluSering(a.sub)) return res.status(429).json({ error: 'terlalu_sering' })
    if (!klaimJti(a.jti)) return res.status(401).json({ error: 'assertion_invalid' })

    const pemilik = cariPemilik(a.sub, a.email)
    const perusahaan = pemilik ? perusahaanTerbaru(pemilik.id) : null
    if (!pemilik || !perusahaan) return res.status(404).json({ error: 'belum_ada_akun' })

    const hak = await ownerEntitlement(pemilik.id)
    if (!hak.entitled) return res.status(403).json({ error: 'tidak_berhak', reason: hak.reason })

    const tokenMcp = gantiTokenOtomatis(pemilik, perusahaan)
    return res.json({ token: tokenMcp, expires_at: null, tenant_name: perusahaan.display_name })
  } catch (e) {
    // Jangan pernah mencetak objek permintaan/jawaban (bisa memuat assertion/token).
    console.error('agentbuff mcp-token gagal:', e instanceof Error ? e.message : 'unknown')
    return res.status(500).json({ error: 'server_error' })
  }
})
