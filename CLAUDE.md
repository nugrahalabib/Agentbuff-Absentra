# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Absentra** — project memory, loaded every session. Facts + non-negotiable rules + an architecture map distilled from the PRD. The full spec is `docs/PRD-Absentra.md` and is the **single source of truth** — do **not** import it here; read the cited §-sections on demand (its headings are §-numbered, so `grep '^#' docs/PRD-Absentra.md` then Read the range). Config files are written in **English** by convention; product/UI copy is **Bahasa Indonesia**.

## What this project is

Absentra is a **B2B, multi-tenant, web-only, free** attendance SaaS for Indonesian UMKM (SMEs). It replaces manual attendance books, hand-kept spreadsheets, and expensive fingerprint hardware with one browser-based system: zero-hardware clock-in (HTML5 Geolocation + webcam), anti-fraud trust scoring, and a payroll-recap engine that encodes Indonesian overtime law. It is **agentic-native**: every capability is exposed both through a responsive web UI and through a **Model Context Protocol (MCP)** server so external AI agents can drive it headless. **North Star:** valid attendance records per week across all tenants (PRD §1.5).

**Current status:** a **runnable full-stack app** — `web/` (React PWA) + `server/` (Express + SQLite REST API with real cookie sessions). Owners self-register, run an **onboarding wizard**, and manage company/branches+geofence/divisions/shift templates+scheduling/employees+wages/roles/policy; employees join via **invite link/QR + consent** and clock in. Auth is a functional Google-style sign-in (real accounts/sessions; seam for real OIDC). Still simulated vs the PRD's eventual infra: Postgres+RLS (SQLite stands in), real Google OAuth, the MCP server endpoint, and encrypted photo object storage. Also present: PRD (`docs/PRD-Absentra.md`), `docs/design-system.md`, UI/UX skills under `.claude/skills/`. The top-level `README.md`'s fuller `.claude/` scaffold (rules/agents/commands/`.mcp.json`/`settings.json`) does **not** all exist — create when needed.

## Non-negotiable constraints

Hard requirements. Never violate them, even "just for now". If a request conflicts, stop and flag it.

1. **Tenant isolation is sacred.** Every tenant-owned row carries `company_id`. Every query is scoped to the current tenant. Postgres **RLS** with `FORCE ROW LEVEL SECURITY` is the last line of defense; the app layer must *also* filter explicitly. No code path reads/writes across tenants without a validated tenant context. See PRD §4.3 (defense-in-depth) and §4.4 (indexing). This is enforced in **four layers** — see "Tenant isolation" below.
2. **Web-only PWA.** No native mobile app (NG1). A responsive **PWA** that must work on a low-end employee phone with a poor connection. Mobile-web is the *primary* surface; design from the employee phone up (PRD §2.5, §8).
3. **Free product.** No paywalls or per-seat billing logic. Infra cost-conscious → shared-schema pool model. "Free" is a market-entry requirement, not a growth tactic (PRD §2.1).
4. **Agentic parity, one authorization path.** The MCP server is a *thin adapter* over the same Core API, so RBAC, RLS, audit, and rate-limits apply identically to UI and agents. Never build a parallel access path that bypasses these checks (PRD §4.9, §7.5.3, §5.3).
5. **Regulatory correctness.** Overtime/payroll math must follow **PP 35/2021**. Do not hand-roll the formula; use the canonical engine. See PRD §2.4.1 (law) and §7.4.1 (engine + verified example). "Payroll recap engine PP 35/2021" below has the formulas.
6. **Privacy (UU PDP).** Attendance collects location + facial photos (sensitive data). Require explicit consent at employee onboarding, minimize data, encrypt at rest/in transit, support configurable retention + deletion, and audit every access to sensitive data (including by agents). Biometric face-match is **opt-in only**. See PRD §2.4.2, §9.5.
7. **Auth is frictionless.** Google Login (OIDC, Auth Code + PKCE) is the only end-user method — **no OTP** via SMS/phone/email (NG3). A Custom SSO/Webhook Gateway federates sessions from partner apps. See PRD §7.1.
8. **Trust, don't block.** Anti-fraud raises the cost of cheating and *flags anomalies for human review* rather than hard-blocking honest workers. Default for out-of-geofence = allow + flag; strict (reject) is opt-in per branch/shift (PRD §2.5, §6.4, §7.3.4).

