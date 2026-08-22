import {
  OpportunityFlag,
  RecommendedService,
  MobileAppOpportunityLevel,
} from '../../../types/index.js';

export interface ServiceRecommenderInput {
  hasNoWebsite: boolean;
  websiteQualityScore: number;
  opportunityFlags: OpportunityFlag[];
  mobileAppOpportunity: MobileAppOpportunityLevel;
  topProblems: string[];
}

export function recommendService(input: ServiceRecommenderInput): {
  service: RecommendedService;
  primaryReason: string;
} {
  // 1. No Website -> Immediate full build
  if (input.hasNoWebsite || input.opportunityFlags.includes('NO_WEBSITE') || input.websiteQualityScore <= 30) {
    return {
      service: 'WEBSITE_REBUILD',
      primaryReason: 'Business lacks an online presence or has an obsolete site requiring a complete modern build.',
    };
  }

  // 2. High Mobile App Opportunity
  if (input.mobileAppOpportunity === 'HIGH' && input.websiteQualityScore >= 75) {
    return {
      service: 'MOBILE_APP',
      primaryReason: 'Strong existing web presence combined with appointment booking or customer workflows — prime candidate for a branded mobile app.',
    };
  }

  // 3. Broken Mobile Viewport / Overflow
  if (input.opportunityFlags.includes('POOR_MOBILE')) {
    return {
      service: 'MOBILE_OPTIMIZATION',
      primaryReason: 'Website suffers from mobile viewport overflow or broken layout on smartphones.',
    };
  }

  // 4. Broken SEO or noindex
  if (input.opportunityFlags.includes('WEAK_SEO') && input.topProblems.some((p) => p.toLowerCase().includes('noindex') || p.toLowerCase().includes('title'))) {
    return {
      service: 'SEO_IMPROVEMENT',
      primaryReason: 'Critical SEO or indexing blockers prevent the business from appearing in search results.',
    };
  }

  // 5. Website Improvement (Speed, CTAs, Conversion)
  if (input.websiteQualityScore < 85 || input.opportunityFlags.includes('SLOW_LOADING') || input.opportunityFlags.includes('NO_CLEAR_CTA')) {
    return {
      service: 'WEBSITE_IMPROVEMENT',
      primaryReason: 'Identifiable speed, UX, or call-to-action weaknesses limiting conversion on existing site.',
    };
  }

  // 6. Maintenance or minor touchup
  if (input.opportunityFlags.length > 0) {
    return {
      service: 'MAINTENANCE',
      primaryReason: 'Minor accessibility or cosmetic issues suitable for ongoing maintenance.',
    };
  }

  return {
    service: 'NO_CLEAR_SERVICE_FIT',
    primaryReason: 'Website is modern and performant with no obvious technical or application development gaps.',
  };
}
