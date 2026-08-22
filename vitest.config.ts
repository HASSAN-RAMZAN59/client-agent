import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      DATABASE_URL: 'file:./test.db',
      NODE_ENV: 'test',
    },
    setupFiles: ['./tests/setup-test-db.ts'],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
