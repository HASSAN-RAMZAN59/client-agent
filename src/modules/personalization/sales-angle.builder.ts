import {
  PersonalizationContext,
  DetailedSalesAngle,
  AuditConfidence,
} from '../../types/index.js';
import { translateOpportunityFlagToBusinessLanguage } from './personalization-context.builder.js';

export function buildDetailedSalesAngle(context: PersonalizationContext): DetailedSalesAngle {
  const { business, audit, lead } = context;

  // Case 1: No Website
  if (!business.website || audit?.websiteStatus === 'NO_WEBSITE' || lead.topOpportunitySignals.includes('NO_WEBSITE')) {
    return {
      problem: `No dedicated online website detected for ${business.name}`,
      evidence: ['No active official domain registered in discovery directories or public web search.'],
      opportunity: `Build a modern, mobile-first website showcasing services in ${business.city}.`,
      recommendedService: 'WEBSITE_REBUILD',
      businessImpact: 'A dedicated web presence makes it easier for potential customers searching online to find business hours, location, and contact options.',
      confidence: 'HIGH',
    };
  }

  // Case 2: Website Blocked by Challenge/WAF
  if (audit?.websiteStatus === 'BLOCKED') {
    return {
      problem: 'Website technical evaluation was protected from automated testing',
      evidence: ['Official website returned automated challenge/bot protection screen during audit.'],
      opportunity: 'Conduct a collaborative review of mobile usability and page loading speed.',
      recommendedService: 'WEBSITE_IMPROVEMENT',
      businessImpact: 'Ensuring seamless visitor accessibility on all devices helps support reliable customer engagement.',
      confidence: 'MEDIUM',
    };
  }

  // Case 3: Mobile App Opportunity
  if (lead.recommendedService === 'MOBILE_APP' || audit?.mobileAppOpportunity === 'HIGH') {
    const evidenceList: string[] = [];
    if (audit?.mobileAppReasoning && audit.mobileAppReasoning.length > 0) {
      evidenceList.push(...audit.mobileAppReasoning);
    } else {
      evidenceList.push('Website has active customer booking or account workflows.');
    }

    return {
      problem: 'Customer interactions and repeat appointments currently rely solely on mobile web browsing',
      evidence: evidenceList,
      opportunity: 'Deploy a branded mobile app with 1-tap booking, push appointment reminders, and customer loyalty.',
      recommendedService: 'MOBILE_APP',
      businessImpact: 'Direct mobile presence can help reduce appointment no-shows and increase repeat customer retention.',
      confidence: 'HIGH',
    };
  }

  // Case 4: Broken Mobile Viewport / Overflow
  if (lead.topOpportunitySignals.includes('POOR_MOBILE') || audit?.mobileResponsive === false) {
    return {
      problem: 'Mobile viewport display and responsiveness issues',
      evidence: [
        'Mobile browser audit detected horizontal layout overflow or non-responsive elements.',
        ...(audit?.topProblems?.filter((p) => p.toLowerCase().includes('mobile') || p.toLowerCase().includes('overflow')) || []),
      ],
      opportunity: 'Refine CSS layout and responsive viewport rendering for seamless smartphone browsing.',
      recommendedService: 'MOBILE_OPTIMIZATION',
      businessImpact: 'A clean mobile layout makes it easier for visitors to read service details and tap to call.',
      confidence: 'HIGH',
    };
  }

  // Case 5: Slow Loading Performance
  if (lead.topOpportunitySignals.includes('SLOW_LOADING') || (audit?.loadTimeMs && audit.loadTimeMs > 3500)) {
    const loadTimeSec = audit?.loadTimeMs ? (audit.loadTimeMs / 1000).toFixed(1) : '4.5+';
    return {
      problem: `Slow page loading speed (${loadTimeSec}s on mobile)`,
      evidence: [
        `Mobile audit recorded approximately ${loadTimeSec}s initial load time.`,
        'Performance score below recommended Core Web Vitals thresholds.',
      ],
      opportunity: 'Optimize asset delivery, compression, and script execution for faster page speed.',
      recommendedService: 'WEBSITE_IMPROVEMENT',
      businessImpact: 'Faster load times reduce visitor bounce rates and create a smoother experience for prospective clients.',
      confidence: 'HIGH',
    };
  }

  // Case 6: UX / Missing CTA / Contact Form
  if (lead.topOpportunitySignals.includes('NO_CLEAR_CTA') || lead.topOpportunitySignals.includes('NO_CONTACT_METHOD')) {
    return {
      problem: 'Limited direct call-to-action or contact pathways on key pages',
      evidence: [
        'Homepage lacks prominent click-to-call button or simplified inquiry form.',
        ...(audit?.topProblems || []),
      ],
      opportunity: 'Introduce clear contact buttons, phone links, and streamlined consultation request options.',
      recommendedService: 'WEBSITE_IMPROVEMENT',
      businessImpact: 'Prominent next steps reduce friction for visitors ready to get in touch or book an appointment.',
      confidence: 'HIGH',
    };
  }

  // Case 7: General Improvement / Maintenance
  const evidence = audit?.topProblems && audit.topProblems.length > 0
    ? audit.topProblems.slice(0, 3)
    : [translateOpportunityFlagToBusinessLanguage(lead.topOpportunitySignals[0] || 'OUTDATED_SIGNALS')];

  let confidence: AuditConfidence = 'MEDIUM';
  if (audit && audit.overallScore > 0) {
    confidence = 'HIGH';
  }

  return {
    problem: audit?.topProblems?.[0] || 'Identifiable website modernization opportunities',
    evidence,
    opportunity: 'Implement targeted technical and UX enhancements on key pages.',
    recommendedService: lead.recommendedService || 'WEBSITE_IMPROVEMENT',
    businessImpact: 'Modernized technical and visual presentation can help support stronger visitor engagement.',
    confidence,
  };
}
