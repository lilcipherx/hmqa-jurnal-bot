import { expect, test } from '@playwright/test';
import { generateTotpCode } from '@hmqa/security';

const baseUrl = process.env.ADMIN_BROWSER_BASE_URL ?? 'http://127.0.0.1:8080';
const email = process.env.SEED_ADMIN_EMAIL;
const password = process.env.SEED_ADMIN_PASSWORD;
const totpSecret = process.env.SEED_STAFF_TOTP_SECRET;

test('admin session survives SSR, refresh, protected navigation, and is revoked on logout', async ({
  page,
}) => {
  if (!email || !password || !totpSecret) {
    throw new Error('Synthetic browser-test credentials are required');
  }

  await page.goto('/login');
  await expect(page.locator('form[data-hydrated="true"]')).toBeVisible();
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="totp"]').fill(generateTotpCode(totpSecret));

  // Preserve only the JSON field names inside the browser before the application
  // navigates. Chromium can release the response body as soon as
  // `window.location.assign` destroys the login document, making a later CDP
  // `response.json()` call inherently racy.
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      const input = args[0];
      const rawUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(rawUrl, window.location.href).pathname === '/api/auth/login') {
        const body = (await response.clone().json()) as Record<string, unknown>;
        window.sessionStorage.setItem(
          'hmqa-auth-test-response-shape',
          JSON.stringify(Object.keys(body).sort()),
        );
      }
      return response;
    };
  });

  const loginEvidencePromise = page
    .waitForResponse((response) => new URL(response.url()).pathname === '/api/auth/login')
    .then(async (response) => ({
      headers: await response.headersArray(),
      status: response.status(),
    }));
  const dashboardEvidencePromise = page
    .waitForRequest(
      (request) =>
        new URL(request.url()).pathname === '/dashboard' && request.isNavigationRequest(),
    )
    .then(async (request) => ({ headers: await request.allHeaders() }));
  await page.locator('button[type="submit"]').click();

  const loginEvidence = await loginEvidencePromise;
  expect(loginEvidence.status).toBe(200);
  const setCookies = loginEvidence.headers.filter(
    ({ name }) => name.toLowerCase() === 'set-cookie',
  );
  expect(setCookies).toHaveLength(2);

  const dashboardEvidence = await dashboardEvidencePromise;
  const dashboardCookie = dashboardEvidence.headers.cookie ?? '';
  expect(dashboardCookie).toMatch(/(?:^|;\s*)hmqa_session=/);
  await expect(page).toHaveURL(/\/dashboard$/);
  const responseShape = await page.evaluate(() => {
    const stored = window.sessionStorage.getItem('hmqa-auth-test-response-shape');
    return stored ? (JSON.parse(stored) as string[]) : null;
  });
  expect(responseShape).toEqual(['csrfToken', 'expiresAt', 'sessionId']);

  const cookies = await page.context().cookies(baseUrl);
  const byName = new Map(cookies.map((cookie) => [cookie.name, cookie]));
  const session = byName.get('hmqa_session');
  const csrf = byName.get('hmqa_csrf');
  expect(session).toBeDefined();
  expect(csrf).toBeDefined();
  for (const cookie of [session!, csrf!]) {
    expect(cookie.domain).toBe(new URL(baseUrl).hostname);
    expect(cookie.path).toBe('/');
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Strict');
    expect(cookie.expires).toBeGreaterThan(Date.now() / 1000);
    expect(cookie.secure).toBe(new URL(baseUrl).protocol === 'https:');
  }

  const me = await page.request.get('/api/v1/auth/me');
  expect(me.status()).toBe(200);
  await expect(page.locator('.app-shell')).toBeVisible();

  const reloadResponse = await page.reload();
  expect(reloadResponse).not.toBeNull();
  expect(reloadResponse!.status()).toBe(200);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator('.app-shell')).toBeVisible();

  await page.locator('a[href="/settings"]').click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.locator('.app-shell')).toBeVisible();

  const logoutResponsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/auth/logout',
  );
  await page.locator('header button').click();
  expect((await logoutResponsePromise).status()).toBe(200);
  await expect(page).toHaveURL(/\/login$/);
  const remaining = await page.context().cookies(baseUrl);
  expect(remaining.some((cookie) => cookie.name === 'hmqa_session')).toBe(false);
  expect(remaining.some((cookie) => cookie.name === 'hmqa_csrf')).toBe(false);
  expect((await page.request.get('/api/v1/auth/me')).status()).toBe(401);
});
