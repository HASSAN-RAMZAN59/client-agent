# Client Acquisition & Lead Generation Automation System (Phase 7 Complete)

A modular, zero-cost client acquisition and lead generation automation system designed for a freelance web and mobile development business.

---

## 1. System Overview

This project provides an automated, locally hosted pipeline to:
1. **Discover local businesses** (OpenStreetMap Overpass & public organic search).
2. **Audit website technical & UX quality** (HTTP + Playwright Headless Mobile Browser).
3. **Score & prioritize sales opportunities** (Multi-Factor Commercial Lead Scoring Model).
4. **Discover public business contacts** (Official website email, phone, and contact form extraction without SMTP probing).
5. **AI Personalization & Outreach Content Engine** (3 evidence-backed variants, anti-spam quality guard, zero-cost rule engine).
6. **Outreach Quality, Compliance & Human Approval Hardening** (Phase 6.5 Gate: suppression, cooldowns, SHA-256 duplicate detection, explicit human approval).
7. **Controlled Outreach Execution Engine** (Phase 7: atomic draft claiming, final double-check gate, mock & SMTP zero-cost transport, rate-limited sequential delivery).
8. **Follow-ups and inbound replies** (Phase 8).

---

## 2. Hardened Pipeline Lifecycle (Phase 7)

```
LEAD
→ PERSONALIZATION DRAFT
→ QUALITY CHECK (0–100 Score & Quality Bands)
→ EVIDENCE VALIDATION (Anti-Hallucination)
→ BUSINESS IDENTITY VALIDATION (Domain match)
→ SUPPRESSION CHECK (Email, Domain, Phone, Business)
→ DUPLICATE & CONTENT-HASH CHECK (SHA-256)
→ COOLDOWN CHECK (Business & Contact cooldown)
→ HUMAN APPROVAL GATE (Explicit approve-draft)
→ READY_TO_SEND
→ FINAL PRE-SEND GATE DOUBLE-CHECK
→ SAFETY LIMITS (Daily max & per-run batch caps)
→ ATOMIC CLAIM (READY_TO_SEND -> SENDING)
→ DELIVERY PROVIDER (Mock / SMTP Transport)
→ SENT / FAILED
```

> [!IMPORTANT]
> **Safety Invariants Maintained in Phase 7**:
> - **ZERO Real Emails Sent During Testing**: `DRY_RUN=true` and `OUTREACH_ENABLED=false` remain strict defaults.
> - **Fail Closed Architecture**: If configuration is ambiguous, disabled, or missing, the system refuses to send.
> - **Central Authoritative Gate**: `OutreachGateService` + `SafetyControls` are evaluated immediately before delivery.
> - **Atomic Claim Mechanism**: Prevents concurrent race conditions and duplicate delivery attempts.
> - **Credential Security**: Passwords and auth tokens are never logged, stored in SQLite, or leaked in error messages.

---

## 3. Installation & Setup

```bash
# 1. Install dependencies & Playwright Chromium
npm install
npx playwright install chromium

# 2. Setup environment
cp .env.example .env

# 3. Apply Prisma migrations to SQLite
npm run prisma:generate
npm run prisma:migrate
```

---

## 4. CLI Commands Reference

| Command | Description | Status |
|---|---|---|
| `npm run cli -- discover` | Discovers businesses via OSM Overpass & public search, checks websites, deduplicates, and stores in SQLite | **Verified** |
| `npm run cli -- audit` | Performs deep technical & UX website audits on discovered businesses or standalone URLs | **Verified** |
| `npm run cli -- score` | Calculates Multi-Factor Lead Opportunity Scores and updates prioritized sales leads | **Verified** |
| `npm run cli -- hot-leads` | Displays only high-priority HOT leads sorted by priority rank and opportunity score | **Verified** |
| `npm run cli -- contacts` | Discovers public business emails, phones, and contact forms for prioritized leads | **Verified** |
| `npm run cli -- personalize` | Generates 3 evidence-backed outreach variants and subject lines without sending emails | **Verified** |
| `npm run cli -- review-drafts` | Displays review dashboard with quality scores, quality bands, evidence, and identity flags | **Verified** |
| `npm run cli -- review-draft <id>` | Inspects deep intelligence card, quality band, evidence validity, suppression, and gate decision | **Verified** |
| `npm run cli -- approve-draft <id>` | Human action to approve a specific draft ID and advance to `READY_TO_SEND` | **Verified** |
| `npm run cli -- reject-draft <id>` | Human action to reject a specific draft and record the reason | **Verified** |
| `npm run cli -- suppress <target>` | Adds an email, domain, phone, or business to persistent suppression list | **Verified** |
| `npm run cli -- suppression-list` | Lists all active persistent suppression list entries | **Verified** |
| `npm run cli -- outreach-status` | Displays gate health, suppression stats, cooldown settings, and safety kill switches | **Verified** |
| `npm run cli -- send-preview <id>` | Comprehensive pre-send inspection verifying final gate decision and limits | **Phase 7 Implemented** |
| `npm run cli -- send-status` | Displays real-time daily volume quota telemetry and provider availability | **Phase 7 Implemented** |
| `npm run cli -- send [--limit] [--dry-run]` | Controlled delivery execution for approved READY_TO_SEND drafts through safety gate | **Phase 7 Implemented** |
| `npm run cli -- drafts` | Lists stored outreach drafts with personalization scores and quality guard status | **Verified** |
| `npm run cli -- draft <id>` | Displays full draft body copy, evidence bullets, and subject line options | **Verified** |
| `npm run cli -- lead <id>` | Displays full intelligence card, score breakdown, and structured sales angle for a specific lead | **Verified** |
| `npm run cli -- leads` | Lists all prioritized sales leads with enriched primary contacts stored in SQLite | **Verified** |
| `npm run cli -- status` | Verifies Node version, SQLite connectivity, source budgets, and safety controls | **Verified** |
| `npm run cli -- stats` | Aggregates pipeline analytics across stored businesses, audits, leads, contacts, and drafts | **Verified** |

---

## 5. Running Controlled Outreach Delivery

```bash
# Check real-time quota telemetry & provider status
npm run cli -- send-status

# Inspect pre-send checks for an approved draft (verifies gate decision & reasons)
npm run cli -- send-preview <approved-draft-uuid>

# Execute controlled simulated batch delivery (DRY_RUN mode, 0 network emails sent)
npm run cli -- send --dry-run --limit 5

# Live delivery attempt (fails closed if OUTREACH_ENABLED=false)
npm run cli -- send --limit 5
```

---

## 6. Testing & Quality Verification

```bash
# Run unit & integration test suite (125 tests passing across 15 suites)
npm test

# Run TypeScript typecheck (0 errors)
npm run typecheck

# Build production bundle
npm run build
```
