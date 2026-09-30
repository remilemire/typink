import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The Typst compiler is a native addon; run each test file in its own process.
    pool: 'forks',
    testTimeout: 60_000,
  },
});
