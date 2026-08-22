import { describe, it, expect, afterAll } from 'vitest';
import { getPrismaClient, checkDatabaseHealth, disconnectDatabase } from '../src/database/client.js';

describe('Database Connection & Health Checks', () => {
  afterAll(async () => {
    await disconnectDatabase();
  });

  it('should successfully connect to SQLite database and verify query execution', async () => {
    const prisma = getPrismaClient();
    const result = await prisma.$queryRaw<Array<{ res: number | bigint }>>`SELECT 1 as res`;
    expect(result).toBeDefined();
    expect(Number(result[0]?.res)).toBe(1);
  });

  it('should report healthy database status via health check utility', async () => {
    const health = await checkDatabaseHealth();
    expect(health.connected).toBe(true);
    expect(health.provider).toBe('sqlite');
    expect(typeof health.latencyMs).toBe('number');
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
