import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';
import { LeadScoringService } from '../src/modules/scoring/lead-scoring.service.js';
import { PersonalizationService } from '../src/modules/personalization/personalization.service.js';
import { isValidEmailCandidate } from '../src/modules/contact-discovery/extractors/email-extractor.js';

const TARGET_CAMPAIGN_ID = '79eae995-f714-4137-b284-85d18de1f929';

async function main() {
  const db = getPrismaClient();
  const scoringService = new LeadScoringService();
  const personalizationService = new PersonalizationService();

  console.log('Finalizing pilot campaign leads and drafts...');

  // 1. Invalidate any placeholder email contacts in DB (e.g. your@email.com)
  const contacts = await db.contact.findMany({
    where: { type: 'EMAIL' },
  });

  for (const c of contacts) {
    if (!isValidEmailCandidate(c.value)) {
      await db.contact.update({
        where: { id: c.id },
        data: { status: 'INVALID', isVerified: false },
      });
      console.log(`Marked invalid placeholder contact: ${c.value}`);
    }
  }

  // 2. Process all campaign businesses to ensure Lead and Outreach exist
  const campaign = await db.campaign.findUnique({
    where: { id: TARGET_CAMPAIGN_ID },
    include: {
      businesses: {
        include: {
          contacts: true,
          audits: { orderBy: { createdAt: 'desc' }, take: 1 },
          lead: { include: { outreach: true } },
        },
      },
    },
  });

  if (!campaign) return;

  for (const b of campaign.businesses) {
    // Determine primary contact
    const validEmail = b.contacts.find(
      (c) => c.type === 'EMAIL' && c.status === 'VERIFIED_PUBLIC' && isValidEmailCandidate(c.value)
    );
    const validPhone = b.contacts.find((c) => c.type === 'PHONE' && c.status === 'VERIFIED_PUBLIC');

    const primaryType = validEmail ? 'EMAIL' : validPhone ? 'PHONE' : 'NONE';
    const primaryValue = validEmail ? validEmail.value : validPhone ? validPhone.value : null;

    let lead = b.lead;
    if (!lead) {
      const scoreRes = await scoringService.scoreBusinessById(b.id);
      lead = await db.lead.findUnique({
        where: { businessId: b.id },
        include: { outreach: true },
      }) as any;
    }

    // Update lead primary contact
    await db.lead.update({
      where: { id: lead!.id },
      data: {
        primaryContactType: primaryType,
        primaryContactValue: primaryValue,
        contactDiscoveryStatus: validEmail ? 'VERIFIED_PUBLIC' : validPhone ? 'VERIFIED_PUBLIC' : 'NONE_FOUND',
      },
    });

    // If lead has valid email, generate / align outreach draft
    if (primaryType === 'EMAIL') {
      const existingOutreaches = await db.outreach.findMany({
        where: { leadId: lead!.id, channel: 'EMAIL' },
      });

      if (existingOutreaches.length === 0) {
        await personalizationService.personalizeLead(lead!.id);
      } else {
        // Ensure primaryContactValue on outreach matches the valid email
        await db.outreach.updateMany({
          where: { leadId: lead!.id, channel: 'EMAIL' },
          data: {
            primaryContactValue: primaryValue,
            status: 'REVIEW_REQUIRED',
            approvalStatus: 'PENDING',
          },
        });
      }
    }
  }

  console.log('Pilot candidate finalization complete.');
  await disconnectDatabase();
}

main().catch(console.error);
