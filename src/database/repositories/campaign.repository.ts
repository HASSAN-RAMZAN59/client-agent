import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../client.js';
import { CampaignInput, CampaignRecord, CampaignStatus } from '../../types/index.js';
import { logger } from '../../utils/logger.js';

export class CampaignRepository {
  private db: PrismaClient;
  private log = logger.child('CampaignRepository');

  constructor(customDb?: PrismaClient) {
    this.db = customDb || getPrismaClient();
  }

  public async createCampaign(input: CampaignInput): Promise<CampaignRecord> {
    const record = await this.db.campaign.create({
      data: {
        name: input.name.trim(),
        country: (input.country || 'US').toUpperCase(),
        state: input.state ? input.state.trim() : null,
        city: input.city.trim(),
        niche: input.niche.trim(),
        targetBusinesses: input.targetBusinesses ?? 100,
        minLeadScore: input.minLeadScore ?? 60.0,
        minContactQuality: input.minContactQuality ?? 0.0,
        maxDiscoveryPerRun: input.maxDiscoveryPerRun ?? 25,
        maxEmailsPerDay: input.maxEmailsPerDay ?? 20,
        targetWebsiteOpportunity: input.targetWebsiteOpportunity ?? 50.0,
        preferredService: input.preferredService ?? 'WEBSITE_REBUILD',
        status: 'ACTIVE',
      },
    });

    this.log.info(`Campaign created: "${record.name}" [${record.id}] (${record.city}, ${record.country} - ${record.niche})`);
    return record as CampaignRecord;
  }

  public async getCampaignById(id: string): Promise<CampaignRecord | null> {
    const record = await this.db.campaign.findUnique({
      where: { id },
    });
    return record as CampaignRecord | null;
  }

  public async getCampaignByName(name: string): Promise<CampaignRecord | null> {
    const record = await this.db.campaign.findUnique({
      where: { name: name.trim() },
    });
    return record as CampaignRecord | null;
  }

  public async listCampaigns(status?: CampaignStatus): Promise<CampaignRecord[]> {
    const where: any = {};
    if (status) {
      where.status = status;
    }

    const records = await this.db.campaign.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    return records as CampaignRecord[];
  }

  public async updateCampaign(id: string, data: Partial<CampaignRecord>): Promise<CampaignRecord> {
    const record = await this.db.campaign.update({
      where: { id },
      data: data as any,
    });
    return record as CampaignRecord;
  }

  public async assignBusinessesToCampaign(campaignId: string, businessIds: string[]): Promise<number> {
    if (businessIds.length === 0) return 0;

    const result = await this.db.business.updateMany({
      where: {
        id: { in: businessIds },
      },
      data: {
        campaignId,
      },
    });

    return result.count;
  }

  public async getCampaignBusinesses(campaignId: string): Promise<any[]> {
    return this.db.business.findMany({
      where: { campaignId },
      include: {
        audits: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        lead: {
          include: {
            outreach: true,
          },
        },
        contacts: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}

export const campaignRepository = new CampaignRepository();
