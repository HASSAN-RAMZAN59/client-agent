import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// Ensure DATABASE_URL is set to isolated test.db
process.env.DATABASE_URL = 'file:./test.db';
process.env.NODE_ENV = 'test';

// Synchronize schema to test.db if not already initialized
const testDbPath = path.join(process.cwd(), 'test.db');
if (!fs.existsSync(testDbPath)) {
  try {
    execSync('npx prisma db push --skip-generate --schema prisma/schema.prisma', {
      env: { ...process.env, DATABASE_URL: 'file:./test.db' },
      stdio: 'pipe',
    });
  } catch (err) {
    console.error('Failed to initialize test.db schema:', err);
  }
}
