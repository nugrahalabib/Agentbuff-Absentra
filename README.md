<a href="https://absentra.agentbuff.id"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/banner-dark.svg"><img src="docs/readme/banner-light.svg" width="100%" alt="Absentra. Phone attendance for Indonesian small businesses, with geofence, selfie, shifts and a payroll recap."></picture></a>

<p align="center"><a href="https://absentra.agentbuff.id"><b>Open absentra.agentbuff.id</b></a> · <a href="#getting-started">Getting started</a> · <a href="https://github.com/nugrahalabib">More of my work</a> · <a href="https://nugrahalabib.com">nugrahalabib.com</a></p>

## Overview

Absentra is a web attendance app for Indonesian small businesses (UMKM) such as cafes, shops, clinics and workshops. Employees clock in and out from their own phone with their location and a selfie. The owner sees who came, who was late and how much overtime was worked, across several branches.

It replaces paper attendance books, hand-kept spreadsheets and fingerprint machines. The payroll recap applies the Indonesian overtime regulation PP 35/2021, so the owner no longer counts overtime pay, late deductions and meal allowance by hand.

Every company is a separate tenant, and the same data is open to AI agents through an MCP server with 30 tools. An agent can answer "who has not clocked in today" or prepare the monthly recap, and any change it makes must be confirmed first.

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/features-dark.svg"><img src="docs/readme/features-light.svg" width="100%" alt="What Absentra does: Clock in from the phone, Flag, do not block, Shifts and schedules, Leave and overtime approvals, Payroll recap per PP 35/2021, Branches, teams and roles, MCP server for AI agents, Reports and exports."></picture>

## Why it exists

Absentra is a web attendance app for Indonesian small businesses (UMKM). Employees clock in and out from their own phone with their location and a selfie, and the owner sees attendance, lateness and overtime for every branch on one screen. The payroll recap applies the overtime rules of PP 35/2021, and an MCP server lets the owner's AI agent read and act on the same data with a confirmation step. Nugraha Labib Mujaddid designed and built it as a business app on the AgentBuff marketplace.

Many small businesses still track attendance in a paper book, a shared spreadsheet or a fingerprint machine at the door. The book and the spreadsheet are easy to fill in for a friend, and a fingerprint machine costs money, sits in one place and does not help a business with several outlets.

At the end of the month someone has to turn those records into pay. Indonesian overtime is not a flat rate: PP 35/2021 sets the hourly wage at the monthly wage divided by 173, with different multipliers for the first hour, later hours, rest days and public holidays, and different tiers for 5 and 6 day weeks. Done by hand, this is slow and easy to get wrong.

Phone attendance has its own trap. Browser GPS can be weak indoors, and a strict app that refuses every doubtful clock-in punishes honest workers. The owner needs to see doubtful cases and decide, not have the app decide for them.

| Who | What they do with it |
| --- | --- |
| **Owner** | Sets up the company, branches with their fence, divisions, shifts and wages, approves requests, reads the dashboard and runs the payroll recap. |
| **HR or branch admin** | Manages employees and schedules and decides leave and overtime, limited to the branches in their scope. |
| **Employee** | Clocks in and out from a phone, sees the next two weeks of shifts and their own history, and requests leave or overtime. |
| **The owner's AI agent** | Connects over MCP to answer questions such as who has not clocked in, prepares recaps, and decides requests only after the owner confirms. |

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/before-after-dark.svg"><img src="docs/readme/before-after-light.svg" width="100%" alt="Before and after"></picture>

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/journey-dark.svg"><img src="docs/readme/journey-light.svg" width="100%" alt="How it works, step by step"></picture>

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/value-dark.svg"><img src="docs/readme/value-light.svg" width="100%" alt="What it changes"></picture>

## Tour

### 1. Landing and setup

The app serves its own landing page that explains the product in plain Indonesian. A new owner goes through a four-step wizard: the business and its work week, the first work location with its radius, the working hours, and a ready screen that leads to inviting staff.

- Business type, 5 or 6 day week (it selects the overtime tier) and time zone WIB, WITA or WIT
- Work location from the phone's position or a pasted Google Maps link, with a radius slider
- A person who opens an invite link joins as staff instead of creating a company

<img src="docs/readme/screens/01-landing.jpg" width="100%" alt="The landing page served by the app.">

