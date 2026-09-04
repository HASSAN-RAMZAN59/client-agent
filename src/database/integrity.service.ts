import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from './client.js';
import { logger } from '../utils/logger.js';

export interface IntegrityFinding {
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  category: string;
  description: string;
  count: number;
  sampleIds?: string[];
}

export interface DatabaseIntegrityReport {
  timestamp: string;
  status: 'HEALTHY' | 'WARNING' | 'CORRUPTED';
  recordCounts: {
    businesses: number;
    audits: number;
    leads: number;
    contacts: number;
    outreaches: number;
    followUps: number;
    replies: number;
    suppressions: number;
    campaigns: number;
    campaignBusinesses: number;
    campaignRuns: number;
    activityLogs: number;
  };
  orphanCounts: {
    orphanAudits: number;
    orphanLeads: number;
    orphanContacts: number;
    orphanOutreaches: number;
    orphanFollowUps: number;
    orphanReplies: number;
    orphanCampaignBusinesses: number;
  };
  duplicateCounts: {
    duplicateBusinesses: number;
    duplicateContacts: number;
    duplicateOutreachVariants: number;
    duplicateSuppressions: number;
  };
  findings: IntegrityFinding[];
}

export class DatabaseIntegrityService {
  private db: PrismaClient;
  private log = logger.child('DatabaseIntegrityService');

  constructor(customDb?: PrismaClient) {
    this.db = customDb || getPrismaClient();
  }

  public async auditIntegrity(): Promise<DatabaseIntegrityReport> {
    const findings: IntegrityFinding[] = [];

    // 1. Record Counts
    const [
      businesses,
      audits,
      leads,
      contacts,
      outreaches,
      followUps,
      replies,
      suppressions,
      campaigns,
      campaignBusinesses,
      campaignRuns,
      activityLogs,
    ] = await Promise.all([
      this.db.business.count(),
      this.db.websiteAudit.count(),
      this.db.lead.count(),
      this.db.contact.count(),
      this.db.outreach.count(),
      this.db.followUp.count(),
      this.db.reply.count(),
      this.db.suppression.count(),
      this.db.campaign.count(),
      this.db.campaignBusiness.count(),
      this.db.campaignRun.count(),
      this.db.activityLog.count(),
    ]);

    // 2. Orphan Record Detection (Foreign Key Violations in raw SQLite)
    // Orphan Audits
    const orphanAudits = await this.db.$queryRaw<{ id: string }[]>`
      SELECT wa.id FROM website_audits wa
      LEFT JOIN businesses b ON wa.businessId = b.id
      WHERE b.id IS NULL
    `;

    // Orphan Leads
    const orphanLeads = await this.db.$queryRaw<{ id: string }[]>`
      SELECT l.id FROM leads l
      LEFT JOIN businesses b ON l.businessId = b.id
      WHERE b.id IS NULL
    `;

    // Orphan Contacts
    const orphanContacts = await this.db.$queryRaw<{ id: string }[]>`
      SELECT c.id FROM contacts c
      LEFT JOIN businesses b ON c.businessId = b.id
      WHERE b.id IS NULL
    `;

    // Orphan Outreaches
    const orphanOutreaches = await this.db.$queryRaw<{ id: string }[]>`
      SELECT o.id FROM outreaches o
      LEFT JOIN leads l ON o.leadId = l.id
      WHERE l.id IS NULL
    `;

    // Orphan FollowUps
    const orphanFollowUps = await this.db.$queryRaw<{ id: string }[]>`
      SELECT f.id FROM follow_ups f
      LEFT JOIN outreaches o ON f.outreachId = o.id
      WHERE o.id IS NULL
    `;

    // Orphan Replies
    const orphanReplies = await this.db.$queryRaw<{ id: string }[]>`
      SELECT r.id FROM replies r
      LEFT JOIN outreaches o ON r.outreachId = o.id
      WHERE o.id IS NULL
    `;

    // Orphan CampaignBusinesses
    const orphanCampaignBusinesses = await this.db.$queryRaw<{ id: string }[]>`
      SELECT cb.id FROM campaign_businesses cb
      LEFT JOIN campaigns c ON cb.campaignId = c.id
      LEFT JOIN businesses b ON cb.businessId = b.id
      WHERE c.id IS NULL OR b.id IS NULL
    `;

    // 3. Duplicate checks
    const duplicateBusinesses = await this.db.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*) as count FROM (
        SELECT name, city, category, COUNT(*) as cnt
        FROM businesses
        GROUP BY name, city, category
        HAVING cnt > 1
      )
    `;

    const duplicateContacts = await this.db.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*) as count FROM (
        SELECT businessId, type, value, COUNT(*) as cnt
        FROM contacts
        GROUP BY businessId, type, value
        HAVING cnt > 1
      )
    `;

