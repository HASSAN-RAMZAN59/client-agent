import { checkDatabaseHealth } from '../database/client.js';
import { config } from '../config/env.js';
import { SystemHealthStatus } from '../types/index.js';

export class HealthService {
  public static async getStatus(): Promise<SystemHealthStatus> {
    const dbHealth = await checkDatabaseHealth();

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (!dbHealth.connected) {
      status = 'unhealthy';
    }

    return {
      status,
      version: '0.2.5 (Phase 2 Hardened)',
      nodeVersion: process.version,
      environment: config.NODE_ENV,
      database: dbHealth,
      configuration: {
        valid: true,
        dryRun: config.DRY_RUN,
        maxItemsPerRun: config.MAX_ITEMS_PER_RUN,
        requestDelayMs: config.REQUEST_DELAY_MS,
        discoveryOsmEnabled: config.DISCOVERY_OSM_ENABLED,
        discoveryDdgEnabled: config.DISCOVERY_DDG_ENABLED,
        maxSourceRequestPerRun: config.MAX_SOURCE_REQUESTS_PER_RUN,
      },
    };
  }
}
