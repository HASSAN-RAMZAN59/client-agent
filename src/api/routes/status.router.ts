import { Router, Request, Response } from 'express';
import { systemStatusService, HealthService } from '../../services/index.js';
import { logger } from '../../utils/logger.js';

export const statusRouter = Router();
const log = logger.child('StatusRouter');

/**
 * GET /api/status
 * Returns operational summary: database size, counts, provider status, safety flags, and latest run.
 */
statusRouter.get('/status', async (_req: Request, res: Response) => {
  try {
    const summary = await systemStatusService.getStatusSummary();
    res.json({
      status: 'success',
      data: summary,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    log.error('Failed to get status summary', { error: error?.message });
    res.status(500).json({
      status: 'error',
      message: error?.message || 'Internal status error',
    });
  }
});

/**
 * GET /api/health
 * Returns granular component health (Prisma, SQLite, Playwright, SMTP, Discovery, Policy; 0 sends).
 */
statusRouter.get('/health', async (_req: Request, res: Response) => {
  try {
    const health = await HealthService.getStatus();
    res.json({
      status: 'success',
      data: health,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    log.error('Failed to get health status', { error: error?.message });
    res.status(500).json({
      status: 'error',
      message: error?.message || 'Internal health error',
    });
  }
});
