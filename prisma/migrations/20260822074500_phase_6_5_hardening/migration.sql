-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_outreaches" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'EMAIL',
    "variant" TEXT NOT NULL DEFAULT 'VARIANT_B_STANDARD',
    "subject" TEXT,
    "subjectVariants" TEXT,
    "body" TEXT NOT NULL,
    "contentHash" TEXT,
    "personalizationScore" REAL NOT NULL DEFAULT 0.0,
    "qualityScore" REAL NOT NULL DEFAULT 0.0,
    "qualityBand" TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED',
    "evidenceValid" BOOLEAN NOT NULL DEFAULT true,
    "identityValid" BOOLEAN NOT NULL DEFAULT true,
    "confidence" TEXT NOT NULL DEFAULT 'HIGH',
    "provider" TEXT NOT NULL DEFAULT 'RuleBasedPersonalizationProvider',
    "sourceEvidence" TEXT,
    "salesAngle" TEXT,
    "primaryContactValue" TEXT,
    "primaryContactType" TEXT,
    "qualityGuardWarnings" TEXT,
    "qualityGuardPassed" BOOLEAN NOT NULL DEFAULT true,
    "rejectionReason" TEXT,
    "approvedAt" DATETIME,
    "approvedBy" TEXT,
    "expiresAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "sentAt" DATETIME,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "outreaches_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_outreaches" (
    "id", "leadId", "channel", "variant", "subject", "subjectVariants", "body",
    "personalizationScore", "confidence", "provider", "sourceEvidence", "salesAngle",
    "primaryContactValue", "primaryContactType", "qualityGuardWarnings", "qualityGuardPassed",
    "status", "sentAt", "error", "createdAt", "updatedAt"
) SELECT 
    "id", "leadId", "channel", "variant", "subject", "subjectVariants", "body",
    "personalizationScore", "confidence", "provider", "sourceEvidence", "salesAngle",
    "primaryContactValue", "primaryContactType", "qualityGuardWarnings", "qualityGuardPassed",
    "status", "sentAt", "error", "createdAt", "updatedAt"
FROM "outreaches";

DROP TABLE "outreaches";
ALTER TABLE "new_outreaches" RENAME TO "outreaches";

CREATE INDEX "outreaches_leadId_idx" ON "outreaches"("leadId");
CREATE INDEX "outreaches_status_idx" ON "outreaches"("status");
CREATE INDEX "outreaches_variant_idx" ON "outreaches"("variant");
CREATE INDEX "outreaches_contentHash_idx" ON "outreaches"("contentHash");
CREATE INDEX "outreaches_qualityBand_idx" ON "outreaches"("qualityBand");
CREATE INDEX "outreaches_personalizationScore_idx" ON "outreaches"("personalizationScore");
CREATE INDEX "outreaches_qualityScore_idx" ON "outreaches"("qualityScore");
CREATE INDEX "outreaches_expiresAt_idx" ON "outreaches"("expiresAt");
CREATE INDEX "outreaches_sentAt_idx" ON "outreaches"("sentAt");
CREATE UNIQUE INDEX "unique_lead_variant_draft" ON "outreaches"("leadId", "variant");

CREATE TABLE "suppressions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT,
    "targetValue" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT 'HUMAN_OPERATOR',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "suppressions_targetType_idx" ON "suppressions"("targetType");
CREATE INDEX "suppressions_targetValue_idx" ON "suppressions"("targetValue");
CREATE INDEX "suppressions_businessId_idx" ON "suppressions"("businessId");
CREATE INDEX "suppressions_reason_idx" ON "suppressions"("reason");
CREATE UNIQUE INDEX "unique_suppression_target" ON "suppressions"("targetType", "targetValue");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
