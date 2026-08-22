import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PreSendValidator } from '../src/modules/outreach/gate/pre-send-validator.js';
import { InteractiveReviewerService } from '../src/modules/outreach/review/interactive-reviewer.service.js';
import { PilotExecutionService } from '../src/modules/outreach/execution/pilot-execution.service.js';
import { QueueService } from '../src/modules/campaigns/queue.service.js';

describe('Test Data Isolation & Pre-Send Protection Gate', () => {
  let db: PrismaClient;
  let validator: PreSendValidator;
  let reviewer: InteractiveReviewerService;
  let pilotExecution: PilotExecutionService;
  let queueService: QueueService;

  beforeEach(async () => {
    db = new PrismaClient({
      datasources: {
        db: {
          url: 'file:./test.db',
        },
      },
    });
    validator = new PreSendValidator(db);
    reviewer = new InteractiveReviewerService(db);
    pilotExecution = new PilotExecutionService(db, validator);
    queueService = new QueueService(db);
  });

  afterEach(async () => {
    await db.$disconnect();
  });

  it('1. automated tests use isolated test.db database', () => {
    expect(process.env.DATABASE_URL).toBe('file:./test.db');
  });

  it('2. test fixture cannot appear in default review-interactive queue', async () => {
    const testBiz = await db.business.create({
      data: {
        name: `Test Biz ${Date.now()}`,
        category: 'Dentist',
        city: 'Dallas',
        country: 'US',
        source: 'test_automated',
      },
    });

    const testLead = await db.lead.create({
      data: {
        businessId: testBiz.id,
        leadOpportunityScore: 80,
        classification: 'HOT',
      },
    });

    await db.outreach.create({
      data: {
        leadId: testLead.id,
        channel: 'EMAIL',
        variant: 'VARIANT_A_SHORT',
        subject: 'Test Subject',
        body: 'Test Body',
        status: 'REVIEW_REQUIRED',
      },
    });

    const defaultItems = await reviewer.getPendingItems();
    const foundInDefault = defaultItems.some((i) => i.businessName === testBiz.name);
    expect(foundInDefault).toBe(false);

    const withTestItems = await reviewer.getPendingItems({ includeTest: true });
    const foundInTest = withTestItems.some((i) => i.businessName === testBiz.name);
    expect(foundInTest).toBe(true);
  });

  it('3. test fixture cannot appear in pilot-preview', async () => {
    const preview = await pilotExecution.previewPilot(10);
    for (const c of preview.candidates) {
      expect(c.businessName.toLowerCase()).not.toContain('test biz');
      expect(c.businessName.toLowerCase()).not.toContain('phase11 valid dental');
      expect(c.recipientEmail).not.toContain('test-');
    }
  });

  it('4. test fixture is immediately BLOCKED with TEST_DATA_PROHIBITED', async () => {
    const testBiz = await db.business.create({
      data: {
        name: `Personalize Test Biz ${Date.now()}`,
        category: 'Dental',
        city: 'Dallas',
        country: 'US',
        source: 'test_suite',
      },
    });

    const testContact = await db.contact.create({
      data: {
        businessId: testBiz.id,
        value: 'owner@testdentalcontacts.com',
        type: 'EMAIL',
        status: 'VERIFIED_PUBLIC',
      },
    });

    const testLead = await db.lead.create({
      data: {
        businessId: testBiz.id,
        leadOpportunityScore: 90,
        classification: 'HOT',
        primaryContactValue: testContact.value,
        primaryContactType: 'EMAIL',
      },
    });

    const testOutreach = await db.outreach.create({
      data: {
        leadId: testLead.id,
        channel: 'EMAIL',
        variant: 'VARIANT_B_STANDARD',
        subject: 'Website observation for Personalize Test Biz',
        body: 'Hello Team,\n\nI was looking at the website...\n\nBest regards,\n\nHASSAN RAMZAN',
        primaryContactValue: testContact.value,
        primaryContactType: 'EMAIL',
        status: 'READY_TO_SEND',
        approvalStatus: 'APPROVED',
        approvedAt: new Date(),
        approvedBy: 'HUMAN_OPERATOR',
      },
    });

    const result = await validator.isLivePilotEligible(testOutreach.id);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('TEST_DATA_PROHIBITED');
  });

  it('5. manually approved test fixture cannot pass pre-send gate', async () => {
    const check = validator.checkIfTestRecord({
      business: { name: 'Gate Biz 123456', source: 'test_generator' },
      contactValue: 'owner@example.com',
      channel: 'EMAIL',
    });
    expect(check).toBe(true);
  });

  it('6. review queue filters out test records by default', async () => {
    const defaultQueue = await queueService.getReviewQueue(20);
    for (const item of defaultQueue) {
      expect(item.businessName.toLowerCase()).not.toContain('test biz');
      expect(item.businessName.toLowerCase()).not.toContain('gate biz');
      expect(item.businessName.toLowerCase()).not.toContain('expired biz');
    }
  });

  it('7. real operational records pass test origin check', () => {
    const check = validator.checkIfTestRecord({
      business: { name: 'Soho Dental', source: 'osm_overpass' },
      contactValue: 'info@sohodental.ca',
      channel: 'EMAIL',
    });
    expect(check).toBe(false);
  });
});