## Tech stack

Postgres, Redis, object storage, and the PWA shape are settled by the PRD's architecture (§4, §9). **Frontend is ratified** (built in `web/`): React 18 + TypeScript + Vite + Tailwind (tokens from `docs/design-system.md`), TanStack Query (server cache), Zustand (UI/session), Zod available for shared validation, `vite-plugin-pwa`, Vitest. Backend language/framework is **still undecided — ratify and record it here before building it.**

- **Database:** PostgreSQL — shared DB + shared schema, `company_id` discriminator on every tenant table, **RLS** (`FORCE`). `attendance_record` is **range-partitioned by `work_date`**; sub-partition/hash on `company_id` at extreme scale; BRIN on time columns for append-heavy tables (audit/event). See §4.1, §4.4.
- **Backend:** built as **Node + Express + better-sqlite3** (`server/`) with real httpOnly cookie sessions; tenant scoping + `can()` enforced in every route. This is the working stand-in for the PRD target: stateless API tier + thin **MCP server** (Streamable HTTP, OAuth 2.1) on **Postgres + RLS** with PgBouncer transaction pooling (`SET LOCAL app.current_company_id` inside the txn, §4.6) and an async job queue. When migrating SQLite→Postgres, preserve the `company_id`-on-every-table + per-query scoping already in `server/src/routes/`.
- **Frontend:** TypeScript **PWA**. Server-state cache with stale-while-revalidate + optimistic updates (PRD e.g.: TanStack Query); light UI store (e.g. Zustand); shared validation schema with backend (e.g. Zod). Offline queue via **IndexedDB + Service Worker Background Sync**. Clock-in is an explicit finite state machine. See §8.6.
- **Cache/queue:** Redis — cache keys and rate-limit keys are **always tenant-namespaced** (`t:{company_id}:...`, `rl:{company_id}:{surface}`) to prevent cross-tenant leakage (§4.6, §4.8).
- **Object storage:** encrypted store for attendance photos; metadata (time/geo/device/trust) stored separately and linked. Configurable photo retention (§7.3.2, §9.5).
- **Observability:** structured logs with `company_id`+`request_id` (no PII), per-tenant metrics, OpenTelemetry tracing end-to-end *including MCP tool-calls* (§4.8, §9.6).

## Domain model & invariants

Core tables (full appendix: PRD §10). **Every tenant table has `company_id UUID NOT NULL` as the leftmost index column and an RLS policy.**

- **`user`** is **global** (key = Google `sub`); one identity can belong to many companies. All tenant-scoped data hangs off **`membership`** (`company_id`+`user_id`, unique; carries `role`, `scope_branch_ids[]`, `scope_division_ids[]`, status). So one person can be Owner of one UMKM and Employee of another with zero leakage (§4.2).
- **`company`** → `branch` (has `geofence`: circle or polygon) → `division`; `employee_profile` (wage components, consent timestamps) links to a membership. `company.workweek_type` (`five_day`/`six_day`) **selects the overtime multiplier tier** (§7.2.1).
- **`shift_template`** (supports `crosses_midnight`, `break_minutes`, `late_tolerance_minutes`, geofence) → `shift_assignment` (per employee/date, rotation patterns, bulk-apply).
- **`attendance_record`** (partitioned by `work_date`; status `on_time`/`late`/`absent`, `late_minutes`, `trust_score`) → **`attendance_event`** (`clock_in`/`clock_out`; client+server timestamps, lat/long, gps_accuracy, ip, device_fingerprint, photo_object_key, liveness_passed, geofence_result, `submitted_offline`, **`idempotency_key` unique**).
- **`leave_request`**, **`overtime_request`** (`day_type` ∈ workday/weekly_rest/public_holiday/shortest_day → drives multiplier), **`policy`** (late-deduction mode+config, meal config, `strict_geofence`, `trust_thresholds`, `photo_retention_days`), **`invite`** (`token_jti` unique, `max_uses`, expiry), **`mcp_connection`** (scopes[], scope_branch_ids[]), **`external_identity`** (SSO bridge), **`audit_log`** (**append-only**; `actor_type` user/agent/operator, `source` ui/mcp/sso, PII redacted in metadata).

