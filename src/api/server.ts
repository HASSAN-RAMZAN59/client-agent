import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { statusRouter } from './routes/status.router.js';
import { campaignsRouter } from './routes/campaigns.router.js';
import { leadsRouter } from './routes/leads.router.js';
import { reviewRouter } from './routes/review.router.js';
import { pilotRouter } from './routes/pilot.router.js';
import { phoneLeadsRouter } from './routes/phone-leads.router.js';
import { repliesRouter } from './routes/replies.router.js';
import { analyticsRouter } from './routes/analytics.router.js';
import { activityRouter } from './routes/activity.router.js';
import { databaseRouter } from './routes/database.router.js';
import { settingsRouter } from './routes/settings.router.js';
import { logger } from '../utils/logger.js';

const log = logger.child('ApiServer');

/**
 * Creates and configures the Express dashboard application.
 */
export function createApp(): Express {
  const app = express();

  // Basic middleware
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Request logger (clean, no secrets)
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (!req.path.startsWith('/assets')) {
      log.debug(`${req.method} ${req.path}`);
    }
    next();
  });

  // REST API Routes
  app.use('/api', statusRouter);
  app.use('/api', campaignsRouter);
  app.use('/api', leadsRouter);
  app.use('/api', reviewRouter);
  app.use('/api', pilotRouter);
  app.use('/api', phoneLeadsRouter);
  app.use('/api', repliesRouter);
  app.use('/api', analyticsRouter);
  app.use('/api', activityRouter);
  app.use('/api', databaseRouter);
  app.use('/api', settingsRouter);

  // Serve static UI bundle if built
  const possibleUiPaths = [
    path.resolve(process.cwd(), 'dist-dashboard'),
    path.resolve(process.cwd(), 'dashboard', 'dist'),
  ];

  let staticUiPath: string | null = null;
  for (const p of possibleUiPaths) {
    if (fs.existsSync(p)) {
      staticUiPath = p;
      break;
    }
  }

  // 404 handler for unmatched API routes
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({
      status: 'error',
      message: 'API endpoint not found',
    });
  });

  if (staticUiPath) {
    app.use(express.static(staticUiPath));
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method === 'GET' && !req.path.startsWith('/api')) {
        return res.sendFile(path.join(staticUiPath!, 'index.html'));
      }
      next();
    });
  }

  // Global error handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    log.error('Unhandled API exception', { error: err?.message });
    res.status(500).json({
      status: 'error',
      message: err?.message || 'Internal server error',
    });
  });

  return app;
}

/**
 * Starts the Dashboard HTTP server.
 * Binds strictly to 127.0.0.1 by default for operator safety.
 */
export function startServer(port: number = 3000, host: string = '127.0.0.1') {
  if (host !== '127.0.0.1' && host !== 'localhost') {
    console.warn('\n======================================================================');
    console.warn('⚠️ WARNING: REMOTE_BIND_REQUIRES_SECURITY_REVIEW');
    console.warn(`Dashboard bound to non-local address: ${host}:${port}`);
    console.warn('Authentication and TLS verification required for remote access.');
    console.warn('======================================================================\n');
  }

  const app = createApp();
  const server = app.listen(port, host, () => {
    console.log(`\n======================================================================`);
    console.log(`🚀 OPERATOR DASHBOARD API READY AT: http://${host}:${port}`);
    console.log(`   Local Operator Single-User Mode (No Public Exposure)`);
    console.log(`   Health Endpoint: http://${host}:${port}/api/health`);
    console.log(`   Status Endpoint: http://${host}:${port}/api/status`);
    console.log(`======================================================================\n`);
  });

  return server;
}

// Standalone execution entrypoint
if (process.argv[1] && process.argv[1].endsWith('server.ts')) {
  const port = parseInt(process.env.PORT || '3000', 10);
  const host = process.env.HOST || '127.0.0.1';
  startServer(port, host);
}