<sub>The landing page served by the app.</sub>

<p><img src="docs/readme/screens/02-landing-features.jpg" width="49%" alt="Feature section of the landing page."> <img src="docs/readme/screens/03-onboarding-company.jpg" width="49%" alt="Setup wizard, step 1: the business and its work week."></p>

<sub>Left: Feature section of the landing page. · Right: Setup wizard, step 1: the business and its work week.</sub>

<p><img src="docs/readme/screens/04-onboarding-location.jpg" width="100%" alt="Setup wizard, step 2: the work location and its radius."></p>

<sub>Setup wizard, step 2: the work location and its radius.</sub>

### 2. Clock in from the phone

The employee screen is built for a low-end phone. Clocking in is a state machine: check today's shift, get the location, take a selfie, review, send. The result says whether it was on time and if anything was flagged.

- Distance from the branch point and GPS accuracy shown before sending
- Selfie from the front camera, shrunk on the phone before upload
- Without signal the clock-in is kept on the phone with its real time and sent later
- Two-week schedule, personal history and leave or overtime requests on the same phone

<img src="docs/readme/screens/05-phone-clock-in.jpg" width="100%" alt="Clock-in on a phone: ready, selfie, review, recorded. The selfie is a placeholder from a fake camera.">

<sub>Clock-in on a phone: ready, selfie, review, recorded. The selfie is a placeholder from a fake camera.</sub>

<p><img src="docs/readme/screens/06-phone-employee.jpg" width="100%" alt="Employee screens: schedule, leave and overtime requests, attendance history."></p>

<sub>Employee screens: schedule, leave and overtime requests, attendance history.</sub>

### 3. Owner dashboard

The home screen answers the owner's first question of the day: who is in, who is late, who has not clocked in, who is on leave. Records with a low trust score are listed for review, and each one opens with its photo, position, accuracy and the reasons it was flagged.

- Counts for present, late, not yet in, on leave and overtime, filtered by branch
- A seven-day chart of presence and lateness
- Opening someone else's photo and location is written to the audit log
- Light and dark themes

<img src="docs/readme/screens/07-dashboard.jpg" width="100%" alt="Owner dashboard for a demo company.">

<sub>Owner dashboard for a demo company.</sub>

<p><img src="docs/readme/screens/08-attendance-detail.jpg" width="49%" alt="A flagged clock-in: outside the fence, weak GPS, score 35."> <img src="docs/readme/screens/19-dashboard-dark.jpg" width="49%" alt="The same dashboard in dark mode."></p>

<sub>Left: A flagged clock-in: outside the fence, weak GPS, score 35. · Right: The same dashboard in dark mode.</sub>

### 4. Approvals

Leave and overtime requests from employees, and overtime drafts created automatically when someone clocks out well after the shift end, wait in one list. A decision is one tap and is recorded with who made it.

- Leave types: annual, sick, permission and unpaid, with overlap checks
- Overtime day types: workday, weekly rest, public holiday, shortest workday
- A manual request replaces the automatic draft for the same date, so overtime is not paid twice

<img src="docs/readme/screens/09-approvals.jpg" width="100%" alt="Pending leave and overtime requests.">

<sub>Pending leave and overtime requests.</sub>

### 5. Team, branches and shifts

The owner manages employees with their branch, division, role and wage components, and invites new staff by link or QR. Each branch has its own fence. Shift templates hold start and end times, break and late tolerance, and are assigned in bulk over a date range.

- Roles: owner, HR, branch admin and employee, with branch scope
- CSV import and export of employee data
- A circle fence per branch set in the app (the API and engine also accept a polygon), with a buffer zone counted as near
- Overlap and minimum rest checks when assigning shifts, including shifts that cross midnight

<img src="docs/readme/screens/10-employees.jpg" width="100%" alt="Employee list with branch, division and basic wage.">

<sub>Employee list with branch, division and basic wage.</sub>

<p><img src="docs/readme/screens/11-invite-qr.jpg" width="49%" alt="Invite link and QR code for new staff."> <img src="docs/readme/screens/12-branches.jpg" width="49%" alt="Work locations with their radius."></p>

<sub>Left: Invite link and QR code for new staff. · Right: Work locations with their radius.</sub>

