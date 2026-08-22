import { describe, it, expect, afterAll } from 'vitest';
import { RuleBasedLeadScoringProvider } from '../src/modules/scoring/rule-based-scoring.provider.js';
import { LeadRepository } from '../src/database/repositories/lead.repository.js';
import { BusinessRepository } from '../src/database/repositories/business.repository.js';
import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';

describe('Lead Scoring & Opportunity Qualification', () => {
  const scorer = new RuleBasedLeadScoringProvider();
  const prisma = getPrismaClient();
  const leadRepo = new LeadRepository(prisma);
  const businessRepo = new BusinessRepository(prisma);

  const testId = Date.now();

  afterAll(async () => {
    await prisma.business.deleteMany({
      where: { name: { contains: `Scoring Test ${testId}` } },
    });
    await disconnectDatabase();
  });

  it('should give high opportunity score to businesses without websites', () => {
    const score = scorer.calculateScore({
      hasWebsite: false,
      category: 'Dentist',
    });

    expect(score.websiteOpportunityScore).toBeGreaterThanOrEqual(90);
    expect(score.qualificationStatus).toBe('QUALIFIED');
    expect(score.priority).toBe('URGENT');
  });

  it('should calculate lower opportunity score for fast, responsive modern websites', () => {
    const score = scorer.calculateScore({
      hasWebsite: true,
      category: 'Consulting',
      audit: {
        website: 'https://modern-example.com',
        status: 'COMPLETED',
        score: 95.0,
        mobileResponsive: true,
        sslValid: true,
        issues: [],
      },
    });

    expect(score.websiteOpportunityScore).toBeLessThanOrEqual(20);
    expect(score.overallScore).toBeLessThan(40);
  });

  it('should persist lead assessment into SQLite database', async () => {
    const { business } = await businessRepo.createOrGet({
      name: `Scoring Test Business ${testId}`,
      category: 'Plumber',
      city: 'Austin',
      source: 'test',
    });

    const scoreResult = scorer.calculateScore({
      hasWebsite: false,
      category: business.category,
    });

    const lead = await leadRepo.createOrUpdateLead({
      businessId: business.id,
      scoring: scoreResult,
    });

    expect(lead.id).toBeDefined();
    expect(lead.businessId).toBe(business.id);
    expect(lead.overallScore).toBe(scoreResult.overallScore);
    expect(lead.status).toBe('QUALIFIED');
  });
});
