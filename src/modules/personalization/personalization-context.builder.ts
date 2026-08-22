import {
  PersonalizationContext,
  OpportunityFlag,
  LeadClassification,
  PriorityLevel,
  AuditConfidence,
  RecommendedService,
  ContactType,
  ContactClassification,
  ContactDiscoveryStatus,
  ContactSourceType,
} from '../../types/index.js';
import { prisma } from '../../database/index.js';

export function translateOpportunityFlagToBusinessLanguage(flag: OpportunityFlag): string {
  switch (flag) {
    case 'SLOW_LOADING':
      return 'the site appears slower than it should be on mobile';
    case 'POOR_MOBILE':
      return 'the mobile experience could be improved';
    case 'NO_CLEAR_CTA':
      return "there isn't a strong next step for visitors";
    case 'NO_CONTACT_METHOD':
      return "it's harder than necessary for a visitor to get in touch";
    case 'WEAK_SEO':
      return 'there are some basic search-visibility opportunities';
    case 'ACCESSIBILITY_ISSUES':
      return 'some accessibility elements could be improved';
    case 'THIN_CONTENT':
      return 'some important pages have relatively limited content';
    case 'NO_BOOKING':
      return 'there may be an opportunity to make appointment requests easier';
    case 'NO_WEBSITE':
      return "I couldn't find a dedicated website for the business";
    case 'OUTDATED_SIGNALS':
      return 'the current site shows several areas that could benefit from modernization';
    case 'BROKEN_ELEMENTS':
      return 'certain layout elements appeared misaligned or broken on mobile';
    default:
      return 'there are several website enhancement opportunities';
  }
}

export async function buildPersonalizationContext(leadId: string): Promise<PersonalizationContext> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      business: {
        include: {
          audits: { orderBy: { updatedAt: 'desc' }, take: 1 },
          contacts: { orderBy: { qualityScore: 'desc' } },
        },
      },
    },
  });

  if (!lead) {
    throw new Error(`Lead with ID "${leadId}" not found.`);
  }

  const business = lead.business;
  const audit = business.audits[0] || null;
  const topContact = business.contacts[0] || null;

  const opportunityFlags: OpportunityFlag[] = audit?.opportunityFlags
    ? JSON.parse(audit.opportunityFlags)
    : [];

  const topProblems: string[] = audit?.issuesJson
    ? JSON.parse(audit.issuesJson)
    : [];

  const findings = audit?.findings ? JSON.parse(audit.findings) : [];
  const mobileAppReasoning = audit?.mobileAppReasoning ? JSON.parse(audit.mobileAppReasoning) : [];

  const leadTopSignals: OpportunityFlag[] = lead.topOpportunitySignals
    ? JSON.parse(lead.topOpportunitySignals)
    : opportunityFlags;

  const leadTopProblems: string[] = lead.topProblems
    ? JSON.parse(lead.topProblems)
    : topProblems;

  let salesAngle = null;
  if (lead.salesAngle) {
    try {
      salesAngle = JSON.parse(lead.salesAngle);
    } catch {
      salesAngle = {
        problem: lead.salesAngle,
        opportunity: 'Improve website UX and performance',
        recommendedService: lead.recommendedService || 'WEBSITE_IMPROVEMENT',
        businessImpact: 'Increase online conversions and patient acquisition',
        confidence: 'MEDIUM',
        evidence: [],
      };
    }
  }

  return {
    business: {
      name: business.name,
      category: business.category,
      city: business.city,
      country: business.country,
      address: business.address,
      phone: business.phone,
      website: business.website,
      reachabilityStatus: audit ? audit.status : (business.website ? 'WEBSITE_REACHABLE' : 'NO_WEBSITE_FOUND'),
      confidence: audit?.confidence || 'MEDIUM',
    },
    audit: audit
      ? {
          websiteStatus: audit.status,
          overallScore: audit.score,
          loadTimeMs: audit.loadTimeMs || undefined,
          mobileResponsive: audit.mobileResponsive ?? undefined,
          sslValid: audit.sslValid ?? undefined,
          hasContactForm: audit.hasContactForm ?? undefined,
          findings,
          opportunityFlags,
          topProblems,
          mobileAppOpportunity: audit.mobileAppOpportunity || undefined,
          mobileAppReasoning,
        }
      : null,
    lead: {
      id: lead.id,
      leadOpportunityScore: lead.leadOpportunityScore,
      classification: lead.classification as LeadClassification,
      priority: lead.priority as PriorityLevel,
      priorityRank: lead.priorityRank,
      confidenceLevel: lead.confidenceLevel as AuditConfidence,
      recommendedService: lead.recommendedService as RecommendedService,
      salesAngle,
      topOpportunitySignals: leadTopSignals,
      topProblems: leadTopProblems,
    },
    contact: {
      value: lead.primaryContactValue || topContact?.value || null,
      type: (lead.primaryContactType || topContact?.type || 'NONE') as ContactType | 'NONE',
      classification: (topContact?.classification || 'BUSINESS_GENERIC') as ContactClassification,
      qualityScore: lead.contactQualityScore || topContact?.qualityScore || 0,
      contactName: topContact?.contactName || null,
      role: topContact?.role || null,
      status: (lead.contactDiscoveryStatus || topContact?.status || 'NONE_FOUND') as ContactDiscoveryStatus,
      sourceUrl: topContact?.sourceUrl || null,
      sourceType: (lead.contactDiscoverySource || topContact?.sourceType || null) as ContactSourceType | null,
    },
    sender: {
      name: process.env.SENDER_NAME || 'Alex Morgan',
      company: process.env.SENDER_COMPANY || 'ModernWeb Studio',
      email: process.env.SENDER_EMAIL || 'alex@modernwebstudio.com',
    },
  };
}
