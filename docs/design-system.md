# Absentra — Design System

> Concrete, implementation-ready design tokens and component rules for Absentra's web PWA.
> **Derived from PRD §8 (authoritative) reconciled with the installed `ui-ux-pro-max` skill.**
> Authority order on conflict: **PRD §8 → this document → fresh skill output.** Regenerate options with the skill; never let it overwrite a PRD decision.
>
> How this was generated: `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<query>" --design-system -p "Absentra"` for the two primary surfaces (employee mobile clock-in, Owner dashboard), plus `--domain color/ux` queries. The skill's first instinct ("Motion-Driven", parallax, downloaded Google Fonts) was **rejected** because it conflicts with PRD's low-end-phone / data-saving / performance-first constraints — we kept its **Flat Design** + **Data-Dense Dashboard** recommendations (both rated "Excellent" performance, WCAG AA/AAA) and its accessible **trust-teal** palette.

## 1. Direction

| Aspect | Decision | Why |
|---|---|---|
| **Style** | **Flat Design** (employee mobile) + **Data-Dense Dashboard** (Owner desktop) | Both rated "Excellent" performance — fits low-end phones & poor networks (PRD §2.1, §2.5). No gradients/parallax. |
| **Mode** | **Light is the default surface**; dark mode provided | Employee mobile is primary; light reads better outdoors. PRD §8.2 requires both modes. |
| **Brand feel** | Trustworthy, warm, calm-professional | Trust is the product's core promise; warm Bahasa Indonesia copy (PRD §2.5, §8.10). |
| **Motion** | Minimal: 150–200 ms ease transitions; respect `prefers-reduced-motion` | Performance + a11y (PRD §8.8, §9.1). |

## 2. Color tokens (semantic)

Base palette = the skill's **"Trust teal + professional blue"** light scheme, mapped onto PRD §8.2's semantic token names. Status colors are chosen for WCAG AA contrast and are **always paired with an icon/text**, never color-only (PRD §8.8). Values are CSS custom properties.

### Light mode (default)
| Token | Value | Usage (PRD §8.2) |
|---|---|---|
| `--color-primary` | `#0F766E` | Primary action (Absen button), brand (teal = trust) |
| `--color-primary-pressed` | `#0B5C55` | Pressed state |
| `--color-on-primary` | `#FFFFFF` | Text/icon on primary |
| `--color-accent` | `#0369A1` | Secondary CTA / links (professional blue) |
| `--color-success` | `#15803D` | On-time, approved |
| `--color-warning` | `#B45309` | Late, needs review (AA on light) |
| `--color-danger` | `#DC2626` | Absent / rejected / destructive |
| `--color-surface` | `#F8FAFC` | App background |
| `--color-surface-elevated` | `#FFFFFF` | Cards, sheets |
| `--color-text` | `#0F172A` | Primary text |
| `--color-text-muted` | `#64748B` | Secondary text |
| `--color-border` | `#E2E8F0` | Dividers, input borders |
| `--color-focus-ring` | `#0F766E` | Accessibility focus indicator |

### Dark mode (token values swap)
| Token | Value |
|---|---|
| `--color-primary` | `#2DD4BF` |
| `--color-on-primary` | `#04201D` |
| `--color-accent` | `#38BDF8` |
| `--color-success` | `#22C55E` |
| `--color-warning` | `#F59E0B` |
| `--color-danger` | `#F87171` |
| `--color-surface` | `#0F172A` |
| `--color-surface-elevated` | `#1E293B` |
| `--color-text` | `#F1F5F9` |
| `--color-text-muted` | `#94A3B8` |
| `--color-border` | `rgba(255,255,255,0.10)` |
| `--color-focus-ring` | `#2DD4BF` |

**Status badge mapping:** On-time → success · Late → warning · Absent/Rejected → danger · Flagged (trust < threshold) → warning + flag icon · Cuti → accent/neutral. Always render an icon + label alongside the color.

## 3. Typography

