import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';
import { BusinessRepository } from '../src/database/repositories/business.repository.js';
import { ContactRepository } from '../src/database/repositories/contact.repository.js';

describe('Business & Contact Deduplication', () => {
  const prisma = getPrismaClient();
  const businessRepo = new BusinessRepository(prisma);
  const contactRepo = new ContactRepository(prisma);

  const uniqueSuffix = Date.now();
  const testBusinessName = `Test Clinic ${uniqueSuffix}`;

  afterAll(async () => {
    // Cleanup test records
    await prisma.business.deleteMany({
      where: { name: { contains: `Test Clinic ${uniqueSuffix}` } },
    });
    await disconnectDatabase();
  });

  it('should create a new business on first registration', async () => {
    const { business, isNew } = await businessRepo.createOrGet({
      name: testBusinessName,
      category: 'Medical',
      city: 'Austin',
      website: `https://testclinic${uniqueSuffix}.com`,
      source: 'test_suite',
    });

    expect(isNew).toBe(true);
    expect(business.id).toBeDefined();
    expect(business.name).toBe(testBusinessName);
  });

  it('should detect duplicate business and return existing entity without creating duplicates', async () => {
    const { business, isNew } = await businessRepo.createOrGet({
      name: testBusinessName,
      category: 'Medical',
      city: 'Austin',
      website: `https://testclinic${uniqueSuffix}.com`,
      source: 'test_suite_second_attempt',
    });

    expect(isNew).toBe(false);
    expect(business.name).toBe(testBusinessName);
  });

  it('should prevent duplicate contacts for the same business', async () => {
    const { business } = await businessRepo.createOrGet({
      name: testBusinessName,
      category: 'Medical',
      city: 'Austin',
      source: 'test_suite',
    });

    const contact1 = await contactRepo.addContact(business.id, {
      email: `owner@testclinic${uniqueSuffix}.com`,
      contactName: 'Dr. Test',
      source: 'test_suite',
    });
    expect(contact1.isNew).toBe(true);

    const contact2 = await contactRepo.addContact(business.id, {
      email: `owner@testclinic${uniqueSuffix}.com`, // Same email
      contactName: 'Dr. Test Duplicate',
      source: 'test_suite_repeat',
    });
    expect(contact2.isNew).toBe(false);
    expect(contact2.contact.id).toBe(contact1.contact.id);
  });
});
