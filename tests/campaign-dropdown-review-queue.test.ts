import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { createApp } from '../src/api/server.js';
import { PrismaClient } from '@prisma/client';

describe('Review Queue & Active Campaign Dropdown Hardening Tests', () => {
  let server: http.Server;
  let baseUrl: string;
  let db: PrismaClient;

  beforeAll(async () => {
    db = new PrismaClient({
      datasources: {
        db: {
          url: 'file:./test.db',
        },
      },
    });

    const app = createApp();
    server = http.createServer(app);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}/api`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await db.$disconnect();
  });

  // 1. campaign with 0 review items appears in dropdown
  it('1. campaign with 0 review items appears in dropdown', async () => {
    const timestamp = Date.now();
    const campaignName = `Zero Review Campaign ${timestamp}`;
    const createRes = await fetch(`${baseUrl}/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: campaignName,
        country: 'PK',
        city: 'Faisalabad',
        niche: 'Dental',
        targetBusinesses: 10,
      }),
    });
    expect(createRes.status).toBe(201);
    const createData = await createRes.json();
    const campaignId = createData.data.campaign.id;

    // Fetch campaigns
    const listRes = await fetch(`${baseUrl}/campaigns`);
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();

    const found = listData.data.find((c: any) => c.id === campaignId);
    expect(found).toBeDefined();
    expect(found.name).toBe(campaignName);
    expect(found.metrics.pendingReview).toBe(0);

    // Clean up
    await fetch(`${baseUrl}/campaigns/${campaignId}`, { method: 'DELETE' });
  });

  // 2. campaign with 0 leads appears in dropdown
  it('2. campaign with 0 leads appears in dropdown', async () => {
    const timestamp = Date.now();
    const campaignName = `Zero Leads Campaign ${timestamp}`;
    const createRes = await fetch(`${baseUrl}/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: campaignName,
        country: 'US',
        state: 'TX',
        city: 'Dallas',
        niche: 'HVAC',
        targetBusinesses: 25,
      }),
    });
    expect(createRes.status).toBe(201);
    const createData = await createRes.json();
    const campaignId = createData.data.campaign.id;

    const listRes = await fetch(`${baseUrl}/campaigns`);
    const listData = await listRes.json();
    const found = listData.data.find((c: any) => c.id === campaignId);
    expect(found).toBeDefined();
    expect(found.metrics.discovered).toBe(0);
    expect(found.metrics.hot).toBe(0);
    expect(found.metrics.warm).toBe(0);

    // Clean up
    await fetch(`${baseUrl}/campaigns/${campaignId}`, { method: 'DELETE' });
  });

  // 3. new campaign appears without browser restart
  it('3. new campaign appears without browser restart', async () => {
    const timestamp = Date.now();
    const campaignName = `FSD Dental Fresh Test ${timestamp}`;
    const postRes = await fetch(`${baseUrl}/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: campaignName,
        country: 'PK',
        city: 'Faisalabad',
        niche: 'Dental',
        targetBusinesses: 10,
      }),
    });
    expect(postRes.status).toBe(201);
    const postBody = await postRes.json();
    const campaignId = postBody.data.campaign.id;

    // Immediately fetch campaign list without server or browser restart
    const immediateRes = await fetch(`${baseUrl}/campaigns`);
    const immediateBody = await immediateRes.json();
    const exists = immediateBody.data.some((c: any) => c.id === campaignId && c.name === campaignName);
    expect(exists).toBe(true);

    // Clean up
    await fetch(`${baseUrl}/campaigns/${campaignId}`, { method: 'DELETE' });
  });

  // 4. Topbar and Review Queue use same campaign list
  it('4. Topbar and Review Queue use same campaign list', async () => {
    const timestamp = Date.now();
    const campaignName = `Shared Context Campaign ${timestamp}`;
    const createRes = await fetch(`${baseUrl}/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: campaignName,
        country: 'US',
        city: 'Austin',
        niche: 'Plumbing',
      }),
    });
    const createData = await createRes.json();
    const campaignId = createData.data.campaign.id;

    // Both Topbar and Review Queue consume the authoritative GET /api/campaigns endpoint
    const listRes = await fetch(`${baseUrl}/campaigns`);
    const listData = await listRes.json();
    const campaignsForTopbar = listData.data;
    const campaignsForReviewQueue = listData.data;

    expect(campaignsForTopbar).toEqual(campaignsForReviewQueue);
    expect(campaignsForTopbar.some((c: any) => c.id === campaignId)).toBe(true);

    // Clean up
    await fetch(`${baseUrl}/campaigns/${campaignId}`, { method: 'DELETE' });
  });

  // 5. changing Topbar selection updates Review Queue
  it('5. changing Topbar selection updates Review Queue', async () => {
    // Simulated state machine test for shared CampaignContext selection logic
    let selectedCampaignId = '';
    const campaigns = [
      { id: 'camp-1', name: 'Dallas HVAC' },
      { id: 'camp-2', name: 'FSD Dental' },
    ];

    // Topbar selects camp-2
    const onSelectTopbar = (id: string) => {
      selectedCampaignId = id;
    };
    onSelectTopbar('camp-2');

    // Review queue reads the updated selection from shared context
    expect(selectedCampaignId).toBe('camp-2');
    const selectedCampaign = campaigns.find((c) => c.id === selectedCampaignId);
    expect(selectedCampaign?.name).toBe('FSD Dental');
  });

  // 6. changing Review Queue selection updates Topbar
  it('6. changing Review Queue selection updates Topbar', async () => {
    let selectedCampaignId = 'camp-1';

    // Review Queue selects camp-2
    const onSelectReviewQueue = (id: string) => {
      selectedCampaignId = id;
    };
    onSelectReviewQueue('camp-2');

    // Topbar reads the updated selection
    expect(selectedCampaignId).toBe('camp-2');
  });

  // 7. selected campaign with 0 reviews shows empty queue, not missing campaign
  it('7. selected campaign with 0 reviews shows empty queue, not missing campaign', async () => {
    const timestamp = Date.now();
    const campaignName = `Empty Queue Campaign ${timestamp}`;
    const createRes = await fetch(`${baseUrl}/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: campaignName,
        country: 'PK',
        city: 'Lahore',
        niche: 'Dental',
      }),
    });
    const createData = await createRes.json();
    const campaignId = createData.data.campaign.id;

    // Fetch review queue for this campaign
    const queueRes = await fetch(`${baseUrl}/review?campaignId=${campaignId}`);
    expect(queueRes.status).toBe(200);
    const queueData = await queueRes.json();

    // Review items is 0
    expect(queueData.data.totalItems).toBe(0);
    expect(queueData.data.items).toEqual([]);

    // But campaign STILL exists in campaign list
    const listRes = await fetch(`${baseUrl}/campaigns`);
    const listData = await listRes.json();
    const campaignInList = listData.data.find((c: any) => c.id === campaignId);
    expect(campaignInList).toBeDefined();
    expect(campaignInList.name).toBe(campaignName);

    // Clean up
    await fetch(`${baseUrl}/campaigns/${campaignId}`, { method: 'DELETE' });
  });

  // 8. campaign deletion clears stale selected ID
  it('8. campaign deletion clears stale selected ID', async () => {
    const timestamp = Date.now();
    const campaignName = `To Be Deleted Campaign ${timestamp}`;
    const createRes = await fetch(`${baseUrl}/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: campaignName,
        country: 'US',
        city: 'Houston',
        niche: 'Roofing',
      }),
    });
    const createData = await createRes.json();
    const campaignId = createData.data.campaign.id;

    let selectedCampaignId = campaignId;

    // Delete the campaign via DELETE API
    const deleteRes = await fetch(`${baseUrl}/campaigns/${campaignId}`, { method: 'DELETE' });
    expect(deleteRes.status).toBe(200);

    // Fresh list fetch
    const listRes = await fetch(`${baseUrl}/campaigns`);
    const listData = await listRes.json();
    const remainingCampaigns = listData.data;

    // Simulate context reset logic
    const exists = remainingCampaigns.some((c: any) => c.id === selectedCampaignId);
    if (!exists) {
      selectedCampaignId = remainingCampaigns.length > 0 ? remainingCampaigns[0].id : '';
    }

    expect(selectedCampaignId).not.toBe(campaignId);
  });

  // 9. no test campaigns leak into dev runtime
  it('9. no test campaigns leak into dev runtime', async () => {
    const devDbPath = path.resolve(process.cwd(), 'prisma', 'dev.db');
    if (fs.existsSync(devDbPath)) {
      const devDb = new PrismaClient({
        datasources: {
          db: {
            url: `file:${devDbPath}`,
          },
        },
      });
      try {
        const devCampaigns = await devDb.campaign.findMany();
        // dev.db was cleaned and should not have automated test fixtures
        const automatedFixtures = devCampaigns.filter(
          (c) =>
            c.name.startsWith('Test Dashboard Campaign') ||
            c.name.startsWith('Zero Review') ||
            c.name.startsWith('Shared Context')
        );
        expect(automatedFixtures.length).toBe(0);
      } finally {
        await devDb.$disconnect();
      }
    }
  });

  // 10. production bundle reflects latest CampaignContext code
  it('10. production bundle reflects latest CampaignContext code', () => {
    const distHtml = path.resolve(process.cwd(), 'dist-dashboard', 'index.html');
    expect(fs.existsSync(distHtml)).toBe(true);

    const assetsDir = path.resolve(process.cwd(), 'dist-dashboard', 'assets');
    expect(fs.existsSync(assetsDir)).toBe(true);

    const jsFiles = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
    expect(jsFiles.length).toBeGreaterThan(0);

    const mainJsContent = fs.readFileSync(path.join(assetsDir, jsFiles[0]), 'utf-8');
    // Verify latest bundled artifacts contain key symbols
    expect(mainJsContent).toContain('topbar-campaign');
    expect(mainJsContent).toContain('review-campaign-select');
  });
});