**Invariants:** add a new tenant table → `company_id NOT NULL` + RLS policy (`USING` + `WITH CHECK`) + composite index led by `company_id`. Unique guard `(company_id, employee_id, work_date, shift_assignment_id)` = one record per employee/day/shift. All mutations idempotent (idempotency key). Archived branches and offboarded employees keep historical records immutable (§6.9).

## RBAC

Five roles (PRD §5.1): **Platform Operator** (internal, audited), **Company Owner/Super Admin** (full tenant), **Branch Admin** (assigned branches only), **HR/Approver** (configurable scope), **Employee** (self only). Roles are **scoped** — a Branch Admin of Branch A cannot see Branch B; scope = `company_id` (RLS) **plus** `branch_id`/`division_id` filters from the membership's scope assignment.

Authorization is a single function `can(actor, capability, resource) → bool` over effective role, scope, resource ownership (`company_id` match), and membership status. **Every REST endpoint and every MCP tool calls the same check — no privileged path for agents** (§5.3). Atomic capability matrix: PRD §5.2 (e.g. `attendance.clock`, `leave.approve`, `wage.set`, `mcp.connection.manage`, `audit.view`).

## Critical domain logic

### Clock-in/out (the most-used path) — PRD §6.4, §7.3
Implement as an explicit **finite state machine**: `Idle → CheckingContext → ReadyIn/ReadyOut/NoShift → Locating → Capturing → Reviewing → Submitting → Success | Queued(offline) | Error`. Steps: resolve today's shift + geofence → acquire geolocation (`enableHighAccuracy`, reject/flag if `accuracy` over threshold ~100 m = likely IP-based) → geofence eval (**Haversine** for circle, **ray-casting** point-in-polygon) → capture front-camera still to `<canvas>` with optional random **liveness prompt** → server-trusted timestamp + geo watermark (also stored as separate metadata) → trust score → submit. **Offline:** queue in IndexedDB with the *real* event time, Background-Sync on reconnect (server marks `late-submitted`); **idempotency key** prevents retry duplicates. Out-of-geofence default = **allow + flag** (strict reject is opt-in).

### Trust scoring (honest anti-fraud) — PRD §7.3.4
Browser attendance **cannot** match dedicated hardware (no mock-location flag access; web photo-of-photo detection is unreliable). Strategy: aggregate weighted signals → score 0–100, then flag for human review. Signals: geofence result + GPS accuracy, IP-geo cross-check, **impossible travel**, device-fingerprint consistency, liveness response, time-of-event sanity, optional opt-in face-match. Thresholds (tenant-configurable): `≥80` silent accept · `60–79` accept + optional review · `<60` accept with mandatory-review flag (default) or reject (strict). Decisions are **transparent** to employee and admin; avoiding false-positives on honest workers is a priority.

