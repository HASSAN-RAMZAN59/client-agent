import {
  SalesAngle,
  RecommendedService,
  OpportunityFlag,
} from '../../../types/index.js';

export interface SalesAngleInput {
  businessName: string;
  category: string;
  hasNoWebsite: boolean;
  websiteQualityScore: number;
  opportunityFlags: OpportunityFlag[];
  recommendedService: RecommendedService;
  topProblems: string[];
}

export function generateSalesAngle(input: SalesAngleInput): SalesAngle {
  if (input.hasNoWebsite || input.opportunityFlags.includes('NO_WEBSITE')) {
    return {
      problem: `No online website presence for ${input.businessName}.`,
      opportunity: `Build a modern, mobile-first website to capture local search traffic in the ${input.category} niche.`,
      recommendedService: 'WEBSITE_REBUILD',
      reason: 'Local competitors with web booking/presence capture search leads that could belong to this business.',
    };
  }

  if (input.recommendedService === 'MOBILE_APP') {
    return {
      problem: 'Customers currently book or interact via browser without push reminders or direct app loyalty.',
      opportunity: 'Deploy a dedicated branded mobile app with 1-tap booking, push notifications, and customer loyalty.',
      recommendedService: 'MOBILE_APP',
      reason: 'Increases repeat customer retention and reduces no-shows through automated mobile push alerts.',
    };
  }

  if (input.recommendedService === 'MOBILE_OPTIMIZATION') {
    return {
      problem: 'Website displays layout overflow or broken responsiveness on mobile smartphones.',
      opportunity: 'Modernize responsive CSS layout for flawless mobile user experience and higher mobile conversion.',
      recommendedService: 'MOBILE_OPTIMIZATION',
      reason: 'Over 65% of local service searchers browse on mobile; broken layout directly drives away high-intent customers.',
    };
  }

  if (input.opportunityFlags.includes('SLOW_LOADING')) {
    return {
      problem: 'Slow initial page load speed (> 4s) causes mobile bounce rates.',
      opportunity: 'Optimize page performance and streamline conversion paths for faster customer acquisition.',
      recommendedService: 'WEBSITE_IMPROVEMENT',
      reason: 'Faster page speed improves Google Core Web Vitals and increases mobile contact submissions.',
    };
  }

  return {
    problem: input.topProblems[0] || 'Sub-optimal conversion flow on current website.',
    opportunity: 'Refine conversion CTAs, improve accessibility, and modernize service presentation.',
    recommendedService: input.recommendedService,
    reason: 'Targeted website refinements produce immediate conversion gains without needing a full ground-up redesign.',
  };
}
