import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.integration.spec.ts', 'apps/**/*.integration.spec.ts'],
    setupFiles: ['./tests/require-runtime-env.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
