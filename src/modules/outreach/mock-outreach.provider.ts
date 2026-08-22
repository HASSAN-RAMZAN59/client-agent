import { OutreachProvider } from '../../types/index.js';
import { logger } from '../../utils/logger.js';

/**
 * Mock outreach provider creating personalized email copy based on website audit findings.
 * Future phases will plug in zero-cost local LLM or provider APIs for AI personalization.
 */
export class MockOutreachProvider implements OutreachProvider {
  public readonly providerName = 'MockOutreachProvider';
  private log = logger.child('Outreach');

  public async generateDraft(params: {
    businessName: string;
    contactName?: string;
    niche: string;
    auditFindings?: string[];
  }): Promise<{ subject: string; body: string }> {
    this.log.info(`Generating personalized outreach draft for "${params.businessName}"`);

    const greeting = params.contactName ? `Hi ${params.contactName}` : `Hello ${params.businessName} Team`;
    const subject = `Quick question regarding ${params.businessName}'s web presence`;

    const findingsBullet = params.auditFindings && params.auditFindings.length > 0
      ? params.auditFindings.slice(0, 2).map((f) => ` • ${f}`).join('\n')
      : ' • Mobile responsiveness and conversion rate optimization potential';

    const body = `${greeting},

I came across ${params.businessName} while researching leading ${params.niche} businesses in your area.

I noticed a couple of quick technical opportunities that could help attract more direct customer inquiries and bookings:
${findingsBullet}

I help local businesses modernize their web and mobile applications to increase customer conversions. Would you be open to a brief 5-minute chat or a free Loom video walkthrough this week?

Best regards,
Freelance Web & Mobile Developer
`;

    return {
      subject,
      body: body.trim(),
    };
  }
}
