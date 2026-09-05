import {
  ContactType,
  ContactClassification,
  ContactSourceType,
  DiscoveredContactRecord,
} from '../../../types/index.js';

export function calculateContactQualityScore(contact: {
  type: ContactType;
  classification: ContactClassification;
  sourceType: ContactSourceType;
}): number {
  if (contact.classification === 'PLATFORM_CONTACT') {
    return 0;
  }

  if (contact.sourceType === 'OFFICIAL_WEBSITE') {
    if (contact.type === 'EMAIL') {
      if (contact.classification === 'BUSINESS_GENERIC') return 100;
      if (contact.classification === 'BUSINESS_DEPARTMENT') return 90;
      if (contact.classification === 'BUSINESS_NAMED') return 85;
      return 75;
    }
    if (contact.type === 'PHONE') return 80;
    if (contact.type === 'CONTACT_FORM') return 70;
  }

  if (contact.sourceType === 'PUBLIC_LISTING' || contact.sourceType === 'PUBLIC_SEARCH') {
    if (contact.type === 'EMAIL') return 60;
    if (contact.type === 'PHONE') return 50;
  }

  return 20;
}

export function selectPrimaryContact(
  contacts: DiscoveredContactRecord[]
): DiscoveredContactRecord | undefined {
  // Never select a PLATFORM_CONTACT as primary contact for business outreach
  const eligible = contacts.filter((c) => c.classification !== 'PLATFORM_CONTACT');
  if (eligible.length === 0) return undefined;

  // Sorting priority:
  // 1. OFFICIAL_WEBSITE EMAIL (GENERIC > DEPARTMENT > NAMED > UNKNOWN)
  // 2. OFFICIAL_WEBSITE PHONE
  // 3. OFFICIAL_WEBSITE CONTACT_FORM
  // 4. PUBLIC_LISTING / PUBLIC_SEARCH EMAIL
  // 5. PUBLIC_LISTING / PUBLIC_SEARCH PHONE
  // 6. OTHER
  const getRank = (c: DiscoveredContactRecord): number => {
    if (c.sourceType === 'OFFICIAL_WEBSITE') {
      if (c.type === 'EMAIL') {
        if (c.classification === 'BUSINESS_GENERIC') return 10;
        if (c.classification === 'BUSINESS_DEPARTMENT') return 20;
        if (c.classification === 'BUSINESS_NAMED') return 30;
        return 40;
      }
      if (c.type === 'PHONE') return 50;
      if (c.type === 'CONTACT_FORM') return 60;
    }

    if (c.sourceType === 'PUBLIC_LISTING' || c.sourceType === 'PUBLIC_SEARCH') {
      if (c.type === 'EMAIL') return 70;
      if (c.type === 'PHONE') return 80;
    }

    return 100;
  };

  const sorted = [...eligible].sort((a, b) => getRank(a) - getRank(b));
  return sorted[0];
}
