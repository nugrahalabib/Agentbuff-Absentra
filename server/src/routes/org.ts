import { Router } from 'express'
import { z } from 'zod'
import { db, now } from '../lib/db.js'
import { id } from '../lib/ids.js'
import { mapBranch, mapGeofence, mapDivision } from '../lib/map.js'
import { requireCompany, requireCap } from '../lib/context.js'
import { audit } from '../lib/audit.js'

export const orgRouter = Router()

function scopeBranchFilter(req: any): string[] | null {
  const m = req.ctx.actor.membership
  return m.scopeBranchIds.length > 0 ? m.scopeBranchIds : null
}

// ---- Branches (+ geofence embedded) ----
orgRouter.get('/branches', requireCompany, (req, res) => {
  const cid = req.ctx!.companyId!
  const scope = scopeBranchFilter(req)
  let rows = db.prepare(`SELECT * FROM branch WHERE company_id = ? AND status = 'active' ORDER BY created_at`).all(cid) as any[]
  if (scope) rows = rows.filter((b) => scope.includes(b.id))
  const result = rows.map((b) => {
    const g = db.prepare('SELECT * FROM geofence WHERE company_id = ? AND branch_id = ?').get(cid, b.id) as any
    return { ...mapBranch(b), geofence: g ? mapGeofence(g) : null }
  })
  res.json(result)
})

orgRouter.post('/branches', requireCompany, requireCap('branch.manage'), (req, res) => {
  const body = z.object({
    name: z.string().min(1),
    address: z.string().optional(),
    lat: z.number(), long: z.number(),
    radiusM: z.number().positive().max(5000).default(100),
    bufferM: z.number().nonnegative().max(2000).default(50),
    polygon: z.array(z.object({ lat: z.number(), long: z.number() })).min(3).optional(),
  }).parse(req.body)
  const cid = req.ctx!.companyId!
  const bid = id('br')
  const gid = id('gf')
  db.prepare(`INSERT INTO branch (id, company_id, name, address, lat, long, status, created_at) VALUES (?,?,?,?,?,?, 'active', ?)`).run(
    bid, cid, body.name, body.address ?? null, body.lat, body.long, now(),
  )
  const gtype = body.polygon ? 'polygon' : 'circle'
  db.prepare(`INSERT INTO geofence (id, company_id, branch_id, type, center_lat, center_long, radius_m, buffer_m, polygon) VALUES (?,?,?,?,?,?,?,?,?)`).run(
    gid, cid, bid, gtype, body.lat, body.long, body.radiusM, body.bufferM, body.polygon ? JSON.stringify(body.polygon) : null,
  )
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: 'branch.create', target: bid, metadata: { name: body.name } })
  const b = db.prepare('SELECT * FROM branch WHERE id = ?').get(bid) as any
  const g = db.prepare('SELECT * FROM geofence WHERE branch_id = ?').get(bid) as any
  res.json({ ...mapBranch(b), geofence: mapGeofence(g) })
})

orgRouter.patch('/branches/:id', requireCompany, requireCap('branch.manage'), (req, res) => {
  const body = z.object({
    name: z.string().min(1).optional(), address: z.string().optional(),
    lat: z.number().optional(), long: z.number().optional(),
    radiusM: z.number().positive().max(5000).optional(), bufferM: z.number().nonnegative().max(2000).optional(),
  }).parse(req.body)
  const cid = req.ctx!.companyId!
  const cur = db.prepare('SELECT * FROM branch WHERE id = ? AND company_id = ?').get(req.params.id, cid) as any
  if (!cur) return res.status(404).json({ error: 'not_found' })
  db.prepare('UPDATE branch SET name=?, address=?, lat=?, long=? WHERE id=?').run(
    body.name ?? cur.name, body.address ?? cur.address, body.lat ?? cur.lat, body.long ?? cur.long, cur.id,
  )
  const g = db.prepare('SELECT * FROM geofence WHERE branch_id = ?').get(cur.id) as any
  if (g) {
    db.prepare('UPDATE geofence SET center_lat=?, center_long=?, radius_m=?, buffer_m=? WHERE id=?').run(
      body.lat ?? g.center_lat, body.long ?? g.center_long, body.radiusM ?? g.radius_m, body.bufferM ?? g.buffer_m, g.id,
    )
  }
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: 'branch.update', target: cur.id })
  const b = db.prepare('SELECT * FROM branch WHERE id = ?').get(cur.id) as any
  const g2 = db.prepare('SELECT * FROM geofence WHERE branch_id = ?').get(cur.id) as any
  res.json({ ...mapBranch(b), geofence: g2 ? mapGeofence(g2) : null })
})

orgRouter.post('/branches/:id/archive', requireCompany, requireCap('branch.manage'), (req, res) => {
  const cid = req.ctx!.companyId!
  db.prepare(`UPDATE branch SET status='archived' WHERE id=? AND company_id=?`).run(req.params.id, cid)
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: 'branch.archive', target: req.params.id })
  res.json({ ok: true })
})

// ---- Divisions ----
orgRouter.get('/divisions', requireCompany, (req, res) => {
  const rows = db.prepare('SELECT * FROM division WHERE company_id = ? ORDER BY name').all(req.ctx!.companyId) as any[]
  res.json(rows.map(mapDivision))
})

orgRouter.post('/divisions', requireCompany, requireCap('division.manage'), (req, res) => {
  const body = z.object({ name: z.string().min(1) }).parse(req.body)
  const cid = req.ctx!.companyId!
  const did = id('div')
  db.prepare('INSERT INTO division (id, company_id, name) VALUES (?,?,?)').run(did, cid, body.name)
  audit({ companyId: cid, actorType: 'user', actorId: req.ctx!.userId, action: 'division.create', target: did, metadata: { name: body.name } })
  res.json(mapDivision(db.prepare('SELECT * FROM division WHERE id = ?').get(did)))
})

orgRouter.patch('/divisions/:id', requireCompany, requireCap('division.manage'), (req, res) => {
  const body = z.object({ name: z.string().min(1) }).parse(req.body)
  const cid = req.ctx!.companyId!
  db.prepare('UPDATE division SET name=? WHERE id=? AND company_id=?').run(body.name, req.params.id, cid)
  res.json(mapDivision(db.prepare('SELECT * FROM division WHERE id = ?').get(req.params.id)))
})

orgRouter.delete('/divisions/:id', requireCompany, requireCap('division.manage'), (req, res) => {
  const cid = req.ctx!.companyId!
  const linked = db.prepare('SELECT COUNT(*) AS n FROM employee_profile WHERE company_id=? AND division_id=?').get(cid, req.params.id) as any
  if (linked.n > 0) return res.status(409).json({ error: 'division_has_employees', count: linked.n })
  db.prepare('DELETE FROM division WHERE id=? AND company_id=?').run(req.params.id, cid)
  res.json({ ok: true })
})
