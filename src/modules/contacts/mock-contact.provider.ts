import { ContactDiscoveryProvider, DiscoveredContactInput } from '../../types/index.js';
import { logger } from '../../utils/logger.js';

/**
 * Mock contact discovery provider.
 * Extracts or generates safe mock public contacts for testing without scraping external websites.
 */
export class MockContactDiscoveryProvider implements ContactDiscoveryProvider {
  public readonly providerName = 'MockContactDiscoveryProvider';
  private log = logger.child('Contacts');

  public async findContacts(
    businessName: string,
    website?: string
  ): Promise<DiscoveredContactInput[]> {
    this.log.info(`Discovering public contacts for "${businessName}" (Provider: ${this.providerName})`);

    const domain = website
      ? website.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase()
      : 'example-business.com';

    const cleanName = businessName.toLowerCase().replace(/[^a-z0-9]/g, '');

    const contacts: DiscoveredContactInput[] = [
      {
        email: `contact@${domain}`,
        contactName: `${businessName} Team`,
        role: 'General Inquiries',
        source: 'public_directory_listing',
        isVerified: true,
        isPublic: true,
      },
      {
        email: `owner@${cleanName}.com`,
        contactName: 'Business Owner',
        role: 'Owner/Founder',
        source: 'public_business_registry',
        isVerified: false,
        isPublic: true,
      },
    ];

    this.log.info(`Found ${contacts.length} candidate contacts for ${businessName}.`);
    return contacts;
  }
}
