# Database Migration & Operational Safety Guide

This document outlines deterministic, zero-data-loss database schema evolution, backup, and recovery workflows for SQLite and Prisma.

---

## 1. Safety Directives & Invariants

> [!CAUTION]
> **Prohibited in Production**:
> - `prisma migrate reset` must **NEVER** be called programmatically, automatically, or as part of application startup.
> - Production databases must **NEVER** be wiped or reset.
> - Always take an atomic backup before executing any schema migration.

---

## 2. Backup Workflow (Pre-Migration Requirement)

Before modifying `prisma/schema.prisma` or running migration commands, always take a timestamped backup:

```bash
npm run db:backup
```

**What this does**:
- Verifies the active database exists.
- Creates an atomic snapshot in `backups/dev-YYYY-MM-DD-HHMMSS.db`.
- Calculates and logs the SHA-256 integrity checksum.
- Never overwrites existing backups.

---

## 3. Development Migration Workflow

When introducing new models or additive schema updates during local development:

1. **Create Backup**:
   ```bash
   npm run db:backup
   ```
2. **Apply Additive Changes**:
   ```bash
   npx prisma db push
   ```
   *Note: `prisma db push` on SQLite safely synchronizes new tables and optional columns without dropping historical records.*
3. **Regenerate Client**:
   ```bash
   npm run prisma:generate
   ```
4. **Verify Database Integrity**:
   ```bash
   npm run cli -- integrity
   ```

---

## 4. Production Migration Workflow

In production environments:

1. **Verify Environment Isolation**:
   Confirm that `NODE_ENV=production` is set and `DATABASE_URL` does NOT reference `test.db`.
2. **Take Pre-Deployment Backup**:
   ```bash
   npm run db:backup
   ```
3. **Execute Production Deploy**:
   ```bash
   npx prisma migrate deploy
   ```
4. **Run System Health Check**:
   ```bash
   npm run cli -- health
   ```

---

## 5. Rollback & Recovery Procedure

If a migration fails or schema inconsistency occurs, restore the database safely from a known good backup:

```bash
npm run db:restore -- --file backups/dev-YYYY-MM-DD-HHMMSS.db --confirm RESTORE
```

**Safety Safeguards Enforced by Restore Tooling**:
1. **Explicit Token Required**: `--confirm RESTORE` must be explicitly passed.
2. **Pre-Restore Snapshot**: The tool automatically takes a backup of the current database before touching it.
3. **Checksum Verification**: Validates file integrity before and after copy.
4. **No Silent Overwrite**: Fails if target or source path is invalid.
