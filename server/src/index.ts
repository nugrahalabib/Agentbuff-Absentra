import { config } from './lib/config.js' // loads .env (Google OAuth creds)
import { createApp } from './app.js'
import { logGateStartup } from './lib/agentbuffGate.js'
import { startMaintenance } from './lib/maintenance.js'

// An async handler that slips an error past its own try/catch must be logged,
// not crash the whole API (Node's default for unhandled rejections is to exit).
process.on('unhandledRejection', (reason) => {
  console.error('[absentra] unhandled rejection:', reason instanceof Error ? reason.message : reason)
})

if (process.env.NODE_ENV === 'production') {
  if (config.passwordAuthAllowlist.includes('*')) {
    console.error('[absentra] PASSWORD_AUTH_ALLOWLIST contains "*" — refused in production; only explicitly listed emails may use passwords.')
  }
  if (!process.env.APP_ORIGIN) console.warn('[absentra] APP_ORIGIN is not set — CSRF origin checks fall back to the request Host header.')
  if (process.env.SSO_BRIDGE_OPERATOR_SECRET) console.warn('[absentra] SSO Identity Bridge routes are ENABLED (SSO_BRIDGE_OPERATOR_SECRET set).')
}
logGateStartup()
startMaintenance() // photo retention purge + expired session cleanup, now and every 6 h

const PORT = Number(process.env.PORT ?? 8787)
createApp().listen(PORT, () => console.log(`Absentra API on http://localhost:${PORT} · Google OAuth: ${config.googleEnabled ? 'ON' : 'OFF (dev sign-in)'}`))
