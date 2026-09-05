import { prisma } from '../../database/index.js';
import { ContactRepository } from '../../database/repositories/contact.repository.js';
import { extractEmailsFromHtml } from './extractors/email-extractor.js';
import { extractPhonesFromHtml } from './extractors/phone-extractor.js';
import { detectContactPages } from './extractors/contact-page-detector.js';
import { validateEmail, validatePhone } from './validators/contact-validator.js';
import { calculateContactQualityScore, selectPrimaryContact } from './scoring/contact-quality.scorer.js';
import {
  DiscoveredContactRecord,
  ContactDiscoveryResult,
  ContactDiscoveryStatus,
  ContactSourceType,
} from '../../types/index.js';
import { isExcludedDirectoryDomain } from '../discovery/excluded-domains.js';
import { classifyWebsite } from '../discovery/website-classifier.js';
import { OfficialWebsiteResolver } from '../discovery/official-website-resolver.js';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { safeSleep } from '../../utils/sleeper.js';

export class ContactDiscoveryService {
  private log = logger.child('ContactDiscoveryService');
  private contactRepo = new ContactRepository();
  private websiteResolver = new OfficialWebsiteResolver();

  /**
   * Discovers public contacts for a single business.
   */
  public async discoverForBusiness(
    businessId: string,
    options: { dryRun?: boolean } = {}
  ): Promise<ContactDiscoveryResult> {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      include: {
        audits: { orderBy: { updatedAt: 'desc' }, take: 1 },
      },
    });

    if (!business) {
      throw new Error(`Business with ID ${businessId} not found.`);
    }

    const pagesVisited: string[] = [];
    const discoveredContacts: Map<string, DiscoveredContactRecord> = new Map();
    let overallStatus: ContactDiscoveryStatus = 'NONE_FOUND';

    // A. Check discovery-source native contacts already persisted in DB
    const existingDbContacts = await prisma.contact.findMany({
      where: { businessId },
    });
    for (const ec of existingDbContacts) {
      discoveredContacts.set(ec.value, {
        value: ec.value,
        type: ec.type as any,
        classification: ec.classification as any,
        email: ec.email || undefined,
        contactName: ec.contactName || undefined,
        role: ec.role || undefined,
        rawPhone: ec.rawPhone || undefined,
        normalizedPhone: ec.normalizedPhone || undefined,
        source: ec.source,
        sourceUrl: ec.sourceUrl || undefined,
        sourceType: ec.sourceType as any,
        confidence: ec.confidence as any,
        qualityScore: ec.qualityScore,
        status: ec.status as any,
        discoveredAt: ec.discoveredAt,
      });
      if (ec.status === 'VERIFIED_PUBLIC') {
        overallStatus = 'VERIFIED_PUBLIC';
      }
    }

    // B. If business has existing verified phone from discovery listing, add as baseline
    if (business.phone) {
      const phoneVal = validatePhone(business.phone);
      if (phoneVal.isValid && phoneVal.normalized && !discoveredContacts.has(phoneVal.normalized)) {
        const isOsm = business.source === 'osm_overpass';
        const isListing = business.source === 'directory_hint';
        const classification = isOsm
          ? 'OSM_PUBLIC_PHONE'
          : isListing
          ? 'VERIFIED_BUSINESS_LISTING_PHONE'
          : 'OFFICIAL_SITE_PHONE';
        const sourceType = isOsm ? 'OSM_TAG' : isListing ? 'PUBLIC_LISTING' : 'OFFICIAL_WEBSITE';

        const quality = calculateContactQualityScore({
          type: 'PHONE',
          classification,
          sourceType,
        });

        discoveredContacts.set(phoneVal.normalized, {
          value: phoneVal.normalized,
          type: 'PHONE',
          classification,
          rawPhone: business.phone,
          normalizedPhone: phoneVal.normalized,
          source: business.source || 'PUBLIC_LISTING',
          sourceUrl: business.sourceUrl || undefined,
          sourceType,
          confidence: isOsm ? 'HIGH' : 'MEDIUM',
          qualityScore: quality,
          status: 'VERIFIED_PUBLIC',
          discoveredAt: new Date(),
        });
        overallStatus = 'VERIFIED_PUBLIC';
      }
    }

    // C. If no official website exists: attempt official website resolution
    if (!business.website || business.website.trim().length === 0) {
      try {
        const resolution = await this.websiteResolver.resolveOfficialWebsite({
          name: business.name,
          city: business.city,
          country: business.country || undefined,
        });

        if (
          (resolution.status === 'OFFICIAL_CONFIRMED' || resolution.status === 'OFFICIAL_PROBABLE') &&
          resolution.resolvedUrl
        ) {
          this.log.info(`Resolved official website for "${business.name}": ${resolution.resolvedUrl}`);
          business.website = resolution.resolvedUrl;
          if (!options.dryRun) {
            await prisma.business.update({
              where: { id: business.id },
              data: {
                website: resolution.resolvedUrl,
              },
            });
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.warn(`Official website resolution failed for "${business.name}": ${msg}`);
      }
    }

    // D. Official Website Crawling (Homepage + Max Configured Sub-pages)
    if (business.website && business.website.trim().length > 0) {
      const siteClassification = classifyWebsite(business.website, business.name, business.city);
      if (siteClassification.type !== 'OFFICIAL_BUSINESS_SITE') {
        this.log.info(
          `Skipping contact crawl for ${business.website}: classified as ${siteClassification.type}, not an official business site.`
        );
      } else {
        const targetWebsite = business.website.startsWith('http')
          ? business.website
          : `https://${business.website}`;

        try {
          this.log.info(`Discovering contacts from official website: ${targetWebsite}`);
          const homeRes = await this.fetchHtmlSafe(targetWebsite);
          pagesVisited.push(targetWebsite);

          if (homeRes.status === 'BLOCKED') {
            this.log.warn(`Website ${targetWebsite} returned blocked/challenge response.`);
            if (discoveredContacts.size === 0) overallStatus = 'BLOCKED';
          } else if (homeRes.html) {
            // Extract from Homepage
            this.extractAndAccumulate(homeRes.html, targetWebsite, 'OFFICIAL_WEBSITE', discoveredContacts);

            // Detect Contact / About / Booking sub-pages (capped at MAX_CONTACT_PAGES_PER_BUSINESS)
            const subPages = detectContactPages(
              homeRes.html,
              targetWebsite,
              config.MAX_CONTACT_PAGES_PER_BUSINESS
            );

            for (const subPage of subPages) {
              await safeSleep(config.CONTACT_MIN_DELAY_MS);
              this.log.debug(`Inspecting contact sub-page: ${subPage.url} (${subPage.type})`);
              const subRes = await this.fetchHtmlSafe(subPage.url);
              pagesVisited.push(subPage.url);

              if (subRes.html) {
                this.extractAndAccumulate(subRes.html, subPage.url, 'OFFICIAL_WEBSITE', discoveredContacts);

                // Check if sub-page is a contact form
                if (subPage.type === 'contact' || subPage.type === 'booking') {
                  const hasForm = /<form\b/i.test(subRes.html) || /input\b/i.test(subRes.html);
                  if (hasForm && !discoveredContacts.has(subPage.url)) {
                    discoveredContacts.set(subPage.url, {
                      value: subPage.url,
                      type: 'CONTACT_FORM',
                      classification: 'BUSINESS_GENERIC',
                      source: 'official_contact_form',
                      sourceUrl: subPage.url,
                      sourceType: 'OFFICIAL_WEBSITE',
                      confidence: 'HIGH',
                      qualityScore: 70,
                      status: 'VERIFIED_PUBLIC',
                      discoveredAt: new Date(),
                    });
                  }
                }
              }
            }
          }
        } catch (err: any) {
          this.log.warn(`Failed contact crawling for ${targetWebsite}: ${err.message}`);
        }
      }
    }

    const contactsList = Array.from(discoveredContacts.values());
    const primaryContact = selectPrimaryContact(contactsList);

    if (contactsList.length > 0) {
      overallStatus = 'VERIFIED_PUBLIC';
    }

    const result: ContactDiscoveryResult = {
      businessId: business.id,
      businessName: business.name,
      website: business.website || undefined,
      contacts: contactsList,
      primaryContact,
      status: overallStatus,
      pagesVisited,
      contactQualityScore: primaryContact ? primaryContact.qualityScore : 0,
    };

    // 3. Persist into SQLite and Enrich Lead (unless dry-run)
    if (!options.dryRun) {
      for (const contact of contactsList) {
        await this.contactRepo.upsertContactRecord(business.id, contact);
      }

      // Enrich Lead record
      await prisma.lead.updateMany({
        where: { businessId: business.id },
        data: {
          primaryContactType: primaryContact ? primaryContact.type : 'NONE',
          primaryContactValue: primaryContact ? primaryContact.value : null,
          contactQualityScore: primaryContact ? primaryContact.qualityScore : 0,
          contactDiscoveryStatus: overallStatus,
          contactDiscoverySource: primaryContact ? primaryContact.sourceType : null,
          contactDiscoveryConfidence: primaryContact ? primaryContact.confidence : null,
        },
      });
    }

    this.log.info(
      `Contact discovery complete for "${business.name}": Found ${contactsList.length} contact(s). Primary: ${primaryContact ? `${primaryContact.value} (${primaryContact.type})` : 'None'}`
    );

    return result;
  }

  /**
   * Discovers contacts for a batch of prioritized leads.
   */
  public async discoverBatch(
    limit: number = config.MAX_CONTACTS_PER_RUN,
    options: { dryRun?: boolean } = {}
  ): Promise<ContactDiscoveryResult[]> {
    const leads = await prisma.lead.findMany({
      take: Math.min(limit, config.MAX_CONTACTS_PER_RUN),
      orderBy: [{ priorityRank: 'asc' }, { leadOpportunityScore: 'desc' }],
      include: { business: true },
    });

    const results: ContactDiscoveryResult[] = [];
    for (const lead of leads) {
      const res = await this.discoverForBusiness(lead.businessId, options);
      results.push(res);
      await safeSleep(config.CONTACT_MIN_DELAY_MS);
    }

    return results;
  }

  private extractAndAccumulate(
    html: string,
    sourceUrl: string,
    sourceType: ContactSourceType,
    accumulator: Map<string, DiscoveredContactRecord>
  ): void {
    // 1. Extract Emails
    const extractedEmails = extractEmailsFromHtml(html);
    for (const item of extractedEmails) {
      if (accumulator.size >= 10) break;

      const val = validateEmail(item.email, sourceUrl);
      if (val.isValid) {
        const emailDomain = item.email.split('@')[1]?.toLowerCase();
        const isPlatform = emailDomain ? isExcludedDirectoryDomain(emailDomain) : false;
        const classification = isPlatform ? 'PLATFORM_CONTACT' : 'OFFICIAL_SITE_EMAIL';

        const quality = calculateContactQualityScore({
          type: 'EMAIL',
          classification,
          sourceType,
        });

        accumulator.set(item.email, {
          value: item.email,
          email: item.email,
          type: 'EMAIL',
          classification,
          source: isPlatform ? 'platform_directory' : 'official_website_html',
          sourceUrl,
          sourceType,
          confidence: isPlatform ? 'LOW' : (val.domainMatchesOfficialWebsite ? 'HIGH' : 'MEDIUM'),
          qualityScore: quality,
          status: isPlatform ? 'PUBLIC_UNVERIFIED' : 'VERIFIED_PUBLIC',
          emailAsFound: item.emailAsFound,
          sourceContext: item.sourceContext,
          isVerified: !isPlatform,
          isPublic: true,
          discoveredAt: new Date(),
        });
      }
    }

    // 2. Extract Phones
    const extractedPhones = extractPhonesFromHtml(html);
    for (const item of extractedPhones) {
      if (accumulator.size >= 10) break;

      const val = validatePhone(item.rawPhone);
      if (val.isValid && val.normalized && !accumulator.has(val.normalized)) {
        const quality = calculateContactQualityScore({
          type: 'PHONE',
          classification: 'OFFICIAL_SITE_PHONE',
          sourceType,
        });

        accumulator.set(val.normalized, {
          value: val.normalized,
          rawPhone: item.rawPhone,
          normalizedPhone: val.normalized,
          type: 'PHONE',
          classification: 'OFFICIAL_SITE_PHONE',
          source: 'official_website_html',
          sourceUrl,
          sourceType,
          confidence: 'HIGH',
          qualityScore: quality,
          status: 'VERIFIED_PUBLIC',
          discoveredAt: new Date(),
        });
      }
    }
  }

  private async fetchHtmlSafe(url: string): Promise<{ html?: string; status: 'OK' | 'BLOCKED' | 'ERROR' }> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': config.DISCOVERY_USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
        },
      });

      clearTimeout(timeoutId);

      if (response.status === 403 || response.status === 429) {
        return { status: 'BLOCKED' };
      }

      if (!response.ok) {
        return { status: 'ERROR' };
      }

      const html = await response.text();
      return { html, status: 'OK' };
    } catch {
      return { status: 'ERROR' };
    }
  }
}
