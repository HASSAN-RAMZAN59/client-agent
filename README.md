# Zero-Cost Client Acquisition & Lead Generation Automation System

A production-hardened, modular, zero-cost client acquisition and lead generation automation system designed for freelance web and mobile development business operations.

---

## 1. System Overview & Architecture

The system orchestrates an end-to-end, locally hosted pipeline:
1. **Public Business Discovery**: Multi-market public organic search and OpenStreetMap Overpass discovery.
2. **Technical & UX Website Auditing**: HTTP status checking combined with Playwright Headless Mobile inspection.
3. **Multi-Factor Lead Scoring**: 6-factor commercial scoring model prioritizing high-opportunity local businesses into `HOT`, `WARM`, and `COLD` tiers.
4. **Public Contact Discovery**: Extracts and validates publicly listed emails, phone numbers, and contact forms directly from official websites with provenance tracking.
5. **AI & Rule-Based Personalization Engine**: Generates 3 evidence-backed outreach variants with anti-hallucination guards.
6. **Outreach Quality & Compliance Gate**: Enforces CAN-SPAM requirements, postal address insertion, opt-out mechanisms, and explicit human approval.
7. **Controlled Outreach Delivery**: Sequential delivery with atomic claiming, safety kill switches, and strict transport policy gates.
8. **Campaign Run State & Activity Audit Logging**: Tracks real progress counters and records operator events.

---

## 2. Critical Safety Invariants & Provider Policy

> [!CAUTION]
> **PERSONAL GMAIL COLD COMMERCIAL OUTREACH IS STRICTLY BLOCKED**:
> - Google Gmail Program Policies strictly prohibit using personal Gmail accounts (`@gmail.com` or `@googlemail.com`) via SMTP for unsolicited commercial cold outreach.
> - The provider policy gate classifies personal Gmail as `UNSUPPORTED` and refuses to dispatch cold commercial outreach under all circumstances.
> - `DRY_RUN=true`, `OUTREACH_ENABLED=false`, `LIVE_PILOT_ENABLED=false`, and `OUTREACH_KILL_SWITCH=true` remain authoritative safety defaults.
> - Zero real emails are sent during development, testing, or dry runs.

---

## 3. Installation & Windows Setup

The project runs natively on **Windows (PowerShell)** and Unix-like environments.

```powershell
# 1. Install dependencies
npm install

# 2. Install Playwright Chromium browser binary
npx playwright install chromium

# 3. Setup environment configuration
cp .env.example .env

# 4. Generate Prisma client
npm run prisma:generate
```

---

## 4. Environment Variables Reference

| Variable | Description | Safe Default |
|---|---|---|
| `DATABASE_URL` | SQLite database connection string | `file:./dev.db` |
| `NODE_ENV` | Environment profile (`development`, `test`, `production`) | `development` |
| `LOG_LEVEL` | Logging level (`debug`, `info`, `warn`, `error`) | `info` |
| `DRY_RUN` | Global simulation mode (disables network dispatch) | `true` |
| `OUTREACH_ENABLED` | Master outreach permission gate | `false` |
| `LIVE_PILOT_ENABLED` | Controlled pilot execution permission | `false` |
| `OUTREACH_KILL_SWITCH` | Emergency kill switch blocking all outbound sends | `true` |
| `AUTO_FOLLOWUP_ENABLED` | Automated follow-up dispatch flag | `false` |
| `MAX_ITEMS_PER_RUN` | Maximum businesses processed per discovery run | `10` |
| `MAX_EMAILS_PER_RUN` | Maximum emails dispatched per batch | `5` |
| `MAX_EMAILS_PER_DAY` | Maximum emails dispatched per 24 hours | `20` |
| `SMTP_HOST` | SMTP server host | `smtp.gmail.com` |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_USER` | SMTP username | `[Configured in .env]` |
| `SMTP_PASSWORD` | SMTP password / App password | `[Masked/Redacted]` |
| `SENDER_POSTAL_ADDRESS` | Physical postal address for CAN-SPAM compliance | `[Configured in .env]` |

---

## 5. Local Operator Dashboard (Web UI)

The system includes a complete, locally hosted single-page web dashboard (`http://127.0.0.1:3000`) for full operational visibility and pipeline execution without needing terminal commands.

### Starting the Dashboard
```powershell
# Method 1: Windows 1-Click Launcher (double-click from Windows Explorer)
start-dashboard.bat

# Method 2: Single npm command
npm run dashboard

# Build production dashboard bundle (automatically served by backend)
npm run build:dashboard
```

