import {
  PersonalizationContext,
  PersonalizationResult,
  OutreachDraftResult,
  DraftStatus,
} from '../../../types/index.js';
import { PersonalizationProvider } from './personalization-provider.interface.js';
import { buildDetailedSalesAngle } from '../sales-angle.builder.js';
import { OutreachQualityGuard } from '../quality-guard.js';
import { config } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';

export class RuleBasedPersonalizationProvider implements PersonalizationProvider {
  public readonly name = 'RuleBasedPersonalizationProvider';
  private log = logger.child('RuleBasedPersonalizationProvider');

  public async isAvailable(): Promise<boolean> {
    return true; // Always available, zero-cost, no external dependencies
  }

  public async generate(context: PersonalizationContext): Promise<PersonalizationResult> {
    const { business, audit, lead, contact, sender } = context;
    const salesAngle = buildDetailedSalesAngle(context);

    // Determine Greeting
    let greeting = 'Hi there,';
    if (contact.contactName) {
      greeting = `Hi ${contact.contactName},`;
    } else if (contact.classification === 'BUSINESS_GENERIC') {
      greeting = `Hello ${business.name} Team,`;
    }

    const hasNoWebsite = !business.website || audit?.websiteStatus === 'NO_WEBSITE';
    const isBlocked = audit?.websiteStatus === 'BLOCKED';
    const isNoContact = !contact.value || contact.status === 'NONE_FOUND';

    // 1. Generate Variant A (Short: 50–80 words)
    const variantA = this.generateVariantA({
      businessName: business.name,
      city: business.city,
      niche: business.category,
      website: business.website,
      salesAngle,
      greeting,
      sender,
      hasNoWebsite,
      isBlocked,
    });

    // 2. Generate Variant B (Standard: 80–140 words)
    const variantB = this.generateVariantB({
      businessName: business.name,
      city: business.city,
      niche: business.category,
      website: business.website,
      salesAngle,
      greeting,
      sender,
      hasNoWebsite,
      isBlocked,
    });

    // 3. Generate Variant C (Audit-Based: 100–180 words)
    const variantC = this.generateVariantC({
      businessName: business.name,
      city: business.city,
      niche: business.category,
      website: business.website,
      salesAngle,
      greeting,
      sender,
      hasNoWebsite,
      isBlocked,
      audit,
    });

    // Run Quality Guard & Score each variant
    const drafts: OutreachDraftResult[] = [variantA, variantB, variantC].map((v) => {
      const qCheck = OutreachQualityGuard.evaluate(v.subject, v.body);
      const pScore = this.calculatePersonalizationScore({
        context,
        salesAngle,
        qualityCheck: qCheck,
      });

      let status: DraftStatus = 'DRAFT';
      if (!qCheck.passed || pScore < 75 || isNoContact) {
        status = 'REVIEW_REQUIRED';
      }

      return {
        variant: v.variant,
        channel: 'EMAIL',
        subject: v.subject,
        subjectVariants: v.subjectVariants,
        body: v.body,
        personalizationScore: pScore,
        confidence: salesAngle.confidence,
        provider: this.name,
        sourceEvidence: salesAngle.evidence,
        salesAngle,
        qualityCheck: qCheck,
        status,
      };
    });

    const overallPersonalizationScore = Math.round(
      drafts.reduce((sum, d) => sum + d.personalizationScore, 0) / drafts.length
    );

    return {
      leadId: lead.id,
      businessName: business.name,
      salesAngle,
      variants: drafts,
      overallPersonalizationScore,
      primaryContactValue: contact.value || undefined,
      primaryContactType: contact.type !== 'NONE' ? contact.type : undefined,
    };
  }

  private formatSignature(sender: { name: string; company?: string; email?: string }): string {
    const senderName = sender.name || 'HASSAN RAMZAN';
    const senderEmail = sender.email || 'hassanramzan59@gmail.com';
    const postalAddress = config.SENDER_POSTAL_ADDRESS ? config.SENDER_POSTAL_ADDRESS.trim() : '';

    const lines = [
      senderName,
      senderEmail,
      '',
      'Web development outreach',
    ];

    if (postalAddress) {
      lines.push('', postalAddress);
    }

    lines.push(
      '',
      'If you\'d rather not receive emails from me, just reply "unsubscribe" and I won\'t contact you again.'
    );

    return lines.join('\n');
  }

