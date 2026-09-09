import { expect, test } from '@playwright/test';
import { generateTotpCode } from '@hmqa/security';
import { translate, type Locale } from '@hmqa/i18n';

const baseUrl = process.env.ADMIN_BROWSER_BASE_URL ?? 'http://127.0.0.1:8080';
const email = process.env.SEED_ADMIN_EMAIL;
const password = process.env.SEED_ADMIN_PASSWORD;
const totpSecret = process.env.SEED_STAFF_TOTP_SECRET;

test('admin auth, protected navigation, administrator reset, self re-enrollment, and logout', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
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
  expect(
    await page
      .locator('.nav > a')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
  ).toEqual([
    '/dashboard',
    '/submissions',
    '/journals',
    '/reviewers',
    '/telegram',
    '/notifications',
    '/users',
    '/settings',
  ]);

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

  const articlesPage = await page.goto('/submissions');
  expect(articlesPage).not.toBeNull();
  expect(articlesPage!.status()).toBe(200);
  await expect(page.locator('.app-shell')).toBeVisible();

  for (const locale of ['ru', 'uz-Latn', 'en'] as const satisfies readonly Locale[]) {
    await page.goto('/journals');
    const localeBffPromise = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/locale',
    );
    await page.locator(`.language-switcher a[hreflang="${locale}"]`).click();
    expect((await localeBffPromise).status()).toBe(303);
    await expect(page).toHaveURL(/\/journals$/);
    await expect(
      page.getByRole('heading', { level: 1, name: translate(locale, 'admin.journals.heading') }),
    ).toBeVisible();
    expect(
      (await page.context().cookies(baseUrl)).find(({ name }) => name === 'hmqa_locale')?.value,
    ).toBe(locale);
    await page.reload();
    await expect(
      page.getByRole('heading', { level: 1, name: translate(locale, 'admin.journals.heading') }),
    ).toBeVisible();
    await page.locator('a[href="/dashboard"]').click();
    await expect(
      page.getByRole('heading', { level: 1, name: translate(locale, 'admin.dashboard.heading') }),
    ).toBeVisible();
  }

  const journalCode = 'BROWSERUAT';
  await page.goto('/journals');
  await page.getByTestId('add-journal').click();
  const journalForm = page.getByTestId('create-journal');
  await journalForm.locator('input[name="code"]').fill(journalCode);
  for (const [suffix, name, description, contact] of [
    ['uz', 'Brauzer UAT jurnali', 'Brauzer orqali yaratilgan UAT jurnali', 'UAT aloqa'],
    ['ru', 'Журнал Browser UAT', 'Журнал создан браузерной UAT-проверкой', 'UAT контакты'],
    ['en', 'Browser UAT journal', 'Journal created by the browser UAT check', 'UAT contact'],
  ] as const) {
    await journalForm.locator(`input[name="name_${suffix}"]`).fill(name);
    await journalForm.locator(`input[name="short_${suffix}"]`).fill('BUAT');
    await journalForm.locator(`textarea[name="description_${suffix}"]`).fill(description);
    await journalForm.locator(`textarea[name="contact_${suffix}"]`).fill(contact);
  }
  await journalForm.locator('input[name="acceptanceOpensAt"]').fill('2031-01-01T09:00');
  await journalForm.locator('input[name="acceptanceClosesAt"]').fill('2031-12-31T18:00');
  const createJournalResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/journals' &&
      response.request().method() === 'POST',
  );
  await journalForm.locator('button[type="submit"]').click();
  expect((await createJournalResponse).status()).toBe(201);
  await expect(page.locator('tr', { hasText: journalCode })).toBeVisible();

  const journalEditor = page.locator('details[data-testid^="edit-journal-"]', {
    hasText: journalCode,
  });
  await journalEditor.locator(':scope > summary').click();
  await journalEditor
    .locator('textarea[name="edit_description_en"]')
    .fill('Journal edited by the browser UAT check');
  const editJournalResponse = page.waitForResponse(
    (response) =>
      /^\/api\/journals\/[0-9a-f-]{36}$/.test(new URL(response.url()).pathname) &&
      response.request().method() === 'PATCH',
  );
  await journalEditor.locator('button[type="submit"]').click();
  expect((await editJournalResponse).status()).toBe(200);

  const requirementForm = page.getByTestId('create-requirement');
  const journalOption = requirementForm.locator('select[name="journalId"] option', {
    hasText: journalCode,
  });
  const journalId = await journalOption.getAttribute('value');
  expect(journalId).toBeTruthy();
  await requirementForm.locator('select[name="journalId"]').selectOption(journalId!);
  await requirementForm.locator('textarea[name="changeNote"]').fill('Browser UAT draft');
  for (const [suffix, title, summary, body] of [
    ['uz', 'UAT talablari', 'UAT qisqacha talablar', 'UAT talablarining to‘liq matni'],
    ['ru', 'Требования UAT', 'Краткие требования UAT', 'Полный текст требований UAT'],
    ['en', 'UAT requirements', 'UAT requirement summary', 'Full UAT requirement text'],
  ] as const) {
    await requirementForm.locator(`input[name="title_${suffix}"]`).fill(title);
    await requirementForm.locator(`textarea[name="summary_${suffix}"]`).fill(summary);
    await requirementForm.locator(`textarea[name="body_${suffix}"]`).fill(body);
    await requirementForm.locator(`textarea[name="help_${suffix}"]`).fill(`${title} help`);
    await requirementForm
      .locator(`textarea[name="requirement_contact_${suffix}"]`)
      .fill(`${title} contact`);
  }
  const createRequirementResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/journals/${journalId}/requirements` &&
      response.request().method() === 'POST',
  );
  await requirementForm.locator('button[type="submit"]').click();
  expect((await createRequirementResponse).status()).toBe(201);

  let requirementVersion = page.locator('details.requirement-version', {
    hasText: `${journalCode} · v1`,
  });
  await requirementVersion.locator(':scope > summary').click();
  await expect(requirementVersion).toContainText('Full UAT requirement text');
  await requirementVersion.locator('details.requirement-editor-shell > summary').click();
  const requirementEditor = requirementVersion.locator('form[data-testid^="edit-requirement-"]');
  await requirementEditor.locator('input[name="editRequirementMaxMiB"]').fill('12');
  await requirementEditor
    .locator('textarea[name="edit_requirement_body_en"]')
    .fill('Updated full UAT requirement text');
  const editRequirementResponse = page.waitForResponse(
    (response) =>
      /^\/api\/requirements\/[0-9a-f-]{36}$/.test(new URL(response.url()).pathname) &&
      response.request().method() === 'PATCH',
  );
  await requirementEditor.locator('button[type="submit"]').click();
  expect((await editRequirementResponse).status()).toBe(200);

  requirementVersion = page.locator('details.requirement-version', {
    hasText: `${journalCode} · v1`,
  });
  await requirementVersion.locator(':scope > summary').click();
  await expect(requirementVersion).toContainText('Updated full UAT requirement text');
  const reviewResponse = page.waitForResponse((response) =>
    /\/api\/requirements\/[0-9a-f-]{36}\/state$/.test(new URL(response.url()).pathname),
  );
  await requirementVersion.getByRole('button', { name: /In review/ }).click();
  expect((await reviewResponse).status()).toBe(200);

  const secondPage = await browser.newPage({ baseURL: baseUrl });
  await secondPage.goto('/login');
  await secondPage.locator('input[name="email"]').fill('admin-2@example.invalid');
  await secondPage.locator('input[name="password"]').fill(password);
  await secondPage.locator('input[name="totp"]').fill(generateTotpCode(totpSecret));
  await secondPage.locator('button[type="submit"]').click();
  await expect(secondPage).toHaveURL(/\/dashboard$/);
  await secondPage.locator('.language-switcher a[hreflang="en"]').click();
  await expect(
    secondPage.getByRole('heading', { level: 1, name: translate('en', 'admin.dashboard.heading') }),
  ).toBeVisible();
  await secondPage.goto('/journals');
  const secondAdminRequirement = secondPage.locator('details.requirement-version', {
    hasText: `${journalCode} · v1`,
  });
  await secondAdminRequirement.locator(':scope > summary').click();
  const approveResponse = secondPage.waitForResponse((response) =>
    /\/api\/requirements\/[0-9a-f-]{36}\/state$/.test(new URL(response.url()).pathname),
  );
  await secondAdminRequirement.getByRole('button', { name: /Approved/ }).click();
  expect((await approveResponse).status()).toBe(200);
  await secondPage.close();

  await page.reload();
  requirementVersion = page.locator('details.requirement-version', {
    hasText: `${journalCode} · v1`,
  });
  await requirementVersion.locator(':scope > summary').click();
  const publishResponse = page.waitForResponse((response) =>
    /\/api\/requirements\/[0-9a-f-]{36}\/state$/.test(new URL(response.url()).pathname),
  );
  await requirementVersion.getByRole('button', { name: /Published/ }).click();
  expect((await publishResponse).status()).toBe(200);
  await expect(page.locator('tr', { hasText: journalCode })).toContainText('Published');

  await page.goto('/telegram');
  const globalContactForm = page.getByTestId('contact-GLOBAL');
  await globalContactForm.locator('input[name="phone"]').fill('+998 71 222 22 22');
  await globalContactForm.locator('input[name="email"]').fill('browser-uat@example.invalid');
  await globalContactForm.locator('input[name="telegram"]').fill('@hmqa_browser_uat');
  for (const locale of ['uz-Latn', 'ru', 'en'] as const) {
    await globalContactForm.locator(`textarea[name="address:${locale}"]`).fill(`UAT ${locale}`);
    await globalContactForm
      .locator(`textarea[name="workingHours:${locale}"]`)
      .fill(`09:00–18:00 ${locale}`);
    await globalContactForm.locator(`textarea[name="note:${locale}"]`).fill(`UAT note ${locale}`);
  }
  const contactResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/telegram-content/contact' &&
      response.request().method() === 'PUT',
  );
  await globalContactForm.locator('button[type="submit"]').click();
  expect((await contactResponse).status()).toBe(200);
  await expect(page.getByTestId('contact-GLOBAL').locator('input[name="phone"]')).toHaveValue(
    '+998 71 222 22 22',
  );

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
  const secondAdministratorRow = page.locator('tr', { hasText: 'admin-2@example.invalid' });
  await expect(secondAdministratorRow).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileWidth = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(mobileWidth.document).toBeLessThanOrEqual(mobileWidth.viewport);
  await page.setViewportSize({ width: 1280, height: 720 });
  await secondAdministratorRow.locator('[data-testid^="reset-totp-"]').click();
  const staffResetForm = secondAdministratorRow.locator('[data-testid^="reset-totp-form-"]');
  await staffResetForm.locator('input[name="currentPassword"]').fill(password);
  await staffResetForm.locator('input[name="currentTotp"]').fill(generateTotpCode(totpSecret));
  await staffResetForm.locator('button[type="submit"]').click();
  await expect(staffResetForm.locator('[role="status"]')).toBeVisible();
  const staffResetResponsePromise = page.waitForResponse((response) =>
    /\/api\/employees\/[^/]+\/totp\/reset$/.test(new URL(response.url()).pathname),
  );
  await staffResetForm.locator('button[type="submit"]').click();
  expect((await staffResetResponsePromise).status()).toBe(200);
  await expect(page.locator('tr', { hasText: 'admin-2@example.invalid' })).toBeVisible();

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
