import { PrismaClient, CampaignRun } from '@prisma/client';
import { getPrismaClient } from '../../database/client.js';
import { logger } from '../../utils/logger.js';

export type CampaignRunState =
  | 'CREATED'
  | 'DISCOVERING'
  | 'AUDITING'
  | 'SCORING'
  | 'CONTACT_DISCOVERY'
  | 'PERSONALIZING'
  | 'REVIEW_READY'
  | 'COMPLETED'
  | 'PARTIAL_FAILURE'
  | 'FAILED';

export interface CampaignProgressCounts {
  target?: number;
  discovered?: number;
  normalized?: number;
  websitesFound?: number;
  audited?: number;
  auditFailed?: number;
  hot?: number;
  warm?: number;
  cold?: number;
  emailContactable?: number;
  phoneContactable?: number;
  draftsGenerated?: number;
  reviewRequired?: number;
  approved?: number;
  sent?: number;
  replied?: number;
  positiveReplies?: number;
}

export class CampaignRunService {
  private db: PrismaClient;
  private log = logger.child('CampaignRunService');

  constructor(customDb?: PrismaClient) {
    this.db = customDb || getPrismaClient();
  }

  /**
   * Starts a new tracked campaign run.
   */
  public async startRun(campaignId: string, target: number = 0): Promise<CampaignRun> {
    const run = await this.db.campaignRun.create({
      data: {
        campaignId,
        status: 'CREATED',
        target,
        startedAt: new Date(),
      },
    });

    this.log.info(`Started CampaignRun [${run.id}] for campaign [${campaignId}] (Target: ${target}).`);
    return run;
  }

  /**
   * Updates current execution stage and optional incremental counts.
   */
  public async updateRunStage(
    runId: string,
    status: CampaignRunState,
    progressUpdates?: Partial<CampaignProgressCounts>
  ): Promise<CampaignRun> {
    const run = await this.db.campaignRun.update({
      where: { id: runId },
      data: {
        status,
        ...(progressUpdates || {}),
      },
    });

    this.log.debug(`CampaignRun [${runId}] stage transitioned to "${status}".`);
    return run;
  }

  /**
   * Persists actual discovered/processed metric counts without fabricating progress.
   */
  public async recordProgress(
    runId: string,
    updates: Partial<CampaignProgressCounts>
  ): Promise<CampaignRun> {
    const run = await this.db.campaignRun.update({
      where: { id: runId },
      data: updates,
    });

    return run;
  }

  /**
   * Finalizes the campaign run with completion timestamp and outcome.
   */
  public async completeRun(
    runId: string,
    status: 'COMPLETED' | 'PARTIAL_FAILURE' | 'FAILED' = 'COMPLETED',
    errorMessage?: string
  ): Promise<CampaignRun> {
    const run = await this.db.campaignRun.update({
      where: { id: runId },
      data: {
        status,
        errorMessage: errorMessage || null,
        completedAt: new Date(),
      },
    });

    this.log.info(`CampaignRun [${runId}] finished with status "${status}".`);
    return run;
  }

  /**
   * Retrieves latest run for a campaign or overall.
   */
  public async getLatestRun(campaignId?: string): Promise<CampaignRun | null> {
    const where = campaignId ? { campaignId } : {};
    return await this.db.campaignRun.findFirst({
      where,
      orderBy: { startedAt: 'desc' },
    });
  }

  /**
   * Retrieves run by ID.
   */
  public async getRun(runId: string): Promise<CampaignRun | null> {
    return await this.db.campaignRun.findUnique({
      where: { id: runId },
      include: { campaign: true },
    });
  }

  /**
   * Lists runs with optional campaign filtering.
   */
  public async listRuns(campaignId?: string, limit: number = 20): Promise<CampaignRun[]> {
    const where = campaignId ? { campaignId } : {};
    return await this.db.campaignRun.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: limit,
      include: { campaign: true },
    });
  }
}

export const campaignRunService = new CampaignRunService();