  private cleanEvidenceText(text?: string): string {
    if (!text) return 'a few potential layout optimization opportunities';
    let cleaned = text.trim();
    
    // Remove robotic internal labels and rewrite into natural phrasing
    cleaned = cleaned.replace(/^Mobile browser audit detected horizontal layout overflow or non-responsive elements\.?/i, 'the site shows horizontal overflow on a mobile-sized screen');
    cleaned = cleaned.replace(/^Mobile audit recorded approximately ([\d.]+s) initial load time\.?/i, 'my mobile audit recorded an initial load time of about $1');
    cleaned = cleaned.replace(/^Audit probe challenged by WAF\.?/i, 'a few technical navigation items on mobile devices');
    cleaned = cleaned.replace(/^Critical Page Load Latency\.?/i, 'the mobile page load latency');
    cleaned = cleaned.replace(/^Slow initial page load speed \(> 4s\) causes mobile bounce rates\.?/i, 'the initial mobile page load speed is slower than recommended');

    // Remove any trailing dots
    cleaned = cleaned.replace(/\.+$/, '');

    // Capitalize first character
    if (cleaned.length > 0) {
      cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }
    return cleaned;
  }

  private cleanOpportunityText(text?: string): string {
    if (!text) return 'page loading and mobile layout';
    let cleaned = text.trim();
    cleaned = cleaned.replace(/^streamline mobile asset delivery and script loading for faster page speed\.?/i, 'speeding up mobile asset and script loading');
    cleaned = cleaned.replace(/^optimize asset delivery, compression, and script execution for faster page speed\.?/i, 'asset compression and page loading');
    cleaned = cleaned.replace(/\.+$/, '');
    return cleaned;
  }

  private generateVariantA(params: {
    businessName: string;
    city: string;
    niche: string;
    website?: string | null;
    salesAngle: import('../../../types/index.js').DetailedSalesAngle;
    greeting: string;
    sender: { name: string; company: string };
    hasNoWebsite: boolean;
    isBlocked: boolean;
  }) {
    const { businessName, greeting, salesAngle, sender, hasNoWebsite } = params;

    const subjects = [
      `Quick question regarding ${businessName}`,
      `Quick website note for ${businessName}`,
      `Observation for ${businessName}`,
    ];

    const isDental = Boolean(
      params.niche &&
      (params.niche.toLowerCase().includes('dent') ||
        params.niche.toLowerCase().includes('orthodont') ||
        params.niche.toLowerCase().includes('oral'))
    );
    const audienceTerm = isDental ? 'patients' : 'visitors and customers';

    const evidence = this.cleanEvidenceText(salesAngle.evidence[0]);
    const opportunity = this.cleanOpportunityText(salesAngle.opportunity);
    const signature = this.formatSignature(sender);

    let body = '';
    if (hasNoWebsite) {
      body = `${greeting}

I was looking up ${params.niche} services in ${params.city} and couldn't identify an official website for ${businessName}.

I build clean, mobile-friendly websites that make it easy for local clients to find your services and get in touch.

Would you be open to seeing a quick concept preview for ${businessName}?

Best regards,

${signature}`;
    } else {
      const lowerEvidence = evidence.charAt(0).toLowerCase() + evidence.slice(1);
      body = `${greeting}

I was taking a look at ${businessName}'s website and noticed ${lowerEvidence}.

A few small adjustments around ${opportunity.toLowerCase()} could help create a smoother mobile experience for ${audienceTerm}.

If helpful, I can send over a short breakdown of what I found.

Best regards,

${signature}`;
    }

    return {
      variant: 'VARIANT_A_SHORT' as const,
      subject: subjects[0],
      subjectVariants: subjects,
      body: body.trim(),
    };
  }

