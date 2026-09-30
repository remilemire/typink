import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  test: {
    pool: 'forks',
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
