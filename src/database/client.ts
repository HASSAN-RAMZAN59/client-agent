import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger.js';
import { DatabaseError } from '../utils/errors.js';

let prismaInstance: PrismaClient | null = null;

/**
 * Gets or initializes the singleton PrismaClient instance.
 */
export function getPrismaClient(): PrismaClient {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient({
      log:
        process.env.LOG_LEVEL === 'debug'
          ? ['query', 'info', 'warn', 'error']
          : ['error', 'warn'],
    });
  }
  return prismaInstance;
}

export const prisma = getPrismaClient();

/**
 * Verifies active database connectivity.
 */
export async function connectDatabase(): Promise<void> {
  const dbLogger = logger.child('Database');
  try {
    const client = getPrismaClient();
    await client.$connect();
    // Verify query capability
    await client.$queryRaw`SELECT 1`;
    dbLogger.info('Connected to SQLite database successfully.');
  } catch (error) {
    dbLogger.error('Failed to connect to database', error);
    throw new DatabaseError(
      'Database connection failed. Ensure SQLite file path and permissions are valid.',
      { originalError: String(error) }
    );
  }
}

/**
 * Gracefully disconnects database client.
 */
export async function disconnectDatabase(): Promise<void> {
  if (prismaInstance) {
    await prismaInstance.$disconnect();
    prismaInstance = null;
  }
}

/**
 * Performs a health check on the database.
 */
export async function checkDatabaseHealth(): Promise<{
  connected: boolean;
  provider: string;
  latencyMs?: number;
  error?: string;
}> {
  const start = Date.now();
  try {
    const client = getPrismaClient();
    await client.$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - start;
    return {
      connected: true,
      provider: 'sqlite',
      latencyMs,
    };
  } catch (err) {
    return {
      connected: false,
      provider: 'sqlite',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
