import { config } from './lib/config.js' // loads .env (Google OAuth creds)
import { createApp } from './app.js'

const PORT = Number(process.env.PORT ?? 8787)
createApp().listen(PORT, () => console.log(`Absentra API on http://localhost:${PORT} · Google OAuth: ${config.googleEnabled ? 'ON' : 'OFF (dev sign-in)'}`))
