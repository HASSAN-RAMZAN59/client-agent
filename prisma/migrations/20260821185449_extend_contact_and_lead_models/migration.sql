-- AlterTable
ALTER TABLE "leads" ADD COLUMN "contactDiscoveryConfidence" TEXT;
ALTER TABLE "leads" ADD COLUMN "contactDiscoverySource" TEXT;
ALTER TABLE "leads" ADD COLUMN "contactDiscoveryStatus" TEXT;
ALTER TABLE "leads" ADD COLUMN "contactQualityScore" REAL;
ALTER TABLE "leads" ADD COLUMN "primaryContactType" TEXT;
ALTER TABLE "leads" ADD COLUMN "primaryContactValue" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_contacts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "email" TEXT,
    "value" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL DEFAULT 'EMAIL',
    "classification" TEXT NOT NULL DEFAULT 'BUSINESS_GENERIC',
    "contactName" TEXT,
    "role" TEXT,
    "rawPhone" TEXT,
    "normalizedPhone" TEXT,
    "source" TEXT NOT NULL DEFAULT 'OFFICIAL_WEBSITE',
    "sourceUrl" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'OFFICIAL_WEBSITE',
    "confidence" TEXT NOT NULL DEFAULT 'HIGH',
    "qualityScore" REAL NOT NULL DEFAULT 0.0,
    "status" TEXT NOT NULL DEFAULT 'VERIFIED_PUBLIC',
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "discoveredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "contacts_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_contacts" ("businessId", "contactName", "createdAt", "email", "id", "isPublic", "isVerified", "role", "source", "updatedAt") SELECT "businessId", "contactName", "createdAt", "email", "id", "isPublic", "isVerified", "role", "source", "updatedAt" FROM "contacts";
DROP TABLE "contacts";
ALTER TABLE "new_contacts" RENAME TO "contacts";
CREATE INDEX "contacts_email_idx" ON "contacts"("email");
CREATE INDEX "contacts_value_idx" ON "contacts"("value");
CREATE INDEX "contacts_type_idx" ON "contacts"("type");
CREATE INDEX "contacts_status_idx" ON "contacts"("status");
CREATE INDEX "contacts_businessId_idx" ON "contacts"("businessId");
CREATE UNIQUE INDEX "contacts_businessId_type_value_key" ON "contacts"("businessId", "type", "value");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
