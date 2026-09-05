import { PrismaClient, Business } from '@prisma/client';
import { getPrismaClient } from '../client.js';
import { DiscoveredBusinessInput } from '../../types/index.js';
import { extractCanonicalDomain, normalizeBusinessName, normalizeUrl } from '../../modules/discovery/normalizer.js';
import { WebsiteReachabilityResult } from '../../modules/discovery/website-verifier.js';
import { classifyWebsite } from '../../modules/discovery/website-classifier.js';
import { logger } from '../../utils/logger.js';

export interface UpsertBusinessResult {
  business: Business;
  isNew: boolean;
  wasUpdated: boolean;
}

export class BusinessRepository {
  private db: PrismaClient;
  private log = logger.child('BusinessRepository');

  constructor(client: PrismaClient = getPrismaClient()) {
    this.db = client;
  }

  /**
   * Finds a business by its unique compound index, matching website, or canonical domain.
   */
  public async findDuplicate(input: DiscoveredBusinessInput): Promise<Business | null> {
    const cleanName = normalizeBusinessName(input.name);

    // 1. Check unique combination of name + city + category
    const existingByCompound = await this.db.business.findUnique({
      where: {
        unique_business_per_locality: {
          name: cleanName,
          city: input.city.trim(),
          category: input.category.trim(),
        },
      },
    });

    if (existingByCompound) return existingByCompound;

    // 2. Check exact matching website
    const normalizedInputUrl = normalizeUrl(input.website);
    if (normalizedInputUrl) {
      const existingByWebsite = await this.db.business.findFirst({
        where: {
          website: normalizedInputUrl,
        },
      });
      if (existingByWebsite) return existingByWebsite;

      // 3. Check by canonical domain (e.g. ignore www. vs non-www)
      const canonicalDomain = extractCanonicalDomain(normalizedInputUrl);
      if (canonicalDomain) {
        const potentialMatches = await this.db.business.findMany({
          where: {
            website: { contains: canonicalDomain },
          },
        });
        for (const candidate of potentialMatches) {
          if (candidate.website && extractCanonicalDomain(candidate.website) === canonicalDomain) {
            return candidate;
          }
        }
      }
    }

    return null;
  }

  /**
   * Creates or updates a business record with deduplication safety.
   */
  public async createOrGet(
    input: DiscoveredBusinessInput,
    reachability?: WebsiteReachabilityResult
  ): Promise<{ business: Business; isNew: boolean }> {
    const result = await this.upsertDiscoveredBusiness(input, reachability);
    return { business: result.business, isNew: result.isNew };
  }

  /**
   * Upserts discovered business, merging missing fields into existing records.
   */
  public async upsertDiscoveredBusiness(
    input: DiscoveredBusinessInput,
    reachability?: WebsiteReachabilityResult
  ): Promise<UpsertBusinessResult> {
    const cleanName = normalizeBusinessName(input.name);
    let normalizedWebsite = normalizeUrl(input.website);

    // Verify official website status: Directory/aggregator URLs cannot become business.website
    if (normalizedWebsite) {
      const siteClass = classifyWebsite(normalizedWebsite, cleanName, input.city);
      if (siteClass.type !== 'OFFICIAL_BUSINESS_SITE') {
        this.log.info(
          `Prevented ${siteClass.type} URL from being set as official website for "${cleanName}": ${normalizedWebsite}`
        );
        normalizedWebsite = undefined;
      }
    }

    const existing = await this.findDuplicate({ ...input, name: cleanName, website: normalizedWebsite });

    if (existing) {
      // Check if we can enrich existing record with newly found fields
      const updates: {
        website?: string;
        phone?: string;
        address?: string;
        sourceUrl?: string;
      } = {};

      if (!existing.website && normalizedWebsite) updates.website = normalizedWebsite;
      if (!existing.phone && input.phone) updates.phone = input.phone.trim();
      if (!existing.address && input.address) updates.address = input.address.trim();
      if (!existing.sourceUrl && input.sourceUrl) updates.sourceUrl = input.sourceUrl;

      let updatedBusiness = existing;
      let wasUpdated = false;

      if (Object.keys(updates).length > 0) {
        updatedBusiness = await this.db.business.update({
          where: { id: existing.id },
          data: updates,
        });
        wasUpdated = true;
        this.log.debug(`Enriched existing business "${existing.name}" [${existing.id}] with new data.`);
      } else {
        this.log.debug(`Duplicate business detected: "${cleanName}" (${input.city}). Record kept intact.`);
      }

      // Record / update website reachability status in audit table
      await this.recordWebsiteStatus(existing.id, normalizedWebsite, reachability);

      return { business: updatedBusiness, isNew: false, wasUpdated };
    }

    const created = await this.db.business.create({
      data: {
        name: cleanName,
        category: input.category.trim(),
        city: input.city.trim(),
        country: input.country || 'USA',
        address: input.address?.trim(),
        phone: input.phone?.trim(),
        website: normalizedWebsite,
        source: input.source,
        sourceUrl: input.sourceUrl,
      },
    });

    this.log.info(`New business registered: "${created.name}" [${created.id}] (Website: ${created.website || 'None'})`);

    // Record initial website status
    await this.recordWebsiteStatus(created.id, normalizedWebsite, reachability);

    return { business: created, isNew: true, wasUpdated: false };
  }

  private async recordWebsiteStatus(
    businessId: string,
    website?: string,
    reachability?: WebsiteReachabilityResult
  ): Promise<void> {
    const existingAudit = await this.db.websiteAudit.findFirst({
      where: { businessId },
    });

    const status = reachability?.status || (website ? 'PENDING' : 'NO_WEBSITE');
    const websiteStr = reachability?.finalUrl || website || '';

    if (existingAudit) {
      await this.db.websiteAudit.update({
        where: { id: existingAudit.id },
        data: {
          website: websiteStr,
          status,
          score: status === 'NO_WEBSITE' || status === 'NO_WEBSITE_FOUND' ? 0.0 : existingAudit.score,
        },
      });
    } else {
      await this.db.websiteAudit.create({
        data: {
          businessId,
          website: websiteStr,
          status,
          score: status === 'NO_WEBSITE' || status === 'NO_WEBSITE_FOUND' ? 0.0 : 50.0,
        },
      });
    }
  }

  public async getById(id: string): Promise<Business | null> {
    return this.db.business.findUnique({
      where: { id },
      include: {
        audits: true,
        lead: true,
        contacts: true,
      },
    });
  }

  public async listAll(limit: number = 50): Promise<Business[]> {
    return this.db.business.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        audits: true,
        lead: true,
        contacts: true,
      },
    });
  }

  public async count(): Promise<number> {
    return this.db.business.count();
  }
}