  private generateVariantB(params: {
    businessName: string;
    city: string;
    niche: string;
    website?: string | null;
    salesAngle: import('../../../types/index.js').DetailedSalesAngle;
    greeting: string;
    sender: { name: string; company: string };
    hasNoWebsite: boolean;
    isBlocked: boolean;
  }) {
    const { businessName, greeting, salesAngle, sender, hasNoWebsite } = params;

    const subjects = [
      `Website observation for ${businessName}`,
      `A few quick ideas for ${businessName}'s web presence`,
      `Question for ${businessName}`,
    ];

    const isDental = Boolean(
      params.niche &&
      (params.niche.toLowerCase().includes('dent') ||
        params.niche.toLowerCase().includes('orthodont') ||
        params.niche.toLowerCase().includes('oral'))
    );
    const clientTerm = isDental ? 'patients' : 'homeowners and customers';

    const evidence = this.cleanEvidenceText(salesAngle.evidence[0]);
    const opportunity = this.cleanOpportunityText(salesAngle.opportunity);
    const signature = this.formatSignature(sender);

    let body = '';
    if (hasNoWebsite) {
      body = `${greeting}

I hope your week is going well. I was researching local ${params.niche} practices in ${params.city} and couldn't identify an official website for ${businessName}.

Having a fast, simple online presence makes it much easier for new ${clientTerm} to check your hours, see services, and request appointments.

I work with local businesses to design straightforward, professional websites without complicated upkeep.

Would you be open to me sending over a short outline of what a modern site setup would look like for ${businessName}?

Best regards,

${signature}`;
    } else {
      const lowerEvidence = evidence.charAt(0).toLowerCase() + evidence.slice(1);
      body = `${greeting}

I was reviewing ${businessName}'s online presence and noticed ${lowerEvidence}.

${salesAngle.businessImpact}

I work on website performance and mobile usability for local businesses. If helpful, I'd be happy to share a brief summary of the specific fixes.

Would you be open to taking a look?

Best regards,

${signature}`;
    }

    return {
      variant: 'VARIANT_B_STANDARD' as const,
      subject: subjects[0],
      subjectVariants: subjects,
      body: body.trim(),
    };
  }

  private generateVariantC(params: {
    businessName: string;
    city: string;
    niche: string;
    website?: string | null;
    salesAngle: import('../../../types/index.js').DetailedSalesAngle;
    greeting: string;
    sender: { name: string; company: string };
    hasNoWebsite: boolean;
    isBlocked: boolean;
    audit: import('../../../types/index.js').PersonalizationContext['audit'];
  }) {
    const { businessName, greeting, salesAngle, sender, hasNoWebsite, audit } = params;

    const subjects = [
      `Audit findings & ideas for ${businessName}`,
      `Detailed website review for ${businessName}`,
      `Notes on ${businessName}'s mobile performance`,
    ];

    const signature = this.formatSignature(sender);

    let body = '';
    if (hasNoWebsite) {
      body = `${greeting}

I was conducting research on ${params.niche} providers in ${params.city} and couldn't identify an official website for ${businessName}.

For local service businesses, having an accessible web presence is essential for:
 • Displaying clear service lists and contact details for smartphone searchers
 • Enabling easy direct inquiry and appointment request workflows
 • Providing a professional hub for Google Maps and local search traffic

I specialize in building clean, high-performing websites for local businesses. Would you be open to a quick 5-minute conversation or a sample design preview this week?

Best regards,

${signature}`;
    } else {
      const evidenceBullets = salesAngle.evidence
        .slice(0, 3)
        .map((e) => ` • ${this.cleanEvidenceText(e)}`)
        .join('\n');

      body = `${greeting}

While reviewing websites for ${params.niche} practices in ${params.city}, I ran a technical inspection on ${businessName}'s site and noted a few specific items:

${evidenceBullets}

${salesAngle.businessImpact}

I specialize in technical website optimization and mobile usability. Rather than pitching a complete overhaul, I focus on resolving specific points like these to help improve the visitor experience.

If helpful, I can send over a short breakdown of what I found.

Best regards,

${signature}`;
    }

    return {
      variant: 'VARIANT_C_AUDIT' as const,
      subject: subjects[0],
      subjectVariants: subjects,
      body: body.trim(),
    };
  }

  private calculatePersonalizationScore(params: {
    context: PersonalizationContext;
    salesAngle: import('../../../types/index.js').DetailedSalesAngle;
    qualityCheck: import('../../../types/index.js').OutreachQualityCheck;
  }): number {
    let score = 0;

    // 1. Specific business reference (+20)
    if (params.context.business.name && params.context.business.name.length > 2) score += 20;

    // 2. Specific observed problem (+25)
    if (params.salesAngle.problem && params.salesAngle.problem.length > 5) score += 25;

    // 3. Evidence-backed observation (+20)
    if (params.salesAngle.evidence && params.salesAngle.evidence.length > 0) score += 20;

    // 4. Relevant service recommendation (+15)
    if (params.salesAngle.recommendedService) score += 15;

    // 5. Natural CTA (+10)
    score += 10;

    // 6. Contact-aware greeting (+5)
    if (params.context.contact.contactName || params.context.contact.classification) score += 5;

    // 7. Quality guard bonus / penalty
    if (params.qualityCheck.passed) score += 5;
    else score -= 20;

    return Math.min(100, Math.max(0, score));
  }
}
