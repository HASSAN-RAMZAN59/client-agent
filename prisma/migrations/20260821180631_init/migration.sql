-- CreateTable
CREATE TABLE "businesses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'US',
    "address" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "website_audits" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "website" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "score" REAL NOT NULL DEFAULT 0.0,
    "performanceScore" REAL,
    "mobileResponsive" BOOLEAN,
    "sslValid" BOOLEAN,
    "hasContactForm" BOOLEAN,
    "loadTimeMs" INTEGER,
    "issuesJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "website_audits_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "websiteOpportunityScore" REAL NOT NULL DEFAULT 0.0,
    "mobileAppOpportunityScore" REAL NOT NULL DEFAULT 0.0,
    "overallScore" REAL NOT NULL DEFAULT 0.0,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "leads_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "contactName" TEXT,
    "role" TEXT,
    "source" TEXT NOT NULL,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "contacts_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "outreaches" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'EMAIL',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "sentAt" DATETIME,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "outreaches_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "follow_ups" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "outreachId" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL DEFAULT 1,
    "scheduledAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "follow_ups_outreachId_fkey" FOREIGN KEY ("outreachId") REFERENCES "outreaches" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "replies" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "outreachId" TEXT NOT NULL,
    "senderEmail" TEXT,
    "body" TEXT,
    "classification" TEXT NOT NULL DEFAULT 'UNCLASSIFIED',
    "sentimentScore" REAL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "replies_outreachId_fkey" FOREIGN KEY ("outreachId") REFERENCES "outreaches" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "businesses_website_idx" ON "businesses"("website");

-- CreateIndex
CREATE INDEX "businesses_phone_idx" ON "businesses"("phone");

-- CreateIndex
CREATE INDEX "businesses_city_category_idx" ON "businesses"("city", "category");

-- CreateIndex
CREATE INDEX "businesses_createdAt_idx" ON "businesses"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "businesses_name_city_category_key" ON "businesses"("name", "city", "category");

-- CreateIndex
CREATE INDEX "website_audits_businessId_idx" ON "website_audits"("businessId");

-- CreateIndex
CREATE INDEX "website_audits_status_idx" ON "website_audits"("status");

-- CreateIndex
CREATE INDEX "website_audits_score_idx" ON "website_audits"("score");

-- CreateIndex
CREATE INDEX "leads_businessId_idx" ON "leads"("businessId");

-- CreateIndex
CREATE INDEX "leads_priority_idx" ON "leads"("priority");

-- CreateIndex
CREATE INDEX "leads_status_idx" ON "leads"("status");

-- CreateIndex
CREATE INDEX "leads_overallScore_idx" ON "leads"("overallScore");

-- CreateIndex
CREATE INDEX "contacts_email_idx" ON "contacts"("email");

-- CreateIndex
CREATE INDEX "contacts_businessId_idx" ON "contacts"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_businessId_email_key" ON "contacts"("businessId", "email");

-- CreateIndex
CREATE INDEX "outreaches_leadId_idx" ON "outreaches"("leadId");

-- CreateIndex
CREATE INDEX "outreaches_status_idx" ON "outreaches"("status");

-- CreateIndex
CREATE INDEX "outreaches_sentAt_idx" ON "outreaches"("sentAt");

-- CreateIndex
CREATE INDEX "follow_ups_outreachId_idx" ON "follow_ups"("outreachId");

-- CreateIndex
CREATE INDEX "follow_ups_status_idx" ON "follow_ups"("status");

-- CreateIndex
CREATE INDEX "follow_ups_scheduledAt_idx" ON "follow_ups"("scheduledAt");

-- CreateIndex
CREATE INDEX "replies_outreachId_idx" ON "replies"("outreachId");

-- CreateIndex
CREATE INDEX "replies_classification_idx" ON "replies"("classification");

-- CreateIndex
CREATE INDEX "replies_receivedAt_idx" ON "replies"("receivedAt");