<p><img src="docs/readme/screens/13-shifts.jpg" width="100%" alt="Shift templates and the weekly team schedule."></p>

<sub>Shift templates and the weekly team schedule.</sub>

### 6. Payroll recap and reports

The recap turns a period of attendance into the numbers needed to pay wages: days present, late minutes and deductions, meal allowance, approved overtime hours and overtime pay under PP 35/2021. It only calculates and never pays out. The per-employee report is a printable record of one person's period.

- Hourly wage is basic wage plus fixed allowance divided by 173
- Only approved overtime and approved leave count
- CSV for Excel, and print or save as PDF from the browser
- Late deduction modes: tolerance then flat amount, per minute, or tiered

<img src="docs/readme/screens/14-payroll.jpg" width="100%" alt="Payroll recap for 1 to 26 November for the demo company.">

<sub>Payroll recap for 1 to 26 November for the demo company.</sub>

<p><img src="docs/readme/screens/15-report.jpg" width="49%" alt="Attendance report for one employee."> <img src="docs/readme/screens/16-settings.jpg" width="49%" alt="Attendance and pay rules: late deduction, meal allowance, trust thresholds, photo retention."></p>

<sub>Left: Attendance report for one employee. · Right: Attendance and pay rules: late deduction, meal allowance, trust thresholds, photo retention.</sub>

### 7. AI agent over MCP

The owner can connect an AI agent. AgentBuff connects its own agent automatically after purchase, and other MCP clients get a token with a chosen set of scopes. The agent sees only the tools its scopes allow, and every write is previewed and confirmed before it runs.

- 30 tools, 5 read-only resources and 3 workflow prompts (onboard a company, weekly review, run payroll)
- Scopes such as attendance:read or request:write, optionally limited to some branches
- 20 calls per minute per connection; every write and every read of attendance or payroll data is audited as an agent action
- The owner can revoke a connection at any time

<img src="docs/readme/screens/17-agent.jpg" width="100%" alt="Agent page: the AgentBuff connection and an extra agent with its scopes.">

<sub>Agent page: the AgentBuff connection and an extra agent with its scopes.</sub>

<p><img src="docs/readme/screens/18-mcp-calls.png" width="100%" alt="Real MCP calls on the local demo: tools/list, a summary, and the two-step confirmation."></p>

<sub>Real MCP calls on the local demo: tools/list, a summary, and the two-step confirmation.</sub>

## How it is built

Absentra is a TypeScript monorepo with two packages. `web/` is a React 18 single-page app built with Vite and Tailwind, using TanStack Query for server state and Zustand for UI state. `server/` is an Express 4 API run directly from TypeScript with tsx, with SQLite through better-sqlite3. In production one Node process serves the built web app, the REST API under `/api` and the MCP endpoint under `/mcp` on one port.

The domain rules live in pure modules: the clock-in state machine, geofence (Haversine for circles, ray casting for polygons), trust scoring, the PP 35/2021 payroll engine and role checks. The same modules exist in `web/src/lib/domain` for instant feedback on the phone and in `server/src/domain` where the decision is made.

Every tenant table carries `company_id`, and each route takes the company from the session and passes the actor through one `can()` function. The MCP server is a thin adapter over the same data and the same check, so an agent has no path the web app does not have.

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/architecture-dark.svg"><img src="docs/readme/architecture-light.svg" width="100%" alt="How Absentra is built."></picture>

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/data-model-dark.svg"><img src="docs/readme/data-model-light.svg" width="100%" alt="Data model"></picture>

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/flow-1-dark.svg"><img src="docs/readme/flow-1-light.svg" width="100%" alt="Clocking in"></picture>

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/flow-2-dark.svg"><img src="docs/readme/flow-2-light.svg" width="100%" alt="Overtime to pay"></picture>

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/flow-3-dark.svg"><img src="docs/readme/flow-3-light.svg" width="100%" alt="An agent changes data"></picture>

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/flow-4-dark.svg"><img src="docs/readme/flow-4-light.svg" width="100%" alt="Connecting from AgentBuff"></picture>

### Security

