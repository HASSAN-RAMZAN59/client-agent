import { LeadScoringService } from '../src/modules/scoring/lead-scoring.service.js';
import { PersonalizationService } from '../src/modules/personalization/personalization.service.js';
import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';

async function scoreAndPersDds() {
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

  // Ensure normalized name
  await db.business.update({
    where: { id: b.id },
    data: { name: 'Dallas Dental Specialists' }
  });

  const scoringService = new LeadScoringService();
  const leadResult = await scoringService.scoreBusinessById(b.id);
  console.log('Lead score completed:', leadResult.leadOpportunityScore, leadResult.classification);
  console.log('Top Problems:', leadResult.topProblems);
  console.log('Sales angle:', leadResult.salesAngle);

  // Re-fetch lead
  const updatedLead = await db.lead.findUnique({
    where: { businessId: b.id }
  });
  console.log('Updated Lead in DB ID:', updatedLead?.id);

  const personalizationService = new PersonalizationService();
  const persResult = await personalizationService.personalizeLead(updatedLead!.id);
  console.log('Personalization completed. Variants count:', persResult.variants.length);
  for (const v of persResult.variants) {
    console.log('\n--- Variant:', v.variant, '---');
    console.log('Subject:', v.subject);
    console.log('Body:\n' + v.body);
  }

  await disconnectDatabase();
}
scoreAndPersDds();
