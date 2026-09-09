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

  // Capture evidence while the login document still owns the response body.
  // `window.location.assign` destroys that document immediately after the client
  // consumes the JSON, and retaining only the Response can make CDP lose its body.
  const loginEvidencePromise = page
    .waitForResponse((response) => new URL(response.url()).pathname === '/api/auth/login')
    .then(async (response) => ({
      body: (await response.json()) as Record<string, unknown>,
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
  const responseShape = Object.keys(loginEvidence.body).sort();
  expect(responseShape).toEqual(['csrfToken', 'expiresAt', 'sessionId']);
  const setCookies = loginEvidence.headers.filter(
    ({ name }) => name.toLowerCase() === 'set-cookie',
  );
  expect(setCookies).toHaveLength(2);

  const dashboardEvidence = await dashboardEvidencePromise;
  const dashboardCookie = dashboardEvidence.headers.cookie ?? '';
  expect(dashboardCookie).toMatch(/(?:^|;\s*)hmqa_session=/);
  await expect(page).toHaveURL(/\/dashboard$/);

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

  await page.reload();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator('header button')).toBeVisible();

  await page.locator('a[href="/settings"]').click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.locator('header button')).toBeVisible();

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