- Tenant scope comes from the session on every request, and the same can() check guards REST routes and MCP tools.
- Owners sign in with AgentBuff through OpenID Connect with PKCE; the ID token signature, issuer, audience, expiry and nonce are verified.
- Sessions use httpOnly cookies, and refresh tokens rotate; a reused refresh token revokes its whole family.
- A Content Security Policy, frame blocking, a permissions policy for camera and location, and a CSRF origin guard in production.
- Rate limits on sign-in, clock-in and the MCP endpoint; MCP tokens are stored only as hashes.
- Location and photos are collected only after consent, photos are erased after the retention period, and viewing another person's record is audited.
- Password sign-in exists only for emails on an allowlist, and an open allowlist is refused in production.

### Decisions

| Decision | Why |
| --- | --- |
| Web app, not a native app | Employees do not install anything, and it works the same on Android and iPhone. |
| Flag instead of block | Browser GPS can be weak indoors; the owner reviews doubtful clock-ins instead of the app refusing honest workers. |
| One permission function | REST and MCP share can(), so the agent never gets a path around the rules. |
| Server-enforced confirmation | An agent's own confirm flag proves nothing, so writes need a token bound to the exact arguments. |
| SQLite in one process | One container and one file keep a small business deployment simple; company_id on every table keeps the path to PostgreSQL open. |
| Pure domain engines | Payroll, geofence and trust logic are plain functions, easy to test and shared between phone and server. |

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/stack-dark.svg"><img src="docs/readme/stack-light.svg" width="100%" alt="Absentra stack."></picture>

### Highlights

- Every query is scoped by the company from the session, and every REST route and MCP tool calls the same can() permission check.
- MCP writes use a server-side two-step confirmation: a single-use token bound to the tool, the exact arguments and the preview the owner saw.
- The PP 35/2021 worked example (Rp4,000,000 a month, 2 hours of overtime, Rp80,924) is asserted in the server test suite.
- A clock-in sent without signal is kept on the phone with its real time and an idempotency key, so a retry never makes a second record.
- Strict CSP, a CSRF origin guard, rate limits, and rotating refresh tokens that revoke the whole family when a used token comes back.

## Getting started

Absentra has two packages: `server/` (Express API, SQLite, MCP endpoint) and `web/` (React app). There is no database server to install: the API creates a SQLite file on first start.

### Requirements

- Node.js 22 and npm
- A C/C++ toolchain only if `better-sqlite3` has no prebuilt binary for your platform
- A browser on `localhost` or HTTPS, so location and camera work for the clock-in screen

### Run it locally (two terminals)

```bash
# 1) API on http://localhost:8787 (creates server/absentra.db)
cd server
npm install
AGENTBUFF_GATE_DISABLED=1 PASSWORD_AUTH_ALLOWLIST='*' npm run dev

# 2) Web app on http://localhost:7707 (forwards /api to :8787)
cd web
npm install
npm run dev
```

The web dev server listens on port 7707 (set in `web/vite.config.ts`), not 5173.

The server also reads `server/.env` if the file exists, so the variables below can live there instead of the command line. The file is ignored by git, and the repository has no `.env.example`.

### Sign in without Google or AgentBuff

In production, owners sign in with AgentBuff and invited staff with Google. Locally you can use password sign-in instead. It works only for emails on `PASSWORD_AUTH_ALLOWLIST`. The value `*` allows any email, and the server refuses it when `NODE_ENV=production`.

There is no sign-up form for passwords, so create the account once through the API:

```bash
curl -X POST http://localhost:8787/api/auth/signin \
  -H 'content-type: application/json' \
  -d '{"email":"owner@example.com","name":"Owner","password":"choose-a-password","register":true}'
```

Then open http://localhost:7707/masuk, choose **Masuk dengan kata sandi (khusus admin)**, and sign in. A new account goes to the setup wizard (business, work location, working hours).

To try the employee side, add an employee in **Karyawan** with an email on the allowlist, create that account with the same request, sign in as that person, accept the consent screen and clock in.

To start over, stop the server and delete `server/absentra.db` (plus the `-wal` and `-shm` files next to it).

### Single-origin mode (as in production)

The API can serve the built web app itself, so everything runs on one port:

```bash
cd web && npm run build            # type check, then build into web/dist
cd ../server
WEB_DIST="$PWD/../web/dist" APP_ORIGIN=http://localhost:8787 \
  AGENTBUFF_GATE_DISABLED=1 PASSWORD_AUTH_ALLOWLIST='*' npm start
```

