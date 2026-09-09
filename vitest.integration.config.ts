import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.integration.spec.ts', 'apps/**/*.integration.spec.ts'],
    setupFiles: ['./tests/require-runtime-env.ts'],
    maxWorkers: 2,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
