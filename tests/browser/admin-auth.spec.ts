import { expect, test } from '@playwright/test';
import { generateTotpCode } from '@hmqa/security';

const baseUrl = process.env.ADMIN_BROWSER_BASE_URL ?? 'http://127.0.0.1:8080';
const email = process.env.SEED_ADMIN_EMAIL;
const password = process.env.SEED_ADMIN_PASSWORD;
const totpSecret = process.env.SEED_STAFF_TOTP_SECRET;

test('admin auth, protected navigation, staff reset, self re-enrollment, and logout', async ({
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

  const appIcon = await page.request.get('/icon.svg');
  expect(appIcon.status()).toBe(200);
  expect(appIcon.headers()['content-type']).toContain('image/svg+xml');

  const forbiddenPage = await page.goto('/submissions');
  expect(forbiddenPage).not.toBeNull();
  expect(forbiddenPage!.status()).toBe(403);
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('ADMIN_API_403');
  await expect(page.locator('body')).not.toContainText('Internal Server Error');

  await page.goto('/dashboard');
  await expect(page.locator('.app-shell')).toBeVisible();

  const localeBffPromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/locale',
  );
  const localeDestination = await page.goto('/api/locale?locale=en&return=/dashboard');
  expect((await localeBffPromise).status()).toBe(303);
  expect(localeDestination?.status()).toBe(200);
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(
    (await page.context().cookies(baseUrl)).find(({ name }) => name === 'hmqa_locale')?.value,
  ).toBe('en');

  await page.locator('a[href="/settings"]').click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.getByTestId('change-password-form')).toBeVisible();
  await expect(page.getByTestId('self-totp-reset-form')).toBeVisible();

  const passwordForm = page.getByTestId('change-password-form');
  await passwordForm.locator('input[name="currentPassword"]').fill(password);
  await passwordForm.locator('input[name="currentTotp"]').fill(generateTotpCode(totpSecret));
  await passwordForm.locator('input[name="newPassword"]').fill('Browser-new-password-2026!');
  await passwordForm
    .locator('input[name="confirmPassword"]')
    .fill('Browser-different-password-2026!');
  await passwordForm.locator('button[type="submit"]').click();
  await expect(passwordForm.locator('[role="alert"]')).toBeVisible();

  await page.locator('a[href="/users"]').click();
  await expect(page).toHaveURL(/\/users$/);
  const operatorRow = page.locator('tr', { hasText: 'operator@example.invalid' });
  await expect(operatorRow).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileWidth = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(mobileWidth.document).toBeLessThanOrEqual(mobileWidth.viewport);
  await page.setViewportSize({ width: 1280, height: 720 });
  await operatorRow.locator('[data-testid^="reset-totp-"]').click();
  const staffResetForm = operatorRow.locator('[data-testid^="reset-totp-form-"]');
  await staffResetForm.locator('input[name="currentPassword"]').fill(password);
  await staffResetForm.locator('input[name="currentTotp"]').fill(generateTotpCode(totpSecret));
  await staffResetForm.locator('button[type="submit"]').click();
  await expect(staffResetForm.locator('[role="status"]')).toBeVisible();
  const staffResetResponsePromise = page.waitForResponse((response) =>
    /\/api\/employees\/[^/]+\/totp\/reset$/.test(new URL(response.url()).pathname),
  );
  await staffResetForm.locator('button[type="submit"]').click();
  expect((await staffResetResponsePromise).status()).toBe(200);
  await expect(page.locator('tr', { hasText: 'operator@example.invalid' })).toBeVisible();

  await page.locator('a[href="/settings"]').click();
  const resetForm = page.getByTestId('self-totp-reset-form');
  await resetForm.locator('input[name="currentPassword"]').fill(password);
  await resetForm.locator('input[name="currentTotp"]').fill(generateTotpCode(totpSecret));
  await resetForm.locator('button[type="submit"]').click();
  await expect(resetForm.locator('[role="status"]')).toBeVisible();
  const resetResponsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/auth/totp/reset',
  );
  await resetForm.locator('button[type="submit"]').click();
  expect((await resetResponsePromise).status()).toBe(200);
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get('/api/v1/auth/me')).status()).toBe(401);

  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  const enrollmentLoginPromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/auth/login',
  );
  await page.locator('button[type="submit"]').click();
  expect((await enrollmentLoginPromise).status()).toBe(428);
  await expect(page).toHaveURL(/\/security\/totp-enroll$/);
  const newSecret = await page.getByTestId('totp-enrollment-secret').textContent();
  expect(newSecret).toBeTruthy();
  expect(newSecret).not.toBe(totpSecret);
  await page.locator('input[name="totp"]').fill(generateTotpCode(newSecret!));
  const enrollmentResponsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/auth/totp/enrollment/complete',
  );
  await page.locator('button[type="submit"]').click();
  expect((await enrollmentResponsePromise).status()).toBe(200);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator('.app-shell')).toBeVisible();
  expect((await page.request.get('/api/v1/auth/me')).status()).toBe(200);

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
