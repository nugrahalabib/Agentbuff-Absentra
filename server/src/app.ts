import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { join } from 'node:path'
import './lib/db.js' // initialise schema (reads ABSENTRA_DB)
import { config } from './lib/config.js'
import { loadContext } from './lib/context.js'
import { requestContext } from './lib/audit.js'
import { originGuard } from './lib/httpSecurity.js'
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
import { agentbuffMcpRouter } from './routes/agentbuffMcp.js'

/**
 * Final error handler. Validation errors are explained; anything else is logged
 * server-side and answered with a generic `internal` (never the raw message,
 * which can leak SQL/paths/stack details).
 */
export function errorHandler(err: any, req: express.Request, res: express.Response, _next: express.NextFunction) {
  if (res.headersSent) return
  if (err?.name === 'ZodError') return res.status(400).json({ error: 'validation', detail: err.errors })
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large', message: 'Data yang dikirim terlalu besar.' })
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' })
  console.error(`[absentra] ${req.method} ${req.path} failed:`, err)
  res.status(500).json({ error: 'internal', message: 'Terjadi kesalahan pada server. Silakan coba lagi.' })
}

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  // One reverse proxy (Coolify/Traefik) sits in front: honour its X-Forwarded-*
  // so req.ip / req.secure are the real client values (rate limits, Secure cookies).
  app.set('trust proxy', 1)

  // Production is single-origin (the SPA is served below), so cross-origin
  // access is only ever needed by the Vite dev server.
  if (process.env.NODE_ENV !== 'production') {
    const devOrigins = [...new Set([config.appOrigin, 'http://localhost:7707', 'http://localhost:5173'])]
    app.use(cors({ origin: devOrigins, credentials: true }))
  }
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'same-origin')
    next()
  })
  app.use(originGuard) // CSRF: reject cross-site state-changing /api calls (production)
  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())
  // After the body parser: everything below runs synchronously inside this
  // context, so audit() can record the caller's IP.
  app.use((req, _res, next) => requestContext.run({ ip: req.ip }, next))
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
  app.use('/api', agentbuffMcpRouter) // server-to-server dari AgentBuff (Bearer assertion, tanpa sesi)
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

  app.use(errorHandler)
  return app
}