    const duplicateOutreachVariants = await this.db.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*) as count FROM (
        SELECT leadId, variant, COUNT(*) as cnt
        FROM outreaches
        GROUP BY leadId, variant
        HAVING cnt > 1
      )
    `;

    const duplicateSuppressions = await this.db.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*) as count FROM (
        SELECT targetType, targetValue, COUNT(*) as cnt
        FROM suppressions
        GROUP BY targetType, targetValue
        HAVING cnt > 1
      )
    `;

    const orphanAuditCount = orphanAudits.length;
    const orphanLeadCount = orphanLeads.length;
    const orphanContactCount = orphanContacts.length;
    const orphanOutreachCount = orphanOutreaches.length;
    const orphanFollowUpCount = orphanFollowUps.length;
    const orphanReplyCount = orphanReplies.length;
    const orphanCampaignBusinessCount = orphanCampaignBusinesses.length;

    const dupBizCount = Number(duplicateBusinesses[0]?.count || 0);
    const dupContactCount = Number(duplicateContacts[0]?.count || 0);
    const dupOutreachCount = Number(duplicateOutreachVariants[0]?.count || 0);
    const dupSuppressionCount = Number(duplicateSuppressions[0]?.count || 0);

    if (orphanAuditCount > 0) {
      findings.push({
        severity: 'CRITICAL',
        category: 'ORPHAN_AUDITS',
        description: `Found ${orphanAuditCount} website audit records referencing non-existent businesses.`,
        count: orphanAuditCount,
        sampleIds: orphanAudits.slice(0, 3).map((a) => a.id),
      });
    }

    if (orphanLeadCount > 0) {
      findings.push({
        severity: 'CRITICAL',
        category: 'ORPHAN_LEADS',
        description: `Found ${orphanLeadCount} lead records referencing non-existent businesses.`,
        count: orphanLeadCount,
        sampleIds: orphanLeads.slice(0, 3).map((l) => l.id),
      });
    }

    if (orphanContactCount > 0) {
      findings.push({
        severity: 'CRITICAL',
        category: 'ORPHAN_CONTACTS',
        description: `Found ${orphanContactCount} contact records referencing non-existent businesses.`,
        count: orphanContactCount,
        sampleIds: orphanContacts.slice(0, 3).map((c) => c.id),
      });
    }

    if (orphanOutreachCount > 0) {
      findings.push({
        severity: 'CRITICAL',
        category: 'ORPHAN_OUTREACH',
        description: `Found ${orphanOutreachCount} outreach drafts referencing non-existent leads.`,
        count: orphanOutreachCount,
        sampleIds: orphanOutreaches.slice(0, 3).map((o) => o.id),
      });
    }

    if (orphanCampaignBusinessCount > 0) {
      findings.push({
        severity: 'CRITICAL',
        category: 'ORPHAN_CAMPAIGN_MEMBERSHIP',
        description: `Found ${orphanCampaignBusinessCount} campaign membership records referencing missing campaign or business.`,
        count: orphanCampaignBusinessCount,
        sampleIds: orphanCampaignBusinesses.slice(0, 3).map((cb) => cb.id),
      });
    }

    if (dupBizCount > 0) {
      findings.push({
        severity: 'WARNING',
        category: 'DUPLICATE_BUSINESSES',
        description: `Found ${dupBizCount} duplicate business clusters with identical (name, city, category).`,
        count: dupBizCount,
      });
    }

    let status: 'HEALTHY' | 'WARNING' | 'CORRUPTED' = 'HEALTHY';
    if (findings.some((f) => f.severity === 'CRITICAL')) {
      status = 'CORRUPTED';
    } else if (findings.some((f) => f.severity === 'WARNING')) {
      status = 'WARNING';
    }

    this.log.info(
      `Database integrity audit completed: Status=${status} (${findings.length} findings, ${businesses} businesses, ${leads} leads, ${outreaches} outreaches).`
    );

    return {
      timestamp: new Date().toISOString(),
      status,
      recordCounts: {
        businesses,
        audits,
        leads,
        contacts,
        outreaches,
        followUps,
        replies,
        suppressions,
        campaigns,
        campaignBusinesses,
        campaignRuns,
        activityLogs,
      },
      orphanCounts: {
        orphanAudits: orphanAuditCount,
        orphanLeads: orphanLeadCount,
        orphanContacts: orphanContactCount,
        orphanOutreaches: orphanOutreachCount,
        orphanFollowUps: orphanFollowUpCount,
        orphanReplies: orphanReplyCount,
        orphanCampaignBusinesses: orphanCampaignBusinessCount,
      },
      duplicateCounts: {
        duplicateBusinesses: dupBizCount,
        duplicateContacts: dupContactCount,
        duplicateOutreachVariants: dupOutreachCount,
        duplicateSuppressions: dupSuppressionCount,
      },
      findings,
    };
  }
}

export const databaseIntegrityService = new DatabaseIntegrityService();

// Direct CLI invocation
if (process.argv[1] && (process.argv[1].endsWith('integrity.service.ts') || process.argv[1].endsWith('integrity.service.js'))) {
  databaseIntegrityService
    .auditIntegrity()
    .then((report) => {
      console.log('\n======================================================');
      console.log('           DATABASE INTEGRITY AUDIT REPORT');
      console.log('======================================================');
      console.log(`• Status     : ${report.status}`);
      console.log(`• Timestamp  : ${report.timestamp}`);
      console.log('\n--- Record Counts ---');
      for (const [k, v] of Object.entries(report.recordCounts)) {
        console.log(`• ${k.padEnd(20)}: ${v}`);
      }
      console.log('\n--- Orphan Records ---');
      for (const [k, v] of Object.entries(report.orphanCounts)) {
        console.log(`• ${k.padEnd(26)}: ${v}`);
      }
      console.log('\n--- Duplicate Records ---');
      for (const [k, v] of Object.entries(report.duplicateCounts)) {
        console.log(`• ${k.padEnd(26)}: ${v}`);
      }
      if (report.findings.length > 0) {
        console.log('\n--- Findings ---');
        for (const f of report.findings) {
          console.log(`[${f.severity}] ${f.category}: ${f.description}`);
        }
      } else {
        console.log('\n✔ Zero integrity violations found.');
      }
      console.log('======================================================\n');
      return getPrismaClient().$disconnect();
    })
    .catch((err) => {
      console.error('Integrity Audit Failed:', err);
      process.exit(1);
    });
}
