# Absentra Web (frontend)

React + TypeScript + Vite PWA for Absentra. Talks to the backend in `../server`
over HTTP (`/api`, cookie session). Tenant scoping, RBAC, and the domain engines
run server-side; this is a typed client + the PRD screens.

## Run (needs the backend too)

```bash
# 1) backend
cd ../server && npm install && npm run dev      # API on :8787  (cache read-only? add --cache "$PWD/.npm-cache")

# 2) frontend (this folder)
npm install && npm run dev                       # http://localhost:5173  (proxies /api → :8787)
```

Other scripts: `npm run typecheck` · `npm run build` (typecheck + PWA build) · `npm run test` (Vitest domain engines) · `npm run preview`.

## First use (real accounts — no seed data)

1. Open http://localhost:5173 → **"Lanjut dengan Google"** (enter a name + email; a real account + session is created — the dev stand-in for Google OIDC).
2. New account with no company → **onboarding wizard**: company (name, business type, timezone, **5/6-day workweek**, address) → first branch + **geofence radius** → divisions → default shift.
3. As Owner you then manage **Cabang, Divisi, Shift (+ susun jadwal), Karyawan (peran & upah), Pengaturan (kebijakan), Koneksi Agen**, and review **Dashboard / Persetujuan / Rekap Payroll**.
4. **Invite employees**: Karyawan → Undang → share the link/QR. Opening `/invite/:token` → sign in → **consent (UU PDP)** → joins the company → can clock in.
5. Toggle the header **ONLINE/offline** to exercise the offline queue → sync; the moon/sun toggles theme.

To reset everything: stop the server and delete `../server/absentra.db`.

## Layout

- `src/lib/domain/` — correctness engines + Vitest tests (payroll PP 35/2021, geofence, trust, clock-in FSM, RBAC).
- `src/lib/api/client.ts` — typed fetch client (the only thing that knows about HTTP).
- `src/features/` — screens: login, onboarding, attendance (Absen FSM), dashboard, schedule, requests, approvals, employees, org (branches/divisions/shifts/settings), payroll, mcp, profile, invite-accept.
- `src/components/` — UI primitives + app shell (bottom-nav mobile / sidebar desktop). Tokens from `../docs/design-system.md`.