**System font stack — do NOT download web fonts** (PRD §8.2 mandates the system stack for performance/data cost; this overrides the skill's "Inter/Google Fonts" suggestion). Inter *may* be self-hosted later as a progressive enhancement, never as a blocking download.

```css
--font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
```

- **Base size 16 px** (prevents forced zoom on iOS inputs).
- Modular scale: **12 / 14 / 16 / 20 / 24 / 32** px.
- Weights: 400 body, 500 emphasis, 600–700 headings/numbers. Tabular numbers for tables/recaps.

## 4. Spacing, radius, elevation, touch

- **Spacing** — 4 px base: `--space-1:4 / -2:8 / -3:12 / -4:16 / -6:24 / -8:32 / -12:48`.
- **Radius** — `--radius-sm:6 / -md:10 / -lg:16 / -full:9999`.
- **Elevation** — layered soft shadows for hierarchy: card < sheet < modal. Flat by default; no decorative shadows.
- **Touch** — targets **≥ 44×44 px** (ideal 48), gaps **≥ 8 px** (PRD §8.2/§8.7).

## 5. Responsive breakpoints (PRD §8.3)

| BP | Width | Layout |
|---|---|---|
| `xs` | < 480 | Single column, bottom action bar + bottom-nav |
| `sm` | 480–767 | Roomier single column |
| `md` | 768–1023 | Two-column / master-detail begins |
| `lg` | 1024–1439 | Sidebar nav + content + panel |
| `xl` | ≥ 1440 | Max content width, multi-panel dashboard |

- **Mobile nav:** bottom tab bar — Absen · Jadwal · Pengajuan · Profil.
- **Desktop nav:** persistent left sidebar; rich tables; master-detail for approvals.
- Use fluid grid + **container queries** so components adapt to context, not just viewport.

## 6. Components (PRD §8.4)

Each component defines anatomy · states · variants · sizes · touch behavior · a11y. Minimum set:

- **Button** — variants `primary`/`secondary`/`ghost`/`danger`; sizes sm/md/lg (height ≥ 44 px); states default/hover(pointer)/pressed(≤100 ms)/focus-visible/loading/disabled; `cursor-pointer` on all clickables.
- **Text input / Field** — always-visible label (not placeholder-only), helper + error text, correct `inputmode`/`type`, `font-size ≥ 16px`; error announced via `aria-live`.
- **Select / Combobox** — searchable; on mobile becomes a full-screen **bottom sheet**.
- **Date/Time picker** — native where adequate; large touch-friendly range picker.
- **Card** — summaries; whole card tappable.
- **Bottom sheet / Modal** — bottom sheet on mobile (swipe-to-dismiss, drag handle, focus trap); centered modal on desktop.
- **Bottom nav (mobile)** / **Sidebar (desktop)**.
- **Data table (desktop) / list-card (mobile)** — table sortable/filterable/sticky-header; on mobile `overflow-x-auto` wrapper or card layout (never overflow viewport).
- **Toast / Snackbar + Inline Alert** — toast for transient confirms ("Absen tersimpan"); inline alert for persistent status.
- **Avatar / Badge / Chip** — status badge = semantic color **+ icon** (never color alone).
- **Skeleton / Spinner** — skeleton for content, spinner for short actions.
- **Camera Capture** — viewport, face-frame guide, large capture button (thumb zone), liveness prompt, retry; graceful permission-denied fallback.
- **Map & Geofence picker (Owner)** — place point + radius; mobile uses a large slider.

Icons: SVG (Heroicons/Lucide), **never emojis as icons**.

## 7. Key screens (PRD §8.5)

| ID | Screen | Notes |
|---|---|---|
| **S1** | **Absen** (employee, mobile) — *most important* | Big status; dominant **Absen Masuk/Keluar** CTA in thumb zone; full clock-in FSM states each with specific visual + microcopy (e.g. Queued: "Tersimpan, akan dikirim saat online"). |
| S2 | Jadwal Saya | Shift agenda; night-shift indicator; leave status. |
| S3 | Pengajuan | Leave/overtime form (bottom sheet) + request status list. |
| S4 | Dashboard Owner | Metric cards (hadir/telat/belum/cuti/lembur), live feed, anomaly inbox, trends; branch/division filter. |
| S5 | Manajemen Karyawan | Table/list, invite (link+QR), edit, set wage (gated), bulk import. |
| S6 | Penjadwalan Shift | Weekly calendar; drag-to-assign (desktop); bulk apply to division; rotation patterns. |
| S7 | Approval Inbox | Requests + anomalies; approve/reject/correct with reason; master-detail (desktop) / sheet (mobile). |
| S8 | Rekap Payroll | Period + scope → recap preview (late, deduction, meal, OT per tier) → export. |
| S9 | Koneksi MCP / Agen | Agent connections, allowed scope+branches, **revoke**, tool-call audit trail. |
| S10 | Onboarding Wizard | Company → branch+geofence → shift+policy defaults → invite employees. |

## 8. State, touch, a11y, copy (carry from PRD §8.6–§8.10)

- **Every screen** designs idle / loading / success / error / empty / offline explicitly. Empty states guide an action; errors are human + actionable with a retry path; offline shows a non-blocking banner and *queued* status.
- **Touch patterns:** primary action in the thumb zone; bottom sheets over small modals; swipe actions on lists (confirm destructive); pull-to-refresh; sticky primary CTA; no hover-dependent UI; tap feedback (ripple/scale) ≤ 100 ms.
- **State management:** server cache (stale-while-revalidate, optimistic, **cache keys namespaced by `company_id`**), ephemeral UI store, form + shared validation schema. Clock-in = explicit FSM.
- **A11y (WCAG 2.2 AA):** contrast ≥ 4.5:1; status never color-only; full keyboard nav + visible focus + focus trap in sheets/modals; `aria-live` for dynamic status; meet Target Size; honor `prefers-reduced-motion`.
- **Copy/i18n:** warm, solution-focused **Bahasa Indonesia**; externalized strings (i18n-ready); dates/numbers in Indonesian locale + **tenant timezone**.

## 9. Pre-delivery checklist (per UI change)

- [ ] SVG icons (Heroicons/Lucide), no emoji icons.
- [ ] `cursor-pointer` on all clickable elements.
- [ ] Transitions 150–200 ms; `prefers-reduced-motion` respected.
- [ ] Light-mode text contrast ≥ 4.5:1; status paired with icon/text.
- [ ] Visible keyboard focus; focus trap in modal/sheet.
- [ ] Touch targets ≥ 44×44 px, gaps ≥ 8 px.
- [ ] Responsive verified at 375 / 768 / 1024 / 1440 px.
- [ ] All six screen states present (idle/loading/success/error/empty/offline).
- [ ] Strings externalized; copy in Bahasa Indonesia; tenant timezone respected.
- [ ] No downloaded web font on the critical path (system stack).
