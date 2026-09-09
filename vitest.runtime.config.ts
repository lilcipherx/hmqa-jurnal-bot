import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/**/*.runtime.spec.ts', 'packages/**/*.runtime.spec.ts'],
    setupFiles: ['./tests/require-full-runtime-env.ts'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