`WEB_DIST` must be an absolute path, because the API sends `index.html` for every page that is not `/api` or `/mcp`.

### Docker

The `Dockerfile` builds the web app, installs the server with its native SQLite module, and runs one Node 22 process on port 8787 with the database at `/data/absentra.db`.

```bash
docker build -t absentra .
docker run -p 8787:8787 -v absentra-data:/data \
  -e APP_ORIGIN=http://localhost:8787 \
  -e AGENTBUFF_GATE_DISABLED=1 \
  -e PASSWORD_AUTH_ALLOWLIST=owner@example.com \
  absentra
```

The image sets `NODE_ENV=production`. That means `APP_ORIGIN` must match the address in the browser (it is used for the CSRF origin check), and the password allowlist must name real emails.

### Environment variables (names only)

| Variable | Purpose |
| --- | --- |
| `PORT` | API port, default 8787 |
| `ABSENTRA_DB` | Path of the SQLite file, default `server/absentra.db` |
| `WEB_DIST` | Folder of the built web app to serve from the API |
| `APP_ORIGIN` | Public address of the app, used for redirects and the origin check |
| `NODE_ENV` | `production` turns on the origin check and stricter sign-in rules |
| `PASSWORD_AUTH_ALLOWLIST` | Comma-separated emails allowed to use password sign-in |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Google sign-in for staff |
| `AGENTBUFF_MASUK_CLIENT_ID`, `AGENTBUFF_MASUK_CLIENT_SECRET`, `AGENTBUFF_MASUK_ISSUER` | Sign in with AgentBuff for owners |
| `AGENTBUFF_ENTITLEMENT_URL`, `AGENTBUFF_PARTNER_SECRET`, `ABSENTRA_PRODUCT_KEY` | Older marketplace entitlement check |
| `AGENTBUFF_GATE_DISABLED` | Set to `1` to run without the AgentBuff marketplace gate |
| `SSO_BRIDGE_OPERATOR_SECRET` | Turns on the SSO bridge for partner apps (off when unset) |
| `ABSENTRA_RATE_LIMIT_DISABLED`, `ABSENTRA_ENFORCE_ORIGIN` | Test switches; the first is ignored in production |

In production without any AgentBuff settings and without `AGENTBUFF_GATE_DISABLED=1`, the server logs a configuration error and new owners cannot create a company.

### Connect an AI agent

Sign in as the owner, open **Agen AI**, choose **Agen lain**, pick the scopes and copy the token (it is shown once). Point an MCP client at `http://localhost:8787/mcp` with the header `Authorization: Bearer <token>`. The endpoint speaks JSON-RPC 2.0 (`initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`, `prompts/list`, `prompts/get`).

### Tests and checks

```bash
cd server && npm test        # Vitest + Supertest against the Express app
cd server && npm run typecheck
cd web && npm test           # domain engine tests
cd web && npm run typecheck
```

### Project structure

```
server/
  src/domain/     clock-in state machine, geofence, trust score, PP 35/2021 payroll, roles
  src/lib/        database schema, sessions, audit log, AgentBuff sign-in and gate, rate limits
  src/routes/     REST routes and the MCP server (mcpServer.ts)
  test/           Vitest suites
web/
  src/features/   screens: landing, sign-in, setup, clock-in, dashboard, approvals, team, shifts, payroll, agent
  src/lib/        API client, domain engines with tests, formatting
  public/         icons, mascot illustrations, manifest
docs/             product requirements and design notes
Dockerfile        single-origin production image
```

### What was verified for this guide

On 26 Nov 2026 the following was run on Windows with Node 22.16: `npm ci` in both packages, `vite build`, the API in single-origin mode with `AGENTBUFF_GATE_DISABLED=1` and a password allowlist, password sign-in, the setup wizard, clock-in from a phone-sized browser, the owner screens and the MCP endpoint. The server tests (238 passed), the web tests (43 passed) and both type checks passed. The Docker image was not built in this check.

### License

All rights reserved. See [LICENSE](LICENSE). Absentra is a paid product on the AgentBuff Marketplace; the code is shown here for reference.

---

<sub>Made by [Nugraha Labib Mujaddid](https://github.com/nugrahalabib) · [nugrahalabib.com](https://nugrahalabib.com) · [nugrahalabib@gmail.com](mailto:nugrahalabib@gmail.com)</sub>
