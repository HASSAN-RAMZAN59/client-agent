import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { createDatabaseBackup, calculateFileChecksum } from '../../database/backup.js';
import { restoreDatabase } from '../../database/restore.js';
import { activityLogService } from '../../services/index.js';
import { logger } from '../../utils/logger.js';

export const databaseRouter = Router();
const log = logger.child('DatabaseRouter');

/**
 * GET /api/database/backups
 * Lists all existing backups in the backend-controlled backups/ directory.
 */
databaseRouter.get('/database/backups', async (_req: Request, res: Response) => {
  try {
    const backupsDir = path.resolve(process.cwd(), 'backups');
    if (!fs.existsSync(backupsDir)) {
      return res.json({ status: 'success', data: [] });
    }

    const files = fs.readdirSync(backupsDir).filter((f) => f.endsWith('.db'));
    const items = files.map((file) => {
      const fullPath = path.join(backupsDir, file);
      const stat = fs.statSync(fullPath);
      let checksum = 'pending';
      try {
        checksum = calculateFileChecksum(fullPath);
      } catch {}

      return {
        filename: file,
        sizeBytes: stat.size,
        createdAt: stat.birthtime || stat.mtime,
        checksum,
      };
    });

    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.json({
      status: 'success',
      data: items,
    });
  } catch (error: any) {
    log.error('Failed to list backups', { error: error?.message });
    res.status(500).json({ status: 'error', message: error?.message || 'Failed to list backups' });
  }
});

/**
 * POST /api/database/backup
 * Creates an atomic snapshot of the SQLite database.
 */
databaseRouter.post('/database/backup', async (_req: Request, res: Response) => {
  try {
    const result = await createDatabaseBackup();

    await activityLogService.logEvent({
      eventType: 'CAMPAIGN_STARTED', // Generic system event
      entityType: 'SYSTEM',
      metadata: {
        action: 'DATABASE_BACKUP',
        backupPath: path.basename(result.backupPath),
        checksum: result.checksum,
        sizeBytes: result.sizeBytes,
      },
    });

    res.json({
      status: 'success',
      data: {
        filename: path.basename(result.backupPath),
        path: result.backupPath,
        checksum: result.checksum,
        sizeBytes: result.sizeBytes,
        timestamp: result.timestamp,
      },
    });
  } catch (error: any) {
    log.error('Failed to create database backup', { error: error?.message });
    res.status(500).json({ status: 'error', message: error?.message || 'Failed to create backup' });
  }
});

/**
 * POST /api/database/restore
 * Safely restores the database from an existing backup in backups/.
 * Requires explicit typing of confirmation token "RESTORE".
 */
databaseRouter.post('/database/restore', async (req: Request, res: Response) => {
  try {
    const { filename, confirmationToken } = req.body;

    if (!filename || typeof filename !== 'string') {
      return res.status(400).json({ status: 'error', message: 'Backup filename is required' });
    }

    if (confirmationToken !== 'RESTORE') {
      return res.status(400).json({
        status: 'error',
        message: 'Confirmation token "RESTORE" is strictly required to execute database restore.',
      });
    }

    // Strictly validate filename to prevent path traversal
    const cleanFilename = path.basename(filename);
    const backupsDir = path.resolve(process.cwd(), 'backups');
    const targetBackupPath = path.join(backupsDir, cleanFilename);

    if (!fs.existsSync(targetBackupPath)) {
      return res.status(404).json({
        status: 'error',
        message: `Backup file "${cleanFilename}" not found in backups directory.`,
      });
    }

    const result = await restoreDatabase({
      backupFilePath: targetBackupPath,
      confirmationToken: 'RESTORE',
    });

    res.json({
      status: 'success',
      data: {
        restoredFrom: cleanFilename,
        checksum: result.checksum,
        preRestoreBackup: path.basename(result.preRestoreBackupPath),
        timestamp: result.timestamp,
        message: 'Database successfully restored.',
      },
    });
  } catch (error: any) {
    log.error('Failed to restore database', { error: error?.message });
    res.status(500).json({ status: 'error', message: error?.message || 'Failed to restore database' });
  }
});
