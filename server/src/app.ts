import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { join } from 'node:path'
import './lib/db.js' // initialise schema (reads ABSENTRA_DB)
import { loadContext } from './lib/context.js'
import { authRouter } from './routes/auth.js'
import { companyRouter } from './routes/company.js'
import { orgRouter } from './routes/org.js'
import { shiftsRouter } from './routes/shifts.js'
import { employeesRouter } from './routes/employees.js'
import { attendanceRouter } from './routes/attendance.js'
import { requestsRouter } from './routes/requests.js'
import { payrollRouter } from './routes/payroll.js'
import { mcpRouter } from './routes/mcp.js'
import { mcpServerRouter } from './routes/mcpServer.js'
import { ssoRouter } from './routes/sso.js'
import { auditRouter } from './routes/audit.js'

export function createApp() {
  const app = express()
  app.use(cors({ origin: true, credentials: true }))
  app.use(express.json({ limit: '6mb' }))
  app.use(cookieParser())
  app.use(loadContext)

  app.get('/api/health', (_req, res) => res.json({ ok: true }))
  app.use('/api/auth', authRouter)
  app.use('/api', companyRouter)
  app.use('/api', orgRouter)
  app.use('/api', shiftsRouter)
  app.use('/api', employeesRouter)
  app.use('/api', attendanceRouter)
  app.use('/api', requestsRouter)
  app.use('/api', payrollRouter)
  app.use('/api', mcpRouter)
  app.use('/api', ssoRouter)
  app.use('/api', auditRouter)
  app.use('/mcp', mcpServerRouter) // MCP JSON-RPC single endpoint (PRD §7.5.2)

  // Single-origin deploy: when WEB_DIST is set (production container), the same
  // Node process serves the built web SPA so the browser's `/api` + `/mcp` calls
  // are same-origin. Non-API/MCP paths fall back to index.html (client-side
  // routing). No effect in dev (WEB_DIST unset → Vite serves the web separately).
  const WEB_DIST = process.env.WEB_DIST
  if (WEB_DIST) {
    app.use(express.static(WEB_DIST))
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/mcp')) return next()
      res.sendFile(join(WEB_DIST, 'index.html'))
    })
  }

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'validation', detail: err.errors })
    console.error(err)
    res.status(500).json({ error: 'server_error', message: String(err?.message ?? err) })
  })
  return app
}