### Payroll recap engine (PP 35/2021) — PRD §2.4.1, §7.4.1
Deterministic. **`hourlyWage = monthlyWageBase / 173`** where `monthlyWageBase = basic wage + fixed allowance` (100% basis; if variable allowances are included, basis = 75% per regulation). Overtime multipliers by **day type × workweek type**:
- **Workday:** hour 1 = **1.5×**; hour 2+ = **2×**. → `OT = 1.5·hw·min(h,1) + 2·hw·max(h−1,0)`.
- **Weekly rest / public holiday, 6-day week:** hrs 1–7 = 2×, hr 8 = 3×, hrs 9–11 = 4×.
- **Weekly rest / public holiday, 5-day week:** hrs 1–8 = 2×, hr 9 = 3×, hrs 10–11 = 4×.
- **Holiday on shortest workday:** hrs 1–5 = 2×, hr 6 = 3×, hrs 7–9 = 4×.

**Verified example (workday):** monthly Rp4,000,000 → `hw ≈ Rp23,121`; 2h OT = `3.5 × 23,121 ≈ Rp80,924`. Also: late-deduction policy (grace+flat / per-minute / tiered), meal allowance (per-day and/or mandatory when OT ≥ 4h), only **approved** leave/overtime counts. If a tenant policy is more generous than the legal minimum, take the value **better for the employee**. The engine produces a **payroll-ready recap only — it never disburses pay** (NG2).

### Auth & SSO — PRD §7.1
Google OIDC (Auth Code + PKCE): full ID-token verification (`iss`/`aud`/`exp`/signature via cached JWKS), identity key = Google `sub` (email is mutable). Tokens: short-lived **access JWT in-memory** (carries `user_id`, active `company_id`, role, scope); long-lived **refresh token in httpOnly+Secure cookie, rotating with reuse-detection** (reuse → revoke token family). Tenant switching = `POST /session/switch-tenant` re-issues an access token with the new `company_id`. **Custom SSO Gateway** = trusted Identity Bridge via short-lived (`exp ≤ 60s`) signed assertion (RS256/ES256), issuer allowlist, `aud="absentra"`, `jti` anti-replay, optional nonce; three modes (redirect assertion / RFC 8693 token-exchange / OIDC RP). Per-bridge **kill-switch**.

## MCP / agentic ecosystem — PRD §7.5, §11

The MCP server is a **thin adapter over Core API** (parity, no parallel path). JSON-RPC 2.0; protocol baseline **`2025-11-25`**, designed toward stateless RC **`2026-07-28`** (abstract the transport layer). Transport: **Streamable HTTP** (stdio for local). **AuthN: OAuth 2.1** (server = Resource Server; agent = client, Auth Code + PKCE); access tokens are **bound to a specific `company_id` and a scope subset** (e.g. `attendance:read`, `shift:write`). Conventions when adding a tool:
- Reuse Core API + the shared `can()` check; bind to the token's `company_id`; least-privilege scope.
- **Destructive/sensitive actions** (delete, change wage, bulk approve) require **human-in-the-loop confirmation via elicitation** — never silent.
- Ambiguous refs (e.g. two "Budi") → ask via **elicitation**.
- **Audit every tool-call** (connection, scope, redacted params, result, time); per-tenant + per-connection rate-limit; Owner **kill-switch** revokes instantly.
- Primitives: **Tools** (`domain.action`, e.g. `attendance.recap`, `shift.assign`), **Resources** (`absentra://company/{id}/policy`, …, read-only, RLS+scope), **Prompts** (parameterized templates). REST↔MCP mapping table: PRD §11.

## UI/UX — PRD §8 + installed skill

**For any UI/UX work** (new pages/components, color/type/spacing systems, responsive/PWA behavior, design review), use the installed **UI/UX Pro Max** skill — a searchable design-intelligence engine, not just docs. Read `.claude/skills/ui-ux-pro-max/SKILL.md`; run from repo root (needs `python3`):

```bash
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<product type> <keywords>" --design-system -p "Absentra"
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<keyword>" --domain <style|color|typography|ux|chart|product|web|react|shadcn> -n 5
```