### Key Operator Views
1. **System Overview**: Pipeline health, kill switch status, safety badges, active campaign counters, conversion funnel snapshot, quick action shortcuts.
2. **Campaign Operations**: Create new campaigns with market/niche inputs, trigger pipeline runs, track live multi-stage execution progress, view stage metrics.
3. **Lead Intelligence Explorer**: Searchable, filterable list of all discovered businesses, opportunity scores, tech stack detections, and deep drawer inspection.
4. **Human Review Queue**: Single-card human review interface showing draft variants, evidence citations, live edit re-approval requirements, and one-click approvals.
5. **Pilot & Dry-Run Operations**: Safe simulation console showing approved candidates (Chapman Air & Heat, Dallas Dental Specialists), pre-send policy checks, dry-run simulations (0 real emails), and live-send policy blockage warnings.
6. **Phone Lead Management**: Dedicated workflow for businesses without verified email, tracking phone numbers, contact status, and operator call notes.
7. **Inbox & Reply Classifier**: Inbound communication management with automated sentiment tagging (`POSITIVE`, `OBJECTION`, `UNSUBSCRIBE`), and suppression list status.
8. **Funnel & Acquisition Analytics**: 10-stage real conversion funnel, channel performance, objection analysis, and Phase 12 read-only metrics card (`PENDING_REAL_PILOT_DATA`).
9. **Activity Audit Log**: Full chronological trail of system and operator actions with automated masking of sensitive secrets and credentials.
10. **System Health & Safety Guardrails**: Real-time status of Playwright Chromium, SQLite database, SMTP transport policy, and active kill switches.
11. **Settings & Provider Configuration**: Operational limits, masked environment secrets, and configuration slots for future commercial outbound providers.

---

## 6. Safe Startup, Status & Health Inspection

```powershell
# Verify full system health (Playwright, SQLite, SMTP, Safety Mode — ZERO SENDS)
npm run cli -- health

# Display concise operational summary (Counts, campaigns, approved drafts, provider policy)
npm run cli -- status

# Run database integrity audit (Foreign keys, orphan records, unique constraints)
npm run cli -- integrity
```

---

## 7. Database Backup & Safe Restore

The database uses zero-cost local SQLite storage with atomic backup tooling.

```powershell
# 1. Create a timestamped, SHA-256 verified backup
npm run db:backup
# Output: backups/dev-YYYY-MM-DD-HHMMSS.db

# 2. Safely restore from a verified backup (requires explicit confirmation)
npm run db:restore -- --file backups/dev-2026-09-04-102342.db --confirm RESTORE
```

> [!NOTE]
> The restore command automatically takes a safety snapshot of the active database before touching it.

---

## 8. Campaign Lifecycle & Execution States

Campaign runs progress through strictly tracked, non-fabricated states:

```
CREATED
  └── DISCOVERING
        └── AUDITING
              └── SCORING
                    └── CONTACT_DISCOVERY
                          └── PERSONALIZING
                                └── REVIEW_READY
                                      └── COMPLETED (or PARTIAL_FAILURE / FAILED)
```

---

## 9. Controlled Live Pilot Preview (Dry-Run Simulation)

Inspect approved candidates and pre-send safety validation without sending network emails:

```powershell
# Inspect candidates in dry-run mode (0 network sends)
npm run cli -- pilot-preview --limit 3

# Chapman Air & Heat and Dallas Dental Specialists are approved, frozen, and ready for review.
```

---

## 10. Testing & Quality Verification

```powershell
# Run full Vitest suite (all unit, integration, and safety tests)
npm test

# Run TypeScript typecheck (0 errors)
npm run typecheck

# Verify production build compilation
npm run build
```

---

## 11. Phase 12 Conversion Optimization Status

**Status**: `PENDING_REAL_PILOT_DATA`  
Synthetic dry-run data is never presented as real conversion performance. See [docs/PHASE12_STATUS.md](docs/PHASE12_STATUS.md) for required real-world signal specifications.

---

## 12. Known Operational Limitations

1. **Personal Gmail SMTP**: Cannot be used for outbound cold commercial messaging under Google Gmail Program Policies. A business Google Workspace account with custom domain or dedicated commercial transactional SMTP provider is required for future live outreach.
2. **SQLite Storage**: Highly efficient for single-operator local pipelines up to hundreds of thousands of leads, but concurrent multi-node write operations require Postgres or MySQL in enterprise deployments.
3. **Zero Scraping Bypass**: The system strictly respects rate limits, `robots.txt`, and standard HTTP status codes; it does not bypass CAPTCHAs or employ proxy rotation.
