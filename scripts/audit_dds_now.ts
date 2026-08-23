import { ComprehensiveWebsiteAuditService } from '../src/modules/auditing/comprehensive-website-audit.service.js';
import { LeadScoringService } from '../src/modules/scoring/lead-scoring.service.js';
import { PersonalizationService } from '../src/modules/personalization/personalization.service.js';
import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';

async function auditAndScoreDds() {
  const db = getPrismaClient();
  const cId = '79eae995-f714-4137-b284-85d18de1f929';
  const b = await db.business.findFirst({
    where: {
      campaignId: cId,
      website: { contains: 'dallasdentalspecialists' }
    }
  });

  if (!b) {
    console.log('Business not found');
    await disconnectDatabase();
    return;
  }

  console.log('Auditing business:', b.name, b.website);
  const auditService = new ComprehensiveWebsiteAuditService();
  const auditResult = await auditService.auditBusinessById(b.id, { force: true });
  console.log('Audit completed. Score:', auditResult.overallScore);
  console.log('LoadTime:', auditResult.loadTimeMs);
  console.log('Top problems:', auditResult.topProblems);

  const scoringService = new LeadScoringService();
  const leadResult = await scoringService.scoreBusiness(b.id);
  console.log('Lead score completed:', leadResult.leadOpportunityScore, leadResult.classification);
  console.log('Sales angle:', leadResult.salesAngle);

  const personalizationService = new PersonalizationService();
  const persResult = await personalizationService.personalizeLead(leadResult.id);
  console.log('Personalization completed. Variants count:', persResult.variants.length);
  for (const v of persResult.variants) {
    console.log('Variant:', v.variant, 'Subject:', v.subject);
    console.log('Body:\n' + v.body);
  }

  await disconnectDatabase();
}
auditAndScoreDds();
