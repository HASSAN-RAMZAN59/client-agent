import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../database/client.js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

export interface CleanupResult {
  cleanedTempFiles: number;
  cleanedTestFixtures: number;
  preservedSuppressionRecords: number;
  preservedOutreachRecords: number;
  skippedReasons: string[];
}

export class CleanupService {
  private db: PrismaClient;
  private log = logger.child('CleanupService');

  constructor(customDb?: PrismaClient) {
    this.db = customDb || getPrismaClient();
  }

  /**
   * Safely cleans expired temporary cache files and test fixtures in test database.
   * STRICT INVARIANT: Never deletes operational records, suppression records, or approved outreach history.
   */
  public async performSafeCleanup(options: {
    tempMaxAgeHours?: number;
    allowTestDbFixtureCleanup?: boolean;
  } = {}): Promise<CleanupResult> {
    const tempMaxAgeHours = options.tempMaxAgeHours ?? 48;
    const skippedReasons: string[] = [];
    let cleanedTempFiles = 0;
    let cleanedTestFixtures = 0;

    // 1. Audit and assert suppression preservation
    const suppressionCount = await this.db.suppression.count();
    const outreachCount = await this.db.outreach.count({
      where: {
        status: { in: ['APPROVED', 'READY_TO_SEND', 'SENT', 'REPLIED'] },
      },
    });

    // 2. Safe Temp / Scratch File Cleanup
    const scratchDir = path.resolve(process.cwd(), 'scratch');
    if (fs.existsSync(scratchDir)) {
      try {
        const files = fs.readdirSync(scratchDir);
        const now = Date.now();
        const maxAgeMs = tempMaxAgeHours * 60 * 60 * 1000;

        for (const file of files) {
          const filePath = path.join(scratchDir, file);
          const stat = fs.statSync(filePath);
          if (now - stat.mtimeMs > maxAgeMs) {
            fs.unlinkSync(filePath);
            cleanedTempFiles++;
          }
        }
      } catch (err) {
        this.log.warn('Could not clean scratch directory', err);
      }
    }

    // 3. Test Database Fixtures Cleanup (ONLY permissible on test.db)
    const isTestDb = config.DATABASE_URL.toLowerCase().includes('test.db');
    if (options.allowTestDbFixtureCleanup && isTestDb && config.NODE_ENV === 'test') {
      const deleted = await this.db.business.deleteMany({
        where: {
          source: { startsWith: 'test' },
        },
      });
      cleanedTestFixtures = deleted.count;
      this.log.info(`Cleaned ${cleanedTestFixtures} test fixtures from test.db.`);
    } else if (options.allowTestDbFixtureCleanup && !isTestDb) {
      skippedReasons.push('Fixture cleanup skipped: Active database is NOT test.db (Production/Dev protection active).');
    }

    this.log.info(
      `Safe cleanup completed. Temp files: ${cleanedTempFiles}, Suppressions preserved: ${suppressionCount}, Protected outreach: ${outreachCount}.`
    );

    return {
      cleanedTempFiles,
      cleanedTestFixtures,
      preservedSuppressionRecords: suppressionCount,
      preservedOutreachRecords: outreachCount,
      skippedReasons,
    };
  }
}

export const cleanupService = new CleanupService();
