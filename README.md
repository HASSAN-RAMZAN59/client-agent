# Client Acquisition & Lead Generation Automation System (Phase 6.5 Complete)

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
7. **Gmail Drafts & Approval Sync** (Phase 7).
8. **Follow-ups and inbound replies** (Phase 8).

---

## 2. Hardened Pipeline Lifecycle (Phase 6.5)

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
→ READY_TO_SEND (Zero outbound sending permitted)
```

> [!IMPORTANT]
> **Safety Invariants Maintained in Phase 6.5**:
> - **ZERO Outbound Communication**: No emails, forms, SMS, or network messages are sent.
> - **Central Authoritative Gate**: `OutreachGateService` enforces all 10 compliance and quality checks. No sending provider can bypass it.
> - **Fail Closed by Default**: `OUTREACH_ENABLED=false` and `DRY_RUN=true` remain hard defaults.
> - **Human Approval Mandatory**: Only explicit human action (`approve-draft <id>`) transitions drafts to `READY_TO_SEND`. AI never auto-approves.

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
| `npm run cli -- review-drafts` | Displays review dashboard with quality scores, quality bands, evidence, and identity flags | **Phase 6.5 Implemented** |
| `npm run cli -- review-draft <id>` | Inspects deep intelligence card, quality band, evidence validity, suppression, and gate decision | **Phase 6.5 Implemented** |
| `npm run cli -- approve-draft <id>` | Human action to approve a specific draft ID and advance to `READY_TO_SEND` | **Phase 6.5 Implemented** |
| `npm run cli -- reject-draft <id>` | Human action to reject a specific draft and record the reason | **Phase 6.5 Implemented** |
| `npm run cli -- suppress <target>` | Adds an email, domain, phone, or business to persistent suppression list | **Phase 6.5 Implemented** |
| `npm run cli -- suppression-list` | Lists all active persistent suppression list entries | **Phase 6.5 Implemented** |
| `npm run cli -- outreach-status` | Displays gate health, suppression stats, cooldown settings, and safety kill switches | **Phase 6.5 Implemented** |
| `npm run cli -- drafts` | Lists stored outreach drafts with personalization scores and quality guard status | **Verified** |
| `npm run cli -- draft <id>` | Displays full draft body copy, evidence bullets, and subject line options | **Verified** |
| `npm run cli -- lead <id>` | Displays full intelligence card, score breakdown, and structured sales angle for a specific lead | **Verified** |
| `npm run cli -- leads` | Lists all prioritized sales leads with enriched primary contacts stored in SQLite | **Verified** |
| `npm run cli -- status` | Verifies Node version, SQLite connectivity, source budgets, and safety controls | **Verified** |
| `npm run cli -- stats` | Aggregates pipeline analytics across stored businesses, audits, leads, contacts, and drafts | **Verified** |

---

## 5. Running Quality, Compliance & Approval Review

```bash
# Check gate status and safety limits
npm run cli -- outreach-status

# Review all drafts pending evaluation
npm run cli -- review-drafts

# Deep review of a specific draft
npm run cli -- review-draft <draft-uuid>

# Approve a draft (transitions to READY_TO_SEND)
npm run cli -- approve-draft <draft-uuid>

# Reject a draft
npm run cli -- reject-draft <draft-uuid> --reason "Need more personalized evidence"

# Add an unsubscribed email or domain to suppression
npm run cli -- suppress client@example.com --reason UNSUBSCRIBED

# View suppression list
npm run cli -- suppression-list
```

---

## 6. Testing & Quality Verification

```bash
# Run unit & integration test suite (107 tests passing across 14 suites)
npm test

# Run TypeScript typecheck (0 errors)
npm run typecheck

# Build production bundle
npm run build
```
