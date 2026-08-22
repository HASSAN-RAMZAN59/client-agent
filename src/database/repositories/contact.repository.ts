import { PrismaClient, Contact } from '@prisma/client';
import { getPrismaClient } from '../client.js';
import {
  DiscoveredContactRecord,
  DiscoveredContactInput,
  ContactType,
} from '../../types/index.js';
import { logger } from '../../utils/logger.js';

export class ContactRepository {
  private db: PrismaClient;
  private log = logger.child('ContactRepository');

  constructor(client: PrismaClient = getPrismaClient()) {
    this.db = client;
  }

  /**
   * Adds or updates a public contact for a business without duplicates.
   */
  public async addContact(
    businessId: string,
    contact: DiscoveredContactInput
  ): Promise<{ contact: Contact; isNew: boolean }> {
    const type: ContactType = contact.type || (contact.email ? 'EMAIL' : 'PHONE');
    const value = (contact.value || contact.email || contact.normalizedPhone || '').trim().toLowerCase();

    if (!value) {
      throw new Error('Contact value cannot be empty');
    }

    const existing = await this.db.contact.findUnique({
      where: {
        unique_contact_value_per_business: {
          businessId,
          type,
          value,
        },
      },
    });

    if (existing) {
      this.log.debug(`Contact ${value} (${type}) already exists for business ${businessId}`);
      return { contact: existing, isNew: false };
    }

    const created = await this.db.contact.create({
      data: {
        businessId,
        value,
        type,
        email: contact.email ? contact.email.trim().toLowerCase() : (type === 'EMAIL' ? value : null),
        classification: contact.classification || 'BUSINESS_GENERIC',
        contactName: contact.contactName?.trim(),
        role: contact.role?.trim(),
        rawPhone: contact.rawPhone,
        normalizedPhone: contact.normalizedPhone,
        source: contact.source || 'OFFICIAL_WEBSITE',
        sourceUrl: contact.sourceUrl,
        sourceType: contact.sourceType || 'OFFICIAL_WEBSITE',
        confidence: contact.confidence || 'HIGH',
        qualityScore: contact.qualityScore || 0,
        status: contact.status || 'VERIFIED_PUBLIC',
        isVerified: contact.isVerified ?? false,
        isPublic: contact.isPublic ?? true,
      },
    });

    this.log.info(`Contact registered: ${created.value} (${created.type}) for business [${businessId}]`);
    return { contact: created, isNew: true };
  }

  /**
   * Persists a discovered contact record with full provenance.
   */
  public async upsertContactRecord(
    businessId: string,
    record: DiscoveredContactRecord
  ): Promise<Contact> {
    const value = record.value.trim().toLowerCase();

    return this.db.contact.upsert({
      where: {
        unique_contact_value_per_business: {
          businessId,
          type: record.type,
          value,
        },
      },
      create: {
        businessId,
        value,
        type: record.type,
        email: record.email ? record.email.trim().toLowerCase() : (record.type === 'EMAIL' ? value : null),
        classification: record.classification,
        contactName: record.contactName,
        role: record.role,
        rawPhone: record.rawPhone,
        normalizedPhone: record.normalizedPhone,
        source: record.source,
        sourceUrl: record.sourceUrl,
        sourceType: record.sourceType,
        confidence: record.confidence,
        qualityScore: record.qualityScore,
        status: record.status,
        discoveredAt: record.discoveredAt,
        lastCheckedAt: new Date(),
      },
      update: {
        classification: record.classification,
        qualityScore: record.qualityScore,
        confidence: record.confidence,
        status: record.status,
        lastCheckedAt: new Date(),
      },
    });
  }

  public async getContactsForBusiness(businessId: string): Promise<Contact[]> {
    return this.db.contact.findMany({
      where: { businessId },
      orderBy: [{ qualityScore: 'desc' }, { createdAt: 'asc' }],
    });
  }
}
