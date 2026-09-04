import { Router, Request, Response } from 'express';
import { activityLogService } from '../../services/index.js';
import { logger } from '../../utils/logger.js';

export const activityRouter = Router();
const log = logger.child('ActivityRouter');

/**
 * GET /api/activity
 * Fetches chronological sanitized audit log feed.
 */
activityRouter.get('/activity', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 50));
    const eventType = req.query.eventType as string | undefined;
    const entityType = req.query.entityType as string | undefined;

    const events = await activityLogService.getRecentEvents(limit, {
      eventType,
      entityType,
    });

    const parsedEvents = events.map((e) => {
      let meta: any = null;
      if (e.metadata) {
        try {
          meta = JSON.parse(e.metadata);
        } catch {
          meta = e.metadata;
        }
      }
      return {
        id: e.id,
        timestamp: e.timestamp,
        eventType: e.eventType,
        entityType: e.entityType,
        entityId: e.entityId,
        actor: e.actor,
        metadata: meta,
      };
    });

    res.json({
      status: 'success',
      data: {
        total: parsedEvents.length,
        items: parsedEvents,
      },
    });
  } catch (error: any) {
    log.error('Failed to get activity events', { error: error?.message });
    res.status(500).json({ status: 'error', message: error?.message || 'Failed to query activity logs' });
  }
});
