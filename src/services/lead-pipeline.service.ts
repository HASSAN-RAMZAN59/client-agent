import { getPrismaClient } from '../database/client.js';
import { BusinessRepository } from '../database/repositories/business.repository.js';
import { LeadRepository } from '../database/repositories/lead.repository.js';
import { ContactRepository } from '../database/repositories/contact.repository.js';
import { MockBusinessDiscoveryProvider } from '../modules/discovery/mock-discovery.provider.js';
import { MockWebsiteAuditProvider } from '../modules/auditing/mock-audit.provider.js';
import { RuleBasedLeadScoringProvider } from '../modules/scoring/rule-based-scoring.provider.js';
import { MockContactDiscoveryProvider } from '../modules/contacts/mock-contact.provider.js';
import { MockOutreachProvider } from '../modules/outreach/mock-outreach.provider.js';
import { MockEmailProvider } from '../modules/gmail/mock-email.provider.js';
import { MockFollowUpProvider } from '../modules/followups/mock-followup.provider.js';
import { logger } from '../utils/logger.js';
import { safeSleep } from '../utils/sleeper.js';
import { safetyControls } from '../config/safety.js';

export interface PipelineExecutionOptions {
  niche?: string;
  city?: string;
  limit?: number;
  dryRun?: boolean;
}

export class LeadPipelineService {
  private db = getPrismaClient();
  private businessRepo = new BusinessRepository(this.db);
  private leadRepo = new LeadRepository(this.db);
  private contactRepo = new ContactRepository(this.db);

  private discoveryProvider = new MockBusinessDiscoveryProvider();
  private auditProvider = new MockWebsiteAuditProvider();
  private scoringProvider = new RuleBasedLeadScoringProvider();
  private contactProvider = new MockContactDiscoveryProvider();
  private outreachProvider = new MockOutreachProvider();
  private emailProvider = new MockEmailProvider();
  private followupProvider = new MockFollowUpProvider();

  private log = logger.child('LeadPipelineService');

  /**
   * Executes a complete sample pipeline cycle in Phase 1 (Discovery -> Audit -> Score -> Contacts -> Outreach Draft -> Dry Run Simulation).
   */
  public async executePipelineDemo(options: PipelineExecutionOptions = {}): Promise<{
    discovered: number;
    audited: number;
    leadsGenerated: number;
    contactsFound: number;
    draftsCreated: number;
    emailsSimulated: number;
  }> {
    const niche = options.niche || 'Dentist';
    const city = options.city || 'Austin';
    const limit = Math.min(options.limit || 5, safetyControls.getPolicy().maxItemsPerRun);

    this.log.info(`--- Starting Lead Pipeline Execution (Niche: ${niche}, City: ${city}, DryRun: ${safetyControls.isDryRun()}) ---`);

    // 1. Business Discovery
    const businesses = await this.discoveryProvider.discover({
      niche,
      city,
      limit,
    });

    let auditedCount = 0;
    let leadsGeneratedCount = 0;
    let contactsFoundCount = 0;
    let draftsCreatedCount = 0;
    let emailsSimulatedCount = 0;

    for (const bInput of businesses) {
      // 2. Persist Business with deduplication
      const { business, isNew } = await this.businessRepo.createOrGet(bInput);
      this.log.info(`Processing business: ${business.name} (New: ${isNew})`);

      // 3. Website Audit
      const auditResult = await this.auditProvider.audit(business.website || '');
      auditedCount++;

      await this.db.websiteAudit.create({
        data: {
          businessId: business.id,
          website: auditResult.website,
          finalUrl: auditResult.finalUrl,
          status: auditResult.status,
          confidence: auditResult.confidence,
          score: auditResult.overallScore,
          technicalScore: auditResult.categories.technical,
          mobileScore: auditResult.categories.mobile,
          performanceScore: auditResult.categories.performance,
          seoScore: auditResult.categories.seo,
          accessibilityScore: auditResult.categories.accessibility,
          uxScore: auditResult.categories.ux,
          contentScore: auditResult.categories.content,
          opportunityFlags: JSON.stringify(auditResult.opportunityFlags),
          mobileAppOpportunity: auditResult.mobileAppOpportunity,
          mobileAppReasoning: JSON.stringify(auditResult.mobileAppReasoning),
          findings: JSON.stringify(auditResult.findings),
          mobileResponsive: auditResult.mobileResponsive,
          sslValid: auditResult.sslValid,
          hasContactForm: auditResult.hasContactForm,
          loadTimeMs: auditResult.loadTimeMs,
          issuesJson: JSON.stringify(auditResult.issues),
          auditedAt: auditResult.auditedAt,
        },
      });

      // 4. Lead Scoring & Qualification
      const scoreResult = this.scoringProvider.calculateScore({
        business,
        audit: auditResult,
        hasWebsite: Boolean(business.website && business.website.length > 0),
        category: business.category,
      });

      const lead = await this.leadRepo.createOrUpdateLead({
        businessId: business.id,
        scoring: scoreResult,
      });
      leadsGeneratedCount++;

      // 5. Contact Discovery (if qualified)
      if (scoreResult.qualificationStatus === 'QUALIFIED') {
        const contacts = await this.contactProvider.findContacts(
          business.name,
          business.website || undefined
        );

        for (const cInput of contacts) {
          await this.contactRepo.addContact(business.id, cInput);
          contactsFoundCount++;
        }

        // 6. Outreach Draft Generation
        const primaryContact = contacts[0];
        const draft = await this.outreachProvider.generateDraft({
          businessName: business.name,
          contactName: primaryContact?.contactName || undefined,
          niche: business.category,
          auditFindings: auditResult.issues,
        });

        const outreach = await this.db.outreach.create({
          data: {
            leadId: lead.id,
            channel: 'EMAIL',
            subject: draft.subject,
            body: draft.body,
            status: 'DRAFT',
          },
        });
        draftsCreatedCount++;

        // 7. Schedule Follow-up
        const { scheduledAt } = await this.followupProvider.scheduleFollowUp(outreach.id, 3);
        await this.db.followUp.create({
          data: {
            outreachId: outreach.id,
            sequenceNumber: 1,
            scheduledAt,
            status: 'PENDING',
          },
        });

        // 8. Simulated Email Dispatch (Adhering to DRY_RUN)
        if (primaryContact?.email) {
          const sendResult = await this.emailProvider.sendEmail({
            to: primaryContact.email,
            subject: draft.subject,
            body: draft.body,
          });

          if (sendResult.status === 'SIMULATED' || sendResult.status === 'SENT') {
            await this.db.outreach.update({
              where: { id: outreach.id },
              data: {
                status: sendResult.status === 'SIMULATED' ? 'DRAFT' : 'SENT',
                sentAt: sendResult.status === 'SENT' ? new Date() : undefined,
              },
            });
            emailsSimulatedCount++;
          }
        }
      }

      // Small throttle between records for safe automation
      await safeSleep(100);
    }

    this.log.info('--- Lead Pipeline Execution Cycle Completed Successfully ---');

    return {
      discovered: businesses.length,
      audited: auditedCount,
      leadsGenerated: leadsGeneratedCount,
      contactsFound: contactsFoundCount,
      draftsCreated: draftsCreatedCount,
      emailsSimulated: emailsSimulatedCount,
    };
  }
}

export const leadPipelineService = new LeadPipelineService();
