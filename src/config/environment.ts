import path from 'path';
import { resolveDatabasePath } from '../database/backup.js';

export type EnvironmentProfile = 'test' | 'development' | 'production';

export interface EnvironmentGuardResult {
  valid: boolean;
  profile: EnvironmentProfile;
  databasePath: string;
  errors: string[];
}

/**
 * Validates environment profile and asserts strict database isolation rules:
 * 1. TEST profile must strictly use test.db (never dev.db or production DB).
 * 2. DEVELOPMENT profile must use dev.db.
 * 3. PRODUCTION profile must never silently reuse test.db.
 */
export function validateEnvironmentProfile(
  env: NodeJS.ProcessEnv = process.env
): EnvironmentGuardResult {
  const profile = (env.NODE_ENV || 'development').toLowerCase() as EnvironmentProfile;
  const dbUrl = env.DATABASE_URL || 'file:./dev.db';
  const errors: string[] = [];

  let resolvedDbPath = '';
  try {
    resolvedDbPath = resolveDatabasePath(dbUrl);
  } catch {
    resolvedDbPath = dbUrl;
  }

  const normalizedDbPath = resolvedDbPath.toLowerCase().replace(/\\/g, '/');
  const isTestDb = normalizedDbPath.endsWith('/test.db') || normalizedDbPath.endsWith('test.db');
  const isDevDb = normalizedDbPath.endsWith('/dev.db') || normalizedDbPath.endsWith('dev.db');

  if (profile === 'test') {
    if (!isTestDb) {
      errors.push(
        `Environment Profile Violation: NODE_ENV is "test" but DATABASE_URL resolves to "${resolvedDbPath}". Tests MUST exclusively use "test.db".`
      );
    }
  } else if (profile === 'production') {
    if (isTestDb) {
      errors.push(
        `FATAL SAFETY VIOLATION: Production configuration cannot use "test.db". Production must use a dedicated production database.`
      );
    }
  }

  return {
    valid: errors.length === 0,
    profile,
    databasePath: resolvedDbPath,
    errors,
  };
}

/**
 * Throws a fatal Error if environment profile isolation is violated.
 */
export function assertEnvironmentIsolation(env: NodeJS.ProcessEnv = process.env): void {
  const result = validateEnvironmentProfile(env);
  if (!result.valid) {
    throw new Error(result.errors.join('\n'));
  }
}
