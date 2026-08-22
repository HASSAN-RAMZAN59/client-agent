import { PersonalizationContext } from '../../../types/index.js';
import { extractDomain } from '../../../utils/url-utils.js';

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

    // 1. Business Name Presence
    if (!context.business.name || context.business.name.trim().length < 2) {
      reasons.push('Business name is missing or too short.');
    }

    // 2. Contact Availability
    if (!recipientContactValue || recipientContactValue === 'NONE_FOUND' || recipientContactType === 'NONE') {
      reasons.push('No valid contact information associated with this business draft.');
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