**Authority order on conflict: PRD §8 → `docs/design-system.md` → skill output.** The reconciled, concrete token set (colors, typography, spacing, components, screen specs) lives in **`docs/design-system.md`** — read it before building UI; regenerate via the skill, never overwrite PRD decisions. Hard rules carried from PRD §8 (these *override* generic skill suggestions):
- **Mobile-first, performance-first** for low-end phones on poor networks: prefer Flat / Data-Dense styles; **reject motion-heavy/parallax** suggestions. Honor `prefers-reduced-motion`; transitions ~150–200 ms.
- **System font stack** (not downloaded web fonts — data cost); base size **16 px** (prevents iOS input zoom); modular scale 12/14/16/20/24/32.
- **Touch targets ≥ 44×44 px**, ≥ 8 px gaps; primary action in the **thumb zone**; bottom sheets over small modals; sticky primary CTA (the Absen button); avoid hover-dependent UI.
- Light mode is the default surface; provide dark mode. **Status is never color-only** — always pair with icon/text (color-blind a11y). **WCAG 2.2 AA** baseline (text contrast ≥ 4.5:1, visible focus, focus trap in sheets/modals, `aria-live` for status changes).
- Every screen designs explicit **idle / loading / success / error / empty / offline** states. Microcopy is warm, solution-focused **Bahasa Indonesia**; dates/numbers in Indonesian locale + the **tenant's timezone**.
- Frontend state = three categories (PRD §8.6): server cache (namespaced by `company_id` to prevent client-side cross-tenant leak on tenant switch), ephemeral UI store, form+shared-validation. Clock-in = explicit FSM. Companion skills: `design-system` (tokens/components), `ui-styling` (shadcn/ui + Tailwind).

## How to work in this repo

- **Read the matching PRD §section before implementing a feature, and state which section you are following.** Use the map below.
- **Prefer asking over inventing.** If a field, policy default, or stack decision is undefined (or listed in §14 Open Questions), ask — don't guess.
- New tenant table → `company_id NOT NULL` + RLS (`USING`+`WITH CHECK`, `FORCE`) + composite index led by `company_id` + a cross-tenant isolation test that *must fail* to read another tenant (§4.3 layer 4).
- New MCP tool → reuse Core API + `can()`, bind to token `company_id`, least-privilege scope, gate destructive actions behind elicitation/confirmation, write an audit-log entry (§7.5.3).
- UI work → follow `docs/design-system.md` + the skill; PRD §8 wins on conflict.
- Write tests for new logic, prioritizing **cross-tenant isolation** and **PP 35/2021 payroll correctness** (use the verified example as a fixture).
- Respect the **phasing** (build order matters — agentic/SSO layers sit on a stable core).

## Build order (PRD §12)

**0** Foundation: multi-tenant skeleton (RLS, tenant context), Google Login, company/branch/division, membership+RBAC, audit log → **1** Core Attendance MVP: invite link+QR, basic shift engine, clock-in/out (geofence+photo+trust), offline queue, slim dashboard → **2** Workforce Ops: leave & overtime request/approval, policy engine, anomaly inbox, attendance recap → **3** Payroll & Analytics: PP 35/2021 recap engine, CSV/XLSX/PDF export, full dashboard → **4** Agentic (MCP): server, tools/resources/prompts, agent consent, agentic audit+rate-limit, human-in-the-loop → **5** SSO Gateway: Identity Bridge, token exchange, OIDC RP, key rotation, kill-switch → **6** Hardening & Scale: partitioning, read replicas, per-tenant quota, DR drills, a11y/i18n audit, security review.

## PRD section map (read on demand)

