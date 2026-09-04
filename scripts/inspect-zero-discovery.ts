import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';

async function main() {
  const db = getPrismaClient();

  console.log('=== RECENT CAMPAIGN RUNS (LAST 10) ===');
  const runs = await db.campaignRun.findMany({
    orderBy: { startedAt: 'desc' },
    take: 10,
    include: { campaign: true }
  });

  for (const r of runs) {
    console.log('----------------------------------------------------');
    console.log(`Run ID: ${r.id}`);
    console.log(`Status: ${r.status}`);
    console.log(`Campaign ID: ${r.campaignId}`);
    console.log(`Campaign Name: "${r.campaign?.name}"`);
    console.log(`Location: ${r.campaign?.city}, ${r.campaign?.state}, ${r.campaign?.country}`);
    console.log(`Niche: "${r.campaign?.niche}"`);
    console.log(`Target: ${r.target}, Discovered: ${r.discovered}, Normalized: ${r.normalized}`);
    console.log(`Audited: ${r.audited}, Drafts: ${r.draftsGenerated}, Review: ${r.reviewRequired}`);
    console.log(`StartedAt: ${r.startedAt.toISOString()}`);
    console.log(`CompletedAt: ${r.completedAt ? r.completedAt.toISOString() : 'NONE'}`);
    console.log(`ErrorMessage: ${r.errorMessage}`);
  }

  console.log('\n=== RECENT ACTIVITY LOGS (LAST 25) ===');
  const logs = await db.activityLog.findMany({
    orderBy: { timestamp: 'desc' },
    take: 25,
  });

  for (const l of logs) {
    console.log(`[${l.timestamp.toISOString()}] ${l.eventType} (${l.entityType}: ${l.entityId}) -> ${l.metadata}`);
  }

  await disconnectDatabase();
}

main().catch(console.error);
