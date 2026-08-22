-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_website_audits" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "website" TEXT NOT NULL,
    "finalUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "confidence" TEXT NOT NULL DEFAULT 'MEDIUM',
    "score" REAL NOT NULL DEFAULT 0.0,
    "technicalScore" REAL,
    "mobileScore" REAL,
    "performanceScore" REAL,
    "seoScore" REAL,
    "accessibilityScore" REAL,
    "uxScore" REAL,
    "contentScore" REAL,
    "opportunityFlags" TEXT,
    "mobileAppOpportunity" TEXT,
    "mobileAppReasoning" TEXT,
    "findings" TEXT,
    "pageCount" INTEGER DEFAULT 1,
    "mobileResponsive" BOOLEAN,
    "sslValid" BOOLEAN,
    "hasContactForm" BOOLEAN,
    "loadTimeMs" INTEGER,
    "issuesJson" TEXT,
    "auditedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "website_audits_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_website_audits" ("businessId", "createdAt", "hasContactForm", "id", "issuesJson", "loadTimeMs", "mobileResponsive", "performanceScore", "score", "sslValid", "status", "updatedAt", "website") SELECT "businessId", "createdAt", "hasContactForm", "id", "issuesJson", "loadTimeMs", "mobileResponsive", "performanceScore", "score", "sslValid", "status", "updatedAt", "website" FROM "website_audits";
DROP TABLE "website_audits";
ALTER TABLE "new_website_audits" RENAME TO "website_audits";
CREATE INDEX "website_audits_businessId_idx" ON "website_audits"("businessId");
CREATE INDEX "website_audits_status_idx" ON "website_audits"("status");
CREATE INDEX "website_audits_score_idx" ON "website_audits"("score");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
