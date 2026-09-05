import {
  LeadScoringProvider,
  LeadScoreResult,
  WebsiteAuditResult,
  ComprehensiveAuditResult,
  PriorityLevel,
  OpportunityFlag,
  MobileAppOpportunityLevel,
  AuditConfidence,
  DiscoveredContactInput,
  OfficialWebsiteConfidence,
} from '../../types/index.js';
import { analyzeCommercialPotential } from './analyzers/commercial-potential.analyzer.js';
import { analyzeContactability } from './analyzers/contactability.analyzer.js';
import { analyzeProblemSeverity } from './analyzers/problem-severity.analyzer.js';
import { recommendService } from './analyzers/service-recommender.js';
import { generateSalesAngle } from './analyzers/sales-angle-generator.js';
import { logger } from '../../utils/logger.js';

export class RuleBasedLeadScoringProvider implements LeadScoringProvider {
  public readonly providerName = 'RuleBasedLeadScoringProvider';
  private log = logger.child('LeadScoringProvider');

  public calculateScore(params: {
    business: {
      name: string;
      category: string;
      city?: string;
      address?: string | null;
      phone?: string | null;
      website?: string | null;
      source?: string;
      officialWebsiteConfidence?: OfficialWebsiteConfidence;
    };
    audit?: ComprehensiveAuditResult | WebsiteAuditResult | null;
    contacts?: DiscoveredContactInput[];
    hasWebsite?: boolean;
    category?: string;
  }): LeadScoreResult {
    const audit = params.audit;
    const contacts = params.contacts || [];
    const business = params.business || {
      name: 'Business',
      category: params.category || 'General',
      website: params.audit?.website,
      phone: null,
      address: null,
    };
    const businessName = business.name || 'Business';
    const category = business.category || params.category || 'General';
    const hasWebsite = Boolean(business.website && business.website.trim().length > 0);

    const auditStatus = audit?.status || (hasWebsite ? 'PENDING' : 'NO_WEBSITE');
    const isNoWebsite = !hasWebsite || auditStatus === 'NO_WEBSITE';
    const qualityScore = audit
      ? ('overallScore' in audit ? audit.overallScore : (audit as any).score) || 0
      : (hasWebsite ? 50 : 0);

    const opportunityFlags: OpportunityFlag[] = audit && 'opportunityFlags' in audit && Array.isArray((audit as any).opportunityFlags)
      ? (audit as any).opportunityFlags
      : (isNoWebsite ? ['NO_WEBSITE'] : []);

    if (audit?.issues) {
      if (audit.issues.some((i: string) => i.toLowerCase().includes('mobile') || i.toLowerCase().includes('overflow')) && !opportunityFlags.includes('POOR_MOBILE')) {
        opportunityFlags.push('POOR_MOBILE');
      }
      if (audit.issues.some((i: string) => i.toLowerCase().includes('slow') || i.toLowerCase().includes('latency')) && !opportunityFlags.includes('SLOW_LOADING')) {
        opportunityFlags.push('SLOW_LOADING');
      }
    }

    const mobileAppOpp: MobileAppOpportunityLevel = audit && 'mobileAppOpportunity' in audit
      ? audit.mobileAppOpportunity
      : 'LOW';

    const topProblems: string[] = audit && 'topProblems' in audit
      ? audit.topProblems
      : (audit?.issues || (isNoWebsite ? ['No active website registered'] : []));

    // 1. Website Opportunity Score (30% weight)
    // Low quality score = high opportunity to sell redesign/build
    let websiteOpportunityScore = 0;
    if (isNoWebsite) {
      websiteOpportunityScore = 95;
    } else {
      websiteOpportunityScore = Math.max(5, Math.min(100, Math.round(100 - qualityScore)));
      if (opportunityFlags.includes('POOR_MOBILE')) websiteOpportunityScore += 15;
      if (opportunityFlags.includes('SLOW_LOADING')) websiteOpportunityScore += 10;
      if (opportunityFlags.includes('NO_CLEAR_CTA')) websiteOpportunityScore += 10;
    }
    websiteOpportunityScore = Math.min(100, Math.max(0, websiteOpportunityScore));

    // 2. Commercial Potential Score (20% weight)
    const commRes = analyzeCommercialPotential({
      category,
      hasPhone: Boolean(business.phone),
      hasAddress: Boolean(business.address),
      hasBookingOrOrdering: mobileAppOpp === 'HIGH' || opportunityFlags.includes('NO_BOOKING'),
    });
    const commercialPotentialScore = commRes.score;

    // 3. Contactability Score (15% weight)
    const hasContactForm = audit ? Boolean(audit.hasContactForm) : false;
    const hasEmail = Boolean(
      contacts.some(
        (c) =>
          (c.type === 'EMAIL' || (c.email && c.email.length > 0)) &&
          c.classification !== 'PLATFORM_CONTACT' &&
          c.classification !== 'UNVERIFIED_CONTACT'
      )
    );
    const hasPhone = Boolean(
      business.phone ||
      contacts.some(
        (c) =>
          c.type === 'PHONE' &&
          c.classification !== 'PLATFORM_CONTACT' &&
          c.classification !== 'UNVERIFIED_CONTACT'
      )
    );
    const contactRes = analyzeContactability({
      hasEmail,
      hasPhone,
      hasWebsite,
      hasContactForm,
      hasAddress: Boolean(business.address),
    });
    const contactabilityScore = contactRes.score;

    // 4. Website Problem Severity Score (15% weight)
    const problemRes = analyzeProblemSeverity({
      hasNoWebsite: isNoWebsite,
      opportunityFlags,
      findingsTitles: topProblems,
    });
    const websiteProblemScore = problemRes.score;

    // 5. Mobile App Opportunity Score (10% weight)
    let mobileAppOpportunityScore = 20;
    if (mobileAppOpp === 'HIGH') mobileAppOpportunityScore = 90;
    else if (mobileAppOpp === 'MEDIUM') mobileAppOpportunityScore = 60;

    // 6. Data Confidence Score (10% weight)
    let dataConfidenceScore = 70;
    let confidenceLevel: AuditConfidence = 'MEDIUM';

    if (business.officialWebsiteConfidence === 'HIGH' && (hasEmail || business.phone)) {
      dataConfidenceScore = 95;
      confidenceLevel = 'HIGH';
    } else if (business.officialWebsiteConfidence === 'LOW' || (!hasEmail && !business.phone && !isNoWebsite)) {
      dataConfidenceScore = 40;
      confidenceLevel = 'LOW';
    }

    // --- Weighted Lead Opportunity Score (0 - 100) ---
    // Website Opportunity: 30%, Commercial: 20%, Contactability: 15%, Problem Severity: 15%, Mobile App: 10%, Confidence: 10%
    const weightedScore =
      websiteOpportunityScore * 0.30 +
      commercialPotentialScore * 0.20 +
      contactabilityScore * 0.15 +
      websiteProblemScore * 0.15 +
      mobileAppOpportunityScore * 0.10 +
      dataConfidenceScore * 0.10;

    const leadOpportunityScore = Math.min(100, Math.max(0, Math.round(weightedScore)));

    // Classification (HOT, WARM, COLD, DISQUALIFIED)
    let classification: import('../../types/index.js').LeadClassification = 'WARM';
    if (isNoWebsite || leadOpportunityScore >= 70) {
      classification = 'HOT';
    } else if (leadOpportunityScore >= 50) {
      classification = 'WARM';
    } else if (leadOpportunityScore >= 30) {
      classification = 'COLD';
    } else {
      classification = 'DISQUALIFIED';
    }

    // Priority Ranking (1 to 5) & Priority Level
    let priorityRank = 5;
    let priority: PriorityLevel = 'LOW';

    if (classification === 'HOT') {
      if (confidenceLevel === 'HIGH' || isNoWebsite) {
        priorityRank = 1;
        priority = 'URGENT';
      } else {
        priorityRank = 2;
        priority = 'HIGH';
      }
    } else if (classification === 'WARM') {
      if (confidenceLevel === 'HIGH') {
        priorityRank = 3;
        priority = 'HIGH';
      } else {
        priorityRank = 4;
        priority = 'MEDIUM';
      }
    } else {
      priorityRank = 5;
      priority = 'LOW';
    }

    // Recommended Service & Sales Angle
    const serviceMatch = recommendService({
      hasNoWebsite: isNoWebsite,
      websiteQualityScore: qualityScore,
      opportunityFlags,
      mobileAppOpportunity: mobileAppOpp,
      topProblems,
    });

    const salesAngle = generateSalesAngle({
      businessName,
      category,
      hasNoWebsite: isNoWebsite,
      websiteQualityScore: qualityScore,
      opportunityFlags,
      recommendedService: serviceMatch.service,
      topProblems,
    });

    // Reasoning bullets
    const reasoning: string[] = [
      isNoWebsite
        ? 'Business has no website — high urgency for ground-up web development.'
        : `Website quality is ${qualityScore}/100. Opportunity score: ${leadOpportunityScore}/100.`,
      ...commRes.reasoning.slice(0, 1),
      `Contactability channels: [${contactRes.channelsAvailable.join(', ')}] (${contactabilityScore}/100).`,
      `Recommended Service: ${serviceMatch.service} (${serviceMatch.primaryReason})`,
    ];

    const qualificationStatus = classification === 'DISQUALIFIED' ? 'DISQUALIFIED' : 'QUALIFIED';

    return {
      leadOpportunityScore,
      overallScore: leadOpportunityScore,
      classification,
      priority,
      priorityRank,
      confidenceLevel,
      breakdown: {
        websiteOpportunity: websiteOpportunityScore,
        commercialPotential: commercialPotentialScore,
        contactability: contactabilityScore,
        websiteProblem: websiteProblemScore,
        mobileAppOpportunity: mobileAppOpportunityScore,
        dataConfidence: dataConfidenceScore,
      },
      websiteOpportunityScore,
      mobileAppOpportunityScore,
      qualificationStatus,
      recommendedService: serviceMatch.service,
      topOpportunitySignals: opportunityFlags,
      topProblems,
      salesAngle,
      reasoning,
    };
  }
}
