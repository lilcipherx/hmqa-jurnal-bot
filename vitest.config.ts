import { defineConfig } from 'vitest/config';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: Object.fromEntries(
      ['config', 'contracts', 'database', 'domain', 'i18n', 'logger', 'security', 'shared'].map(
        (name) => [`@hmqa/${name}`, resolve(root, `packages/${name}/src/index.ts`)],
      ),
    ),
  },
  test: {
    include: ['packages/**/*.spec.ts', 'apps/**/*.spec.ts'],
    exclude: [
      '**/*.integration.spec.ts',
      '**/*.e2e.spec.ts',
      '**/*.runtime.spec.ts',
      '**/node_modules/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
    },
  },
});
