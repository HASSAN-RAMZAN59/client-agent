-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_leads" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "leadOpportunityScore" REAL NOT NULL DEFAULT 0.0,
    "overallScore" REAL NOT NULL DEFAULT 0.0,
    "classification" TEXT NOT NULL DEFAULT 'WARM',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "priorityRank" INTEGER NOT NULL DEFAULT 3,
    "confidenceLevel" TEXT NOT NULL DEFAULT 'MEDIUM',
    "websiteOpportunityScore" REAL NOT NULL DEFAULT 0.0,
    "commercialPotentialScore" REAL NOT NULL DEFAULT 0.0,
    "contactabilityScore" REAL NOT NULL DEFAULT 0.0,
    "websiteProblemScore" REAL NOT NULL DEFAULT 0.0,
    "mobileAppOpportunityScore" REAL NOT NULL DEFAULT 0.0,
    "dataConfidenceScore" REAL NOT NULL DEFAULT 0.0,
    "recommendedService" TEXT NOT NULL DEFAULT 'WEBSITE_IMPROVEMENT',
    "topOpportunitySignals" TEXT,
    "topProblems" TEXT,
    "salesAngle" TEXT,
    "reasoning" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "scoredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "leads_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_leads" ("businessId", "createdAt", "id", "mobileAppOpportunityScore", "notes", "overallScore", "priority", "status", "updatedAt", "websiteOpportunityScore") SELECT "businessId", "createdAt", "id", "mobileAppOpportunityScore", "notes", "overallScore", "priority", "status", "updatedAt", "websiteOpportunityScore" FROM "leads";
DROP TABLE "leads";
ALTER TABLE "new_leads" RENAME TO "leads";
CREATE UNIQUE INDEX "leads_businessId_key" ON "leads"("businessId");
CREATE INDEX "leads_businessId_idx" ON "leads"("businessId");
CREATE INDEX "leads_priorityRank_idx" ON "leads"("priorityRank");
CREATE INDEX "leads_classification_idx" ON "leads"("classification");
CREATE INDEX "leads_leadOpportunityScore_idx" ON "leads"("leadOpportunityScore");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
