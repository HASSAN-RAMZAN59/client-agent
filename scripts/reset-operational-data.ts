import { getPrismaClient } from '../src/database/client.js';
import { logger } from '../src/utils/logger.js';
import path from 'path';

const log = logger.child('OperationalReset');

async function resetOperationalData() {
  const prisma = getPrismaClient();

  try {
    const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
    log.info(`Target database URL: ${dbUrl}`);

    if (!dbUrl.includes('dev.db')) {
      throw new Error('DATABASE_RESET_TARGET_UNSAFE: Target database is not dev.db');
    }

    log.info('Starting complete transactional operational data reset...');

    // 1. Disable FK checks for safe cascade clearing
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys = OFF;');

    // 2. Clear all operational tables
    const operationalTables = [
      'follow_ups',
      'replies',
      'outreaches',
      'contacts',
      'website_audits',
      'leads',
      'campaign_businesses',
      'campaign_runs',
      'businesses',
      'campaigns',
      'suppressions',
      'activity_logs',
    ];

    for (const table of operationalTables) {
      await prisma.$executeRawUnsafe(`DELETE FROM "${table}";`);
      log.info(`Cleared operational table: ${table}`);
    }

    // 3. Clear auto-increment sequence counters if sqlite_sequence exists
    try {
      const quotedTableList = operationalTables.map((t) => `'${t}'`).join(', ');
      await prisma.$executeRawUnsafe(
        `DELETE FROM sqlite_sequence WHERE name IN (${quotedTableList});`
      );
      log.info('Reset SQLite sequence counters.');
    } catch {
      // sqlite_sequence may not exist if no auto-increment tables are used
    }

    // 4. Re-enable foreign keys
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON;');

    // 5. Verify zero foreign key violations
    const fkViolations = await prisma.$queryRawUnsafe<any[]>('PRAGMA foreign_key_check;');
    if (fkViolations.length > 0) {
      throw new Error(`Foreign key check failed with ${fkViolations.length} violations`);
    }
    log.info('Foreign key integrity check passed (0 violations).');

    // 6. Vacuum SQLite database to reclaim disk space
    await prisma.$executeRawUnsafe('VACUUM;');
    log.info('Database vacuum completed.');

    // 7. Verify all operational table counts are zero
    console.log('\n======================================================');
    console.log('         POST-RESET OPERATIONAL COUNTS');
    console.log('======================================================');
    let totalRecords = 0;
    for (const table of operationalTables) {
      const res = await prisma.$queryRawUnsafe<{ count: number }[]>(
        `SELECT count(*) as count FROM "${table}";`
      );
      const count = Number(res[0].count);
      totalRecords += count;
      console.log(`• ${table.padEnd(24)}: ${count}`);
    }

    // Check prisma migrations table is intact
    const migrations = await prisma.$queryRawUnsafe<{ count: number }[]>(
      'SELECT count(*) as count FROM "_prisma_migrations";'
    );
    console.log(`• ${'_prisma_migrations (schema)'.padEnd(24)}: ${migrations[0].count} (PRESERVED)`);
    console.log('======================================================\n');

    if (totalRecords !== 0) {
      throw new Error(`Operational reset failed: ${totalRecords} records still remain!`);
    }

    console.log('✔ COMPLETE FRESH START SUCCESSFUL: ALL OPERATIONAL DATA CLEARED.');
  } finally {
    await prisma.$disconnect();
  }
}

resetOperationalData().catch((err) => {
  console.error('Reset failed:', err);
  process.exit(1);
});
