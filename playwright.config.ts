import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 12_000 },
  reporter: 'line',
  use: {
    baseURL: process.env.ADMIN_BROWSER_BASE_URL ?? 'http://127.0.0.1:8080',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'firefox-critical',
      testMatch: /admin-cross-browser\.spec\.ts/,
      use: { browserName: 'firefox' },
    },
    {
      name: 'webkit-critical',
      testMatch: /admin-cross-browser\.spec\.ts/,
      use: { browserName: 'webkit' },
    },
    {
      name: 'chromium-full',
      dependencies: ['firefox-critical', 'webkit-critical'],
      testMatch: /admin-auth\.spec\.ts/,
      use: { browserName: 'chromium' },
    },
  ],
});
