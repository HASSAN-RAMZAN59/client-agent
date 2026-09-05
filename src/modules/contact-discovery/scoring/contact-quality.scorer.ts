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
  if (
    contact.classification === 'PLATFORM_CONTACT' ||
    contact.classification === 'UNVERIFIED_CONTACT'
  ) {
    return 0;
  }

  if (contact.classification === 'OFFICIAL_SITE_EMAIL') return 100;
  if (contact.classification === 'OSM_PUBLIC_EMAIL') return 85;
  if (contact.classification === 'OFFICIAL_SITE_PHONE') return 80;
  if (contact.classification === 'OSM_PUBLIC_PHONE') return 75;
  if (contact.type === 'CONTACT_FORM') return 70;
  if (contact.classification === 'VERIFIED_BUSINESS_LISTING_PHONE') return 50;
  if (contact.classification === 'SOCIAL_PROFILE_PHONE') return 40;

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
  // Never select PLATFORM_CONTACT or UNVERIFIED_CONTACT as primary contact
  const eligible = contacts.filter(
    (c) => c.classification !== 'PLATFORM_CONTACT' && c.classification !== 'UNVERIFIED_CONTACT'
  );
  if (eligible.length === 0) return undefined;

  // Sorting priority:
  // 1. Official website email (OFFICIAL_SITE_EMAIL)
  // 2. OSM public email (OSM_PUBLIC_EMAIL)
  // 3. Official website phone (OFFICIAL_SITE_PHONE)
  // 4. OSM public phone (OSM_PUBLIC_PHONE)
  // 5. Official contact form
  // 6. Verified listing phone
  // 7. Social profile phone
  // 8. Other
  const getRank = (c: DiscoveredContactRecord): number => {
    if (c.classification === 'OFFICIAL_SITE_EMAIL') return 10;
    if (c.sourceType === 'OFFICIAL_WEBSITE' && c.type === 'EMAIL') {
      if (c.classification === 'BUSINESS_GENERIC') return 12;
      if (c.classification === 'BUSINESS_DEPARTMENT') return 14;
      if (c.classification === 'BUSINESS_NAMED') return 16;
      return 18;
    }
    if (c.classification === 'OSM_PUBLIC_EMAIL') return 20;
    if (c.classification === 'OFFICIAL_SITE_PHONE') return 30;
    if (c.sourceType === 'OFFICIAL_WEBSITE' && c.type === 'PHONE') return 32;
    if (c.classification === 'OSM_PUBLIC_PHONE') return 35;
    if (c.type === 'CONTACT_FORM') return 40;
    if (c.classification === 'VERIFIED_BUSINESS_LISTING_PHONE') return 50;
    if (c.classification === 'SOCIAL_PROFILE_PHONE') return 60;
    if (c.type === 'EMAIL') return 70;
    if (c.type === 'PHONE') return 80;
    return 100;
  };

  const sorted = [...eligible].sort((a, b) => getRank(a) - getRank(b));
  return sorted[0];
}
