import { PersonalizationContext } from '../../../types/index.js';
import { extractDomain } from '../../../utils/url-utils.js';
import { validateBusinessIdentity } from '../../discovery/identity-validator.js';

export interface BusinessIdentityValidationResult {
  valid: boolean;
  reasons: string[];
  warnings: string[];
}

export class BusinessIdentityValidator {
  public static validate(
    recipientContactValue: string | null | undefined,
    recipientContactType: string | null | undefined,
    context: PersonalizationContext
  ): BusinessIdentityValidationResult {
    const reasons: string[] = [];
    const warnings: string[] = [];

    // 1. Business Name Presence & Safety
    const name = context.business.name ? context.business.name.trim() : '';
    if (!name || name.length < 2) {
      reasons.push('Business name is missing or too short.');
    }

    // 1b. Reject Unsafe / SEO Search Titles as Business Name
    const identityCheck = validateBusinessIdentity(name, {
      city: context.business.city,
      niche: context.business.category,
    });
    if (identityCheck.isUnsafe) {
      reasons.push(`BUSINESS_IDENTITY_UNSAFE: Business name "${name}" appears to be an unverified SEO/search title (${identityCheck.reason}).`);
    }

    const unsafeIdentityRegexes = [
      /^(?:dentist|dentists|dentistry|dental|hvac|plumber|plumbing|doctor|lawyer|attorney|roofing|electrician|cleaning)\s+in\s+[a-zA-Z\s,.-]+$/i,
      /^[a-zA-Z\s,.-]+,\s*(?:TX|CA|NY|FL|IL|PA|OH|GA|NC|MI|NJ|VA|WA|AZ|MA|TN|IN|MO|MD|WI|CO|MN|SC|AL|LA|KY|OR|OK|CT|UT|IA|NV|AR|MS|KS|NM|NE|ID|WV|HI|NH|ME|MT|RI|DE|SD|ND|AK|DC|USA)\s+(?:dentists?|dentistry|hvac|plumbers?|doctors?|lawyers?|attorneys?|services)$/i,
      /^(?:dentist|dentistry|dental|hvac|plumber|doctor|lawyer)\s+near\s+me$/i,
      /^(?:best|top|affordable|emergency|cheap)\s+(?:dentists?|hvac|plumbers?|doctors?)\s+in\s+[a-zA-Z\s,.-]+$/i,
    ];

    for (const rx of unsafeIdentityRegexes) {
      if (rx.test(name) && !reasons.some((r) => r.includes('BUSINESS_IDENTITY_UNSAFE'))) {
        reasons.push(`BUSINESS_IDENTITY_UNSAFE: Business name "${name}" appears to be an unverified SEO/search title.`);
        break;
      }
    }

    // 2. Contact Availability & Provenance Safety
    if (
      !recipientContactValue ||
      recipientContactValue === 'NONE_FOUND' ||
      recipientContactType === 'NONE' ||
      recipientContactType === 'PLATFORM_CONTACT'
    ) {
      if (recipientContactType === 'PLATFORM_CONTACT') {
        reasons.push('PLATFORM_CONTACT_PROHIBITED: Cannot send outreach to platform or directory contacts.');
      } else {
        reasons.push('No valid contact information associated with this business draft.');
      }
      return {
        valid: false,
        reasons,
        warnings,
      };
    }

    // 3. Email Domain Association
    if (recipientContactType === 'EMAIL' && recipientContactValue.includes('@')) {
      const emailDomain = recipientContactValue.split('@')[1]?.toLowerCase().trim();
      const websiteDomain = context.business.website ? extractDomain(context.business.website)?.toLowerCase() : null;

      const freeProviders = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com'];

      if (websiteDomain && emailDomain && !freeProviders.includes(emailDomain)) {
        if (!emailDomain.includes(websiteDomain) && !websiteDomain.includes(emailDomain)) {
          // Subdomain or variation check
          const normalizedEmailDomain = emailDomain.replace(/^www\./, '');
          const normalizedWebDomain = websiteDomain.replace(/^www\./, '');

          if (normalizedEmailDomain !== normalizedWebDomain) {
            warnings.push(
              `Email domain "${emailDomain}" does not exactly match official website domain "${websiteDomain}".`
            );
          }
        }
      }
    }

    return {
      valid: reasons.length === 0,
      reasons,
      warnings,
    };
  }
}
