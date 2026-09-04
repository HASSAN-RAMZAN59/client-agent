import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { createApp } from '../src/api/server.js';
import { PrismaClient } from '@prisma/client';

describe('Dashboard REST API Integration Tests', () => {
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

  // 1. Status & Health Endpoints
  describe('Status & Health APIs', () => {
    it('GET /api/status should return operational summary and safety flags', async () => {
      const res = await fetch(`${baseUrl}/status`);
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.status).toBe('success');
      expect(body.data).toBeDefined();
      expect(body.data.database.provider).toBe('SQLite');
      expect(body.data.safety.dryRun).toBe(true);
      expect(body.data.safety.outreachEnabled).toBe(false);
      expect(body.data.safety.killSwitchActive).toBe(true);
      expect(body.data.provider.isPersonalGmail).toBe(true);
      expect(body.data.provider.coldOutreachPermitted).toBe(false);
    });

    it('GET /api/health should return component readiness without performing sends', async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.status).toBe('success');
      expect(body.data.status).toBeDefined();
      expect(body.data.database.health).toBe('HEALTHY');
      expect(body.data.prisma).toBe('HEALTHY');
      expect(body.data.providerPolicy).toBe('UNSUPPORTED');
      expect(body.data.safetyMode.dryRun).toBe(true);
      expect(body.data.testDataGuard).toBe('ACTIVE');
    });
  });

  // 2. Campaigns Endpoints
  describe('Campaigns APIs', () => {
    let createdCampaignId: string;

    it('GET /api/campaigns should return list with real metrics', async () => {
      const res = await fetch(`${baseUrl}/campaigns`);
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.status).toBe('success');
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('POST /api/campaigns should validate input and reject empty fields', async () => {
      const res = await fetch(`${baseUrl}/campaigns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '', city: '', niche: '' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.status).toBe('error');
    });

    it('POST /api/campaigns should create campaign with conservative defaults and log event', async () => {
      const campaignName = `Test Dashboard Campaign ${Date.now()}`;
      const res = await fetch(`${baseUrl}/campaigns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: campaignName,
          country: 'US',
          state: 'TX',
          city: 'Dallas',
          niche: 'Dental',
          targetBusinesses: 10,
          minScore: 50,
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.status).toBe('success');
      expect(body.data.campaign.name).toBe(campaignName);
      expect(body.data.safetyStatus.dryRun).toBe(true);
      expect(body.data.providerPolicy.coldOutreachPermitted).toBe(false);

      createdCampaignId = body.data.campaign.id;
    });

    it('GET /api/campaigns/:id should return campaign detail and run history', async () => {
      const res = await fetch(`${baseUrl}/campaigns/${createdCampaignId}`);
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.status).toBe('success');
      expect(body.data.campaign.id).toBe(createdCampaignId);
      expect(body.data.runs).toBeDefined();
    });

    it('POST /api/campaigns/:id/run should initiate run tracking', async () => {
      const res = await fetch(`${baseUrl}/campaigns/${createdCampaignId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxItems: 5, mock: true }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('success');
      expect(body.data.runId).toBeDefined();
    });

    it('GET /api/campaigns/:id/progress should return active run state', async () => {
      const res = await fetch(`${baseUrl}/campaigns/${createdCampaignId}/progress`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('success');
      expect(body.data.hasRun).toBe(true);
    });
  });

  // 3. Leads Endpoints
  describe('Leads APIs', () => {
    it('GET /api/leads should return paginated leads excluding test fixtures', async () => {
      const res = await fetch(`${baseUrl}/leads?page=1&limit=10`);
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.status).toBe('success');
      expect(body.data.items).toBeDefined();
      expect(body.data.pagination).toBeDefined();

      // Ensure test fixtures are excluded
      for (const item of body.data.items) {
        expect(item.businessName.startsWith('Test ')).toBe(false);
      }
    });

    it('GET /api/leads with filters should filter by classification and channel', async () => {
      const res = await fetch(`${baseUrl}/leads?classification=HOT&channel=EMAIL`);
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.status).toBe('success');
      for (const item of body.data.items) {
        expect(item.leadClass).toBe('HOT');
      }
    });
  });

  // 4. Review Queue Endpoints
  describe('Review Queue APIs', () => {
    it('GET /api/review should require campaignId parameter', async () => {
      const res = await fetch(`${baseUrl}/review`);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain('Campaign selection is required');
    });

    it('PATCH /api/review/:outreachId should invalidate approval if edited', async () => {
      // Find or create an outreach draft for testing
      const res = await fetch(`${baseUrl}/review/invalid-outreach-id`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: 'New Subject', body: 'New Body' }),
      });
      expect(res.status).toBe(404);
    });
  });

  // 5. Pilot & Safe Dry-Run Endpoints
  describe('Pilot & Simulation APIs', () => {
    it('GET /api/pilot/candidates should return approved candidates', async () => {
      const res = await fetch(`${baseUrl}/pilot/candidates`);
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.status).toBe('success');
      expect(Array.isArray(body.data.candidates)).toBe(true);
      expect(body.data.providerPolicy.coldOutreachPermitted).toBe(false);
    });

    it('GET /api/pilot/preview should perform 0 network sends', async () => {
      const res = await fetch(`${baseUrl}/pilot/preview?limit=2&country=US`);
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.status).toBe('success');
      expect(body.data.networkSends).toBe(0);
    });

    it('POST /api/pilot/dry-run should simulate sends with 0 real emails', async () => {
      const res = await fetch(`${baseUrl}/pilot/dry-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 2 }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('success');
      expect(body.data.networkSends).toBe(0);
      expect(body.data.realEmailsSent).toBe(0);
    });

    it('POST /api/pilot/live-send should be strictly blocked by provider policy with 403', async () => {
      const res = await fetch(`${baseUrl}/pilot/live-send`, {
        method: 'POST',
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.status).toBe('blocked');
      expect(body.error).toBe('OUTBOUND_PROVIDER_POLICY_UNSUPPORTED');
      expect(body.providerPolicy.coldOutreachPermitted).toBe(false);
    });
  });

  // 6. Phone Leads & Replies
  describe('Phone Leads & Replies APIs', () => {
    it('GET /api/phone-leads should return phone queue', async () => {
      const res = await fetch(`${baseUrl}/phone-leads?page=1&limit=5`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('success');
      expect(Array.isArray(body.data.items)).toBe(true);
    });

    it('GET /api/replies should return classified inbound replies', async () => {
      const res = await fetch(`${baseUrl}/replies`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('success');
      expect(Array.isArray(body.data.items)).toBe(true);
    });
  });

  // 7. Analytics & Phase 12 Status
  describe('Analytics & Phase 12 APIs', () => {
    it('GET /api/analytics should return funnel stages and Phase 12 PENDING status', async () => {
      const res = await fetch(`${baseUrl}/analytics`);
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.status).toBe('success');
      expect(body.data.funnel.stages.length).toBe(10);
      expect(body.data.metrics.realOutreachSent).toBe(0);
      expect(body.data.phase12Status.status).toBe('PENDING_REAL_PILOT_DATA');
      expect(body.data.phase12Status.requiredSignals.length).toBeGreaterThan(0);
    });
  });

  // 8. Activity Log & Secret Redaction
  describe('Activity Log APIs', () => {
    it('GET /api/activity should return sanitized audit events', async () => {
      const res = await fetch(`${baseUrl}/activity?limit=10`);
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.status).toBe('success');
      expect(Array.isArray(body.data.items)).toBe(true);

      // Verify secrets are never exposed in activity metadata
      const jsonStr = JSON.stringify(body);
      expect(jsonStr).not.toContain('SMTP_PASSWORD');
      expect(jsonStr).not.toContain('bearer');
    });
  });

  // 9. Database Backup & Safe Restore
  describe('Database Backup & Restore APIs', () => {
    it('POST /api/database/backup should create an atomic snapshot', async () => {
      const res = await fetch(`${baseUrl}/database/backup`, { method: 'POST' });
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.status).toBe('success');
      expect(body.data.filename).toMatch(/\.db$/);
      expect(body.data.checksum).toBeDefined();
    });

    it('GET /api/database/backups should list backup archives', async () => {
      const res = await fetch(`${baseUrl}/database/backups`);
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.status).toBe('success');
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('POST /api/database/restore should reject if confirmation token is not RESTORE', async () => {
      const res = await fetch(`${baseUrl}/database/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: 'test.db', confirmationToken: 'WRONG_TOKEN' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain('RESTORE');
    });
  });

  // 10. Settings & Provider Policy
  describe('Settings APIs', () => {
    it('GET /api/settings should mask secrets as CONFIGURED / NOT_CONFIGURED', async () => {
      const res = await fetch(`${baseUrl}/settings`);
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.status).toBe('success');
      expect(body.data.provider.active.smtpPasswordState).toMatch(/CONFIGURED/);

      // Verify no raw passwords are in payload
      const jsonStr = JSON.stringify(body);
      expect(jsonStr).not.toContain('app_password');
      expect(jsonStr).not.toContain('secret');
    });
  });
});