| Topic | § |
|---|---|
| Vision, problem, North Star | §1 |
| Market research, regulation (PP 35/2021, UU PDP), 10 design principles | §2 |
| Goals/Non-Goals, personas, KPIs | §3 |
| **Multi-tenancy: model, isolation layers, indexing, scaling, DR** | §4 |
| **RBAC: roles, capability matrix, enforcement** | §5 |
| **End-to-end flows** (onboarding, clock-in FSM, leave, overtime, shift, payroll, edge cases) | §6 |
| **Feature modules**: Auth/SSO §7.1 · Company/Employee §7.2 · Core Attendance §7.3 · Reporting/Payroll §7.4 · **MCP** §7.5 | §7 |
| **UI/UX**: principles, tokens, breakpoints, components, screen specs, state mgmt, touch, a11y, i18n | §8 |
| NFRs: performance, reliability, scalability, security, privacy, observability | §9 |
| **Data model appendix** (all core tables) | §10 |
| REST ↔ MCP mapping | §11 |
| Roadmap/phasing · Risks · Open Questions | §12–§14 |

**Key NFR targets (§9):** p75 clock-in submit < 2.5 s; p95 attendance-shell load < 1.5 s; dashboard p95 < 1.5 s; attendance API uptime ≥ 99.9%; RPO ≤ 5 min, RTO ≤ 60 min.

## Repository map (what exists today)

- `docs/PRD-Absentra.md` — full product spec. **Source of truth.**
- `docs/design-system.md` — concrete Absentra design tokens/components, derived from PRD §8 + the UI/UX skill (read before UI work).
- `web/` — **React PWA frontend** (see `web/README.md`). `web/src/lib/domain/` = correctness engines + tests; `web/src/lib/api/client.ts` = typed fetch client to the backend; `web/src/features/` = the PRD screens (incl. onboarding + org management); `web/src/components/` = UI primitives + app shell.
- `server/` — **Express + SQLite REST API**. `server/src/lib/` (db schema, session/context, audit, mappers), `server/src/routes/` (auth, company, org, shifts, employees, attendance, requests, payroll, mcp), `server/src/domain/` (engines, mirrors web). Every route scopes by `company_id` from the session (tenant isolation) and gates with `can(actor, capability)`.
- `README.md` — scaffold overview (Bahasa Indonesia); documents a planned `.claude/` layout not all present yet.
- `.claude/skills/` — installed **UI/UX Pro Max** skills: `ui-ux-pro-max` (core engine), `design-system`, `ui-styling`. (Marketing skills `design`/`brand`/`banner-design`/`slides` were pruned as out of scope.)
- *Not yet created* (planned per README): `.claude/rules/`, `.claude/agents/`, `.claude/commands/`, `.claude/settings.json`, `.mcp.json`. Not a git repo yet.

## Commands

Two processes. If the global npm cache is read-only, append `--cache "$PWD/.npm-cache"` to install. **Run both** (the web dev server proxies `/api` → `:8787`):

- Backend: `cd server && npm install && npm run dev` → API on http://localhost:8787 (SQLite file `server/absentra.db`; delete it to reset all data). `npm run typecheck` to check types.
- Frontend: `cd web && npm install && npm run dev` → http://localhost:5173.
- Frontend build/test: `npm run build` (typecheck+PWA) · `npm run typecheck` · `npm run test` (Vitest) · single: `npm run test -- src/lib/domain/payroll.test.ts`.
- Domain engines (payroll/geofence/trust/FSM/RBAC) exist in BOTH `web/src/lib/domain/` and `server/src/domain/` (duplicated, pure). Keep them in sync; the web copy has the tests — keep them green.
- First use: open the web app → "Lanjut dengan Google" (name+email creates a real account) → onboarding wizard builds the company.

## Conventions

- Keep secrets out of code and logs. Never read `.env` or files under `secrets/` (enforce this in `.claude/settings.json` once created).
- Indonesian-facing UI copy in clear, warm Bahasa Indonesia; keep common IT terms in English. Externalize strings (i18n-ready). Format dates/numbers per Indonesian locale and the tenant's timezone.
- Config files (this file, future rules/skills/agents) are English by convention; product/UI text is Indonesian.
- Audit-sensitive actions always (login, tenant switch, SSO federation, attendance correction, wage change, approvals, every MCP tool-call) — `audit_log` is append-only.
