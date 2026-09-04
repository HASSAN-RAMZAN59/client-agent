import fs from 'fs';
import path from 'path';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { resolveDatabasePath, calculateFileChecksum, createDatabaseBackup } from './backup.js';

export interface RestoreParams {
  backupFilePath: string;
  confirmationToken: string;
  targetDbUrl?: string;
}

export interface RestoreResult {
  restoredFrom: string;
  targetPath: string;
  checksum: string;
  preRestoreBackupPath: string;
  timestamp: string;
}

/**
 * Restores a SQLite database from a specified backup file.
 * Requires explicit confirmation token "RESTORE" to prevent accidental data loss.
 * Automatically takes a pre-restore backup of the target database before overwriting.
 */
export async function restoreDatabase(params: RestoreParams): Promise<RestoreResult> {
  const log = logger.child('DatabaseRestore');

  if (params.confirmationToken !== 'RESTORE') {
    throw new Error(
      'Database restore aborted: Confirmation token "RESTORE" is strictly required (e.g. --confirm RESTORE).'
    );
  }

  const backupFilePath = path.resolve(process.cwd(), params.backupFilePath);
  if (!fs.existsSync(backupFilePath)) {
    throw new Error(`Database restore failed: Specified backup file "${backupFilePath}" does not exist.`);
  }

  const targetPath = resolveDatabasePath(params.targetDbUrl || config.DATABASE_URL);

  // Safety precondition: Create a snapshot of current DB before touching it if it exists
  let preRestoreBackupPath = 'none';
  if (fs.existsSync(targetPath)) {
    const preBackup = await createDatabaseBackup(params.targetDbUrl);
    preRestoreBackupPath = preBackup.backupPath;
    log.info(`Pre-restore safety snapshot created at "${preRestoreBackupPath}".`);
  }

  // Copy backup to target path atomically
  fs.copyFileSync(backupFilePath, targetPath);

  const checksum = calculateFileChecksum(targetPath);
  log.info(`Database successfully restored from "${backupFilePath}" to "${targetPath}" (SHA-256: ${checksum}).`);

  return {
    restoredFrom: backupFilePath,
    targetPath,
    checksum,
    preRestoreBackupPath,
    timestamp: new Date().toISOString(),
  };
}

// Direct CLI invocation
if (process.argv[1] && (process.argv[1].endsWith('restore.ts') || process.argv[1].endsWith('restore.js'))) {
  const args = process.argv.slice(2);
  let fileArg: string | undefined;
  let confirmArg: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file' && args[i + 1]) {
      fileArg = args[i + 1];
      i++;
    } else if (args[i] === '--confirm' && args[i + 1]) {
      confirmArg = args[i + 1];
      i++;
    }
  }

  if (!fileArg || !confirmArg) {
    console.error('\n✖ Missing required restore arguments.');
    console.error('Usage: npm run db:restore -- --file <backup-path> --confirm RESTORE\n');
    process.exit(1);
  }

  restoreDatabase({ backupFilePath: fileArg, confirmationToken: confirmArg })
    .then((res) => {
      console.log('\n======================================================');
      console.log('           DATABASE RESTORE COMPLETED');
      console.log('======================================================');
      console.log(`• Restored From  : ${res.restoredFrom}`);
      console.log(`• Target Path    : ${res.targetPath}`);
      console.log(`• SHA-256        : ${res.checksum}`);
      console.log(`• Pre-Restore DB : ${res.preRestoreBackupPath}`);
      console.log(`• Timestamp      : ${res.timestamp}`);
      console.log('======================================================\n');
    })
    .catch((err) => {
      console.error('Restore Error:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
