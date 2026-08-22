import { RuleBasedLeadScoringProvider } from '../src/modules/scoring/rule-based-scoring.provider.js';

const NICHES = [
  'Restaurant',
  'Cafe',
  'Auto dealership',
  'Plumber',
  'Roofing contractor',
  'Real estate agency',
  'Gym',
  'Salon/barbershop',
  'Cleaning company',
  'IT/software agency',
];

const provider = new RuleBasedLeadScoringProvider();

console.log('Testing Niche Portability across 10 Commercial Verticals:');
for (const niche of NICHES) {
  // 1. Test with No Website
  const noWebScore = provider.calculateScore({
    business: {
      name: `Sample ${niche} Co`,
      category: niche,
      city: 'Austin',
      phone: '+1 512 555 0199',
      address: '123 Main St',
      website: null,
    },
    hasWebsite: false,
  });

  // 2. Test with Weak Website
  const weakWebScore = provider.calculateScore({
    business: {
      name: `Sample ${niche} Pro`,
      category: niche,
      city: 'Austin',
      phone: '+1 512 555 0199',
      address: '123 Main St',
      website: 'https://example.com',
    },
    audit: {
      status: 'AUDITED',
      overallScore: 35,
      performanceScore: 30,
      seoScore: 40,
      mobileScore: 30,
      accessibilityScore: 40,
      issues: ['Mobile viewport overflow', 'Slow server response'],
      opportunityFlags: ['POOR_MOBILE', 'SLOW_LOADING'],
      mobileAppOpportunity: 'MEDIUM',
    } as any,
    hasWebsite: true,
  });

  // 3. Test with Modern Website
  const goodWebScore = provider.calculateScore({
    business: {
      name: `Sample Modern ${niche}`,
      category: niche,
      city: 'Austin',
      phone: '+1 512 555 0199',
      address: '123 Main St',
      website: 'https://modern.com',
    },
    audit: {
      status: 'AUDITED',
      overallScore: 92,
      performanceScore: 90,
      seoScore: 95,
      mobileScore: 90,
      accessibilityScore: 92,
      issues: [],
      opportunityFlags: [],
      mobileAppOpportunity: 'HIGH',
    } as any,
    hasWebsite: true,
  });

  console.log(`[${niche}] -> NoWeb: ${noWebScore.leadOpportunityScore} (${noWebScore.classification}, ${noWebScore.recommendedService}) | WeakWeb: ${weakWebScore.leadOpportunityScore} (${weakWebScore.classification}, ${weakWebScore.recommendedService}) | GoodWeb: ${goodWebScore.leadOpportunityScore} (${goodWebScore.classification}, ${goodWebScore.recommendedService})`);
}
