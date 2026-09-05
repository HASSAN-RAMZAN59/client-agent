import { prisma } from '../../database/index.js';
import { OutreachRepository } from '../../database/repositories/outreach.repository.js';
import { buildPersonalizationContext } from './personalization-context.builder.js';
import { RuleBasedPersonalizationProvider } from './providers/rule-based-personalization.provider.js';
import { LocalAIPersonalizationProvider } from './providers/local-ai-personalization.provider.js';
import {
  PersonalizationResult,
  PersonalizationProvider,
} from '../../types/index.js';
import { logger } from '../../utils/logger.js';

export class PersonalizationService {
  private log = logger.child('PersonalizationService');
  private outreachRepo = new OutreachRepository();
  private primaryProvider: PersonalizationProvider;

  constructor() {
    if (process.env.LOCAL_AI_ENABLED === 'true') {
      this.primaryProvider = new LocalAIPersonalizationProvider();
    } else {
      this.primaryProvider = new RuleBasedPersonalizationProvider();
    }
  }

  /**
   * Generates and persists personalized outreach draft variants for a single lead.
   */
  public async personalizeLead(leadId: string): Promise<PersonalizationResult> {
    const context = await buildPersonalizationContext(leadId);

    this.log.info(
      `Generating personalized outreach for "${context.business.name}" [${leadId}] via ${this.primaryProvider.name}`
    );

    const result = await this.primaryProvider.generate(context);

    // Hardening evaluators for Phase 6.5
    const { EvidenceValidator } = await import('./hardening/evidence-validator.js');
    const { BusinessIdentityValidator } = await import('./hardening/business-identity.validator.js');
    const { OutreachQualityEvaluator } = await import('./hardening/outreach-quality.evaluator.js');
    const { ContentHasher } = await import('./hardening/content-hasher.js');

    // Persist all 3 variants into SQLite with Phase 6.5 hardening metrics
    for (const variant of result.variants) {
      const contentHash = ContentHasher.hashDraft(variant.subject, variant.body);
      const evidenceValidation = EvidenceValidator.validate(variant.subject, variant.body, context);
      const identityValidation = BusinessIdentityValidator.validate(
        result.primaryContactValue,
        result.primaryContactType,
        context
      );

      const qualityEvaluation = OutreachQualityEvaluator.evaluate({
        subject: variant.subject,
        body: variant.body,
        variant: variant.variant,
        context,
        evidenceValid: evidenceValidation.valid,
        identityValid: identityValidation.valid,
      });

      const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

      await this.outreachRepo.upsertDraft(
        leadId,
        variant,
        {
          value: result.primaryContactValue,
          type: result.primaryContactType,
        },
        {
          contentHash,
          qualityScore: qualityEvaluation.score,
          qualityBand: qualityEvaluation.qualityBand,
          evidenceValid: evidenceValidation.valid,
          identityValid: identityValidation.valid,
          expiresAt,
        }
      );
    }

    this.log.info(
      `Successfully generated 3 outreach draft variants for "${context.business.name}" (Overall Personalization Score: ${result.overallPersonalizationScore}/100)`
    );

    return result;
  }

  /**
   * Generates personalization drafts for a batch of qualified leads.
   */
  public async personalizeBatch(params: {
    limit?: number;
    hotOnly?: boolean;
  } = {}): Promise<PersonalizationResult[]> {
    const { limit = 10, hotOnly = false } = params;

    const whereClause: any = {};
    if (hotOnly) {
      whereClause.classification = 'HOT';
    } else {
      whereClause.classification = { in: ['HOT', 'WARM'] };
      whereClause.status = { in: ['NEW', 'QUALIFIED'] };
    }
    whereClause.primaryContactType = { not: 'NONE' };
    whereClause.contactDiscoveryStatus = { in: ['VERIFIED_PUBLIC', 'PUBLIC_UNVERIFIED'] };

    const leads = await prisma.lead.findMany({
      where: whereClause,
      take: limit,
      orderBy: [{ priorityRank: 'asc' }, { leadOpportunityScore: 'desc' }],
    });

    if (leads.length === 0) {
      this.log.info('No qualified leads found for personalization.');
      return [];
    }

    const results: PersonalizationResult[] = [];
    for (const lead of leads) {
      const res = await this.personalizeLead(lead.id);
      results.push(res);
    }

    return results;
  }
}
