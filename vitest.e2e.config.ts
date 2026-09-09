import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.e2e.spec.ts', 'apps/**/*.e2e.spec.ts'],
    setupFiles: ['./tests/require-runtime-env.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
