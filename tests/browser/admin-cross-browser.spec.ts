import { expect, test } from '@playwright/test';
import { generateTotpCode } from '@hmqa/security';

const baseUrl = process.env.ADMIN_BROWSER_BASE_URL ?? 'http://127.0.0.1:8080';
const email = process.env.SEED_ADMIN_EMAIL;
const password = process.env.SEED_ADMIN_PASSWORD;
const totpSecret = process.env.SEED_STAFF_TOTP_SECRET;

const protectedRoutes = [
  '/dashboard',
  '/submissions',
  '/journals',
  '/reviewers',
  '/telegram',
  '/notifications',
  '/users',
  '/settings',
] as const;

test('critical staff session and protected routes remain usable', async ({ page }) => {
  if (!email || !password || !totpSecret) {
    throw new Error('Synthetic browser-test credentials are required');
  }

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const serverErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 500) {
      serverErrors.push(`${response.status()} ${new URL(response.url()).pathname}`);
    }
  });

  await page.goto('/login');
  await expect(page.locator('form[data-hydrated="true"]')).toBeVisible();
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="totp"]').fill(generateTotpCode(totpSecret));

  const loginResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/auth/login',
  );
  await page.locator('button[type="submit"]').click();
  expect((await loginResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator('.app-shell')).toBeVisible();

  const session = (await page.context().cookies(baseUrl)).find(
    (cookie) => cookie.name === 'hmqa_session',
  );
  expect(session).toBeDefined();
  expect((await page.request.get('/api/v1/auth/me')).status()).toBe(200);

  const reloadResponse = await page.reload();
  expect(reloadResponse?.status()).toBe(200);
  await expect(page).toHaveURL(/\/dashboard$/);
  expect((await page.request.get('/api/v1/auth/me')).status()).toBe(200);

  expect(
    await page
      .locator('.nav > a')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
  ).toEqual(protectedRoutes);

  for (const route of protectedRoutes) {
    const response = await page.goto(route);
    expect(response?.status(), route).toBe(200);
    await expect(page.locator('.app-shell')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/admin\.[a-z0-9_.-]+/i);
  }

  await page.goto('/submissions');
  const detailLink = page.locator('a[href^="/submissions/"]').first();
  await expect(detailLink).toBeVisible();
  const detailHref = await detailLink.getAttribute('href');
  expect(detailHref).toMatch(/^\/submissions\/[0-9a-f-]{36}$/);
  const detailResponse = await page.goto(detailHref!);
  expect(detailResponse?.status()).toBe(200);
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/dashboard');
    const widths = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(widths.document, `${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(
      widths.viewport,
    );
  }

  await page.setViewportSize({ width: 1280, height: 720 });
  const logoutResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/auth/logout',
  );
  await page.locator('header button').click();
  expect((await logoutResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get('/api/v1/auth/me')).status()).toBe(401);
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/login$/);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(serverErrors).toEqual([]);
});
