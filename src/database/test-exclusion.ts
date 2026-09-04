/**
 * Centralized Test-Data Exclusion Filter
 * Ensures test and synthetic fixtures created during test execution
 * are never included in operational metrics, dashboard views, or analytics.
 */

export const TEST_BUSINESS_FILTER = {
  NOT: [
    { source: { startsWith: 'test' } },
    { source: 'TEST_SUITE' },
    { source: 'MOCK' },
    { source: { startsWith: 'mock' } },
    { name: { startsWith: 'Test' } },
    { name: { startsWith: 'Execution Biz' } },
    { name: { startsWith: 'Contact Test' } },
    { name: { startsWith: 'BatchTest' } },
    { name: { startsWith: 'Phase11' } },
    { name: { startsWith: 'Approved Biz' } },
    { name: { startsWith: 'Cooldown Biz' } },
    { name: { startsWith: 'Suppressed' } },
    { name: { contains: 'Test Biz' } },
    { name: { contains: 'Personalize Test' } },
    { name: { contains: 'Expired Biz' } },
    { name: { contains: 'Suppressed Lead Biz' } },
    { name: { contains: 'Gate Biz' } },
    { name: { contains: 'Duplicate Biz' } },
    { name: { contains: 'Pilot Test' } },
    { name: { contains: 'Mock Biz' } },
    { name: { contains: 'Fixture Biz' } },
    { name: { contains: 'Test Clinic' } },
    { name: { contains: 'Scoring Test' } },
    { name: { contains: 'UnitTest' } },
  ],
};
