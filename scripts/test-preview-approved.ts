import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';
import { PilotExecutionService } from '../src/modules/outreach/execution/pilot-execution.service.js';

async function main() {
  const db = getPrismaClient();
  const pilotService = new PilotExecutionService(db);
  const preview = await pilotService.previewPilot(2, '79eae995-f714-4137-b284-85d18de1f929', {
    pilotCountry: 'US',
    dryRun: true,
  });

  console.log('Candidates count:', preview.candidates.length);
  for (const c of preview.candidates) {
    console.log({
      id: c.outreachId,
      biz: c.businessName,
      email: c.recipientEmail,
      quality: c.candidateQuality,
      sendState: c.liveSendState,
      approval: c.approvalStatus,
      eligible: c.eligible,
      blockingReason: c.blockingReason,
    });
  }
  console.log('eligibleCount:', preview.eligibleCount, 'blockedCount:', preview.blockedCount);

  await disconnectDatabase();
}

main().catch(console.error);
