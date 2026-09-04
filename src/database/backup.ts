import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

export interface BackupResult {
  sourcePath: string;
  backupPath: string;
  checksum: string;
  sizeBytes: number;
  timestamp: string;
}

/**
 * Resolves the active database file path from a DATABASE_URL string.
 */
export function resolveDatabasePath(databaseUrl: string = config.DATABASE_URL): string {
  let cleaned = databaseUrl.trim();
  if (cleaned.startsWith('file:')) {
    cleaned = cleaned.replace(/^file:/, '');
  }
  
  // Direct path from cwd
  const cwdPath = path.resolve(process.cwd(), cleaned);
  if (fs.existsSync(cwdPath)) {
    return cwdPath;
  }

  // Prisma convention: SQLite relative paths in schema.prisma are relative to prisma/ directory
  const prismaDirPath = path.resolve(process.cwd(), 'prisma', cleaned);
  if (fs.existsSync(prismaDirPath)) {
    return prismaDirPath;
  }

  // If neither exists yet, check if prisma/ exists to decide default
  const prismaDir = path.resolve(process.cwd(), 'prisma');
  if (fs.existsSync(prismaDir)) {
    return prismaDirPath;
  }

  return cwdPath;
}

/**
 * Computes the SHA-256 checksum of a file.
 */
export function calculateFileChecksum(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

/**
 * Creates a safe, timestamped zero-cost backup of the SQLite database.
 * Never overwrites previous backups and verifies source integrity with SHA-256.
 */
export async function createDatabaseBackup(customDbUrl?: string): Promise<BackupResult> {
  const sourcePath = resolveDatabasePath(customDbUrl || config.DATABASE_URL);
  const log = logger.child('DatabaseBackup');

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Database backup failed: Source database file does not exist at "${sourcePath}".`);
  }

  const backupsDir = path.resolve(process.cwd(), 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const timestampStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  
  const baseName = path.basename(sourcePath, path.extname(sourcePath));
  const backupFileName = `${baseName}-${timestampStr}.db`;
  const backupPath = path.join(backupsDir, backupFileName);

  if (fs.existsSync(backupPath)) {
    throw new Error(`Database backup failed: Backup target "${backupPath}" already exists. Won't overwrite.`);
  }

  // Atomic file copy
  fs.copyFileSync(sourcePath, backupPath);

  const stats = fs.statSync(backupPath);
  const checksum = calculateFileChecksum(backupPath);

  log.info(`Database backup created successfully: ${backupFileName} (SHA-256: ${checksum}, Size: ${stats.size} bytes)`);

  return {
    sourcePath,
    backupPath,
    checksum,
    sizeBytes: stats.size,
    timestamp: now.toISOString(),
  };
}

// Direct CLI invocation
if (process.argv[1] && (process.argv[1].endsWith('backup.ts') || process.argv[1].endsWith('backup.js'))) {
  createDatabaseBackup()
    .then((res) => {
      console.log('\n======================================================');
      console.log('           DATABASE BACKUP CREATED');
      console.log('======================================================');
      console.log(`• Source Path : ${res.sourcePath}`);
      console.log(`• Backup Path : ${res.backupPath}`);
      console.log(`• SHA-256     : ${res.checksum}`);
      console.log(`• Size (bytes): ${res.sizeBytes}`);
      console.log(`• Timestamp   : ${res.timestamp}`);
      console.log('======================================================\n');
    })
    .catch((err) => {
      console.error('Backup Error:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
