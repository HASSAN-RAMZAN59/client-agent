import { AuditFinding } from '../../../types/index.js';

export interface UxConversionAnalysisInput {
  hasClickablePhone: boolean;
  hasVisiblePhoneText: boolean;
  hasContactForm: boolean;
  hasBookingCta: boolean;
  hasQuoteCta: boolean;
  hasContactCta: boolean;
  hasPhysicalAddress: boolean;
  hasBusinessHours: boolean;
  hasSocialLinks: boolean;
}

export interface UxConversionAnalysisResult {
  score: number;
  hasContactForm: boolean;
  findings: AuditFinding[];
}

export function analyzeUxConversion(input: UxConversionAnalysisInput): UxConversionAnalysisResult {
  const findings: AuditFinding[] = [];
  let score = 100;

  // 1. Phone number visibility
  if (!input.hasClickablePhone && !input.hasVisiblePhoneText) {
    score -= 30;
    findings.push({
      category: 'ux',
      title: 'Missing Direct Call-to-Action / Phone',
      description: 'No visible phone number or click-to-call link found on the homepage.',
      severity: 'HIGH',
      evidence: 'No tel: link or phone pattern detected on page',
    });
  } else if (!input.hasClickablePhone && input.hasVisiblePhoneText) {
    score -= 10;
    findings.push({
      category: 'ux',
      title: 'Phone Number Not Click-to-Call Enabled',
      description: 'A phone number is displayed in plain text without a `<a href="tel:...">` link, hurting mobile conversions.',
      severity: 'LOW',
      evidence: 'Plaintext phone pattern found without tel: link',
    });
  }

  // 2. Conversion CTAs (Booking / Quote / Contact)
  const hasAnyCta = input.hasBookingCta || input.hasQuoteCta || input.hasContactCta;
  if (!hasAnyCta) {
    score -= 35;
    findings.push({
      category: 'ux',
      title: 'No Clear Conversion Call-to-Action (CTA)',
      description: 'The homepage lacks clear action buttons (e.g. "Book Appointment", "Request Quote", "Contact Us").',
      severity: 'HIGH',
      evidence: 'No primary conversion button/action found',
    });
  }

  // 3. Contact Form
  if (!input.hasContactForm) {
    score -= 15;
    findings.push({
      category: 'ux',
      title: 'Missing Direct Lead/Contact Form',
      description: 'No online contact/inquiry form found on the primary landing page.',
      severity: 'MEDIUM',
      evidence: '<form> with contact/message input fields not detected',
    });
  }

  // 4. Physical Location / Hours
  if (!input.hasPhysicalAddress) {
    score -= 10;
    findings.push({
      category: 'ux',
      title: 'Missing Physical Business Address',
      description: 'Local customers cannot immediately verify business location or service radius.',
      severity: 'LOW',
      evidence: 'No structured address elements or postal pattern detected',
    });
  }

  return {
    score: Math.max(0, score),
    hasContactForm: input.hasContactForm,
    findings,
  };
}
