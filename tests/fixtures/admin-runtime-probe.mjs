import { createHmac } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { URL } from 'node:url';

const apiBase = process.env.APP_BASE_URL ?? 'http://api:3001';
const webBase = 'http://nginx:8080';
const password = process.env.SEED_ADMIN_PASSWORD;
const totpSecret = process.env.SEED_STAFF_TOTP_SECRET;
const translationKeys = new Set(
  Object.keys(
    JSON.parse(
      readFileSync(new URL('../../packages/i18n/src/locales/en.json', import.meta.url), 'utf8'),
    ),
  ),
);
if (!password || !totpSecret)
  throw new Error('Seed credentials are required for the runtime probe');

function decodeBase32(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const character of value.replaceAll('=', '').toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('Invalid Base32 TOTP secret');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8)
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

function totp(secret) {
  const counter = BigInt(Math.floor(Date.now() / 30_000));
  const value = Buffer.alloc(8);
  value.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', decodeBase32(secret)).update(value).digest();
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

async function expectStatus(responsePromise, status, label) {
  const response = await responsePromise;
  if (response.status !== status)
    throw new Error(
      `${label}: expected ${status}, received ${response.status}: ${await response.text()}`,
    );
  return response;
}

async function login(email) {
  const response = await expectStatus(
    globalThis.fetch(`${apiBase}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, totp: totp(totpSecret) }),
    }),
    200,
    `login ${email}`,
  );
  const body = await response.json();
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
  if (!cookie || !body.csrfToken) throw new Error(`login ${email}: session material missing`);
  return { cookie, csrf: body.csrfToken };
}

async function apiGet(session, path) {
  return expectStatus(
    globalThis.fetch(`${apiBase}${path}`, { headers: { cookie: session.cookie } }),
    200,
    `GET ${path}`,
  );
}

function findTagEnd(html, start) {
  let quote;
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index;
    }
  }
  return html.length - 1;
}

function findTagStart(lowerHtml, tag, start, closing = false) {
  const prefix = `<${closing ? '/' : ''}${tag}`;
  let index = lowerHtml.indexOf(prefix, start);
  while (index >= 0) {
    const boundary = lowerHtml[index + prefix.length];
    if (
      boundary === '>' ||
      boundary === '/' ||
      (boundary !== undefined && boundary.charCodeAt(0) <= 32)
    ) {
      return index;
    }
    index = lowerHtml.indexOf(prefix, index + prefix.length);
  }
  return -1;
}

function renderedMarkup(html) {
  const lowerHtml = html.toLowerCase();
  const ignoredTags = ['script', 'style', 'noscript', 'template'];
  let rendered = '';
  let cursor = 0;
  while (cursor < html.length) {
    const candidate = ignoredTags
      .map((tag) => ({ tag, index: findTagStart(lowerHtml, tag, cursor) }))
      .filter(({ index }) => index >= 0)
      .sort((left, right) => left.index - right.index)[0];
    if (!candidate) return rendered + html.slice(cursor);

    rendered += html.slice(cursor, candidate.index);
    const openingEnd = findTagEnd(html, candidate.index);
    const closingStart = findTagStart(lowerHtml, candidate.tag, openingEnd + 1, true);
    if (closingStart < 0) return rendered;
    cursor = findTagEnd(html, closingStart) + 1;
  }
  return rendered;
}

async function webGet(session, path, locale = 'en', { allowTranslationKeys = false } = {}) {
  const response = await expectStatus(
    globalThis.fetch(`${webBase}${path}`, {
      headers: { cookie: `${session.cookie}; hmqa_locale=${encodeURIComponent(locale)}` },
      redirect: 'manual',
    }),
    200,
    `WEB ${path} (${locale})`,
  );
  const csp = response.headers.get('content-security-policy');
  if (!csp || !/script-src[^;]*'nonce-[^']+'[^;]*'strict-dynamic'/.test(csp)) {
    throw new Error(`WEB ${path} (${locale}) is missing a nonce-based script policy`);
  }
  if (/script-src[^;]*'unsafe-inline'/.test(csp)) {
    throw new Error(`WEB ${path} (${locale}) allows unsafe-inline scripts`);
  }
  const html = await response.text();
  const rendered = renderedMarkup(html);
  const rawKey = [...translationKeys].find((candidate) => rendered.includes(candidate));
  if (rawKey && !allowTranslationKeys)
    throw new Error(`WEB ${path} (${locale}) leaked raw translation key ${rawKey}`);
  return html;
}

const administrator = await login(process.env.SEED_ADMIN_EMAIL ?? 'admin-test@example.invalid');

const traceId = '30bf1a89-14c1-43ea-a41c-7b7a52ff2210';
const traced = await expectStatus(
  globalThis.fetch(`${apiBase}/health/live`, { headers: { 'x-request-id': traceId } }),
  200,
  'request correlation id',
);
if (traced.headers.get('x-request-id') !== traceId)
  throw new Error('API did not echo the validated request/correlation ID');
const expectedVersion = process.env.DEPLOYED_SHA ?? 'development';
const apiLive = await traced.json();
if (apiLive.version !== expectedVersion) throw new Error('API reported an unexpected build SHA');
for (const [service, url] of [
  ['bot', 'http://bot:3002/health/live'],
  ['worker', 'http://worker:3003/health/live'],
  ['admin', `${webBase}/health/live`],
]) {
  const live = await (await expectStatus(globalThis.fetch(url), 200, `${service} liveness`)).json();
  if (live.version !== expectedVersion)
    throw new Error(`${service} reported an unexpected build SHA`);
}
const apiMetrics = await (
  await expectStatus(globalThis.fetch(`${apiBase}/metrics`), 200, 'API metrics')
).text();
if (!apiMetrics.includes('hmqa_api_request_duration_seconds'))
  throw new Error('API metrics are missing request latency series');
const workerMetrics = await (
  await expectStatus(globalThis.fetch('http://worker:3003/metrics'), 200, 'worker metrics')
).text();
if (!workerMetrics.includes('hmqa_worker_queue_depth'))
  throw new Error('Worker metrics are missing queue-depth series');
const openapi = await (
  await expectStatus(globalThis.fetch(`${apiBase}/documentation/json`), 200, 'OpenAPI document')
).json();
const documentedPaths = Object.keys(openapi.paths ?? {});
if (openapi.openapi?.split('.')[0] !== '3' || documentedPaths.length < 30)
  throw new Error('OpenAPI document does not contain the public API surface');
if (documentedPaths.some((path) => path.startsWith('/api/v1/internal/')))
  throw new Error('OpenAPI document exposed an internal service route');
if (!openapi.components?.securitySchemes?.staffCookie)
  throw new Error('OpenAPI document is missing the staff authentication scheme');

await Promise.all([
  apiGet(administrator, '/api/v1/admin/dashboard'),
  apiGet(administrator, '/api/v1/admin/submissions?status=PUBLISHED&search=LIFECYCLE'),
  apiGet(administrator, '/api/v1/admin/journals'),
  apiGet(administrator, '/api/v1/admin/reviewers'),
  apiGet(administrator, '/api/v1/admin/reviews/assigned'),
  apiGet(administrator, '/api/v1/admin/telegram-content'),
  apiGet(administrator, '/api/v1/admin/employees'),
  apiGet(administrator, '/api/v1/admin/roles'),
  apiGet(administrator, '/api/v1/admin/settings/runtime'),
  apiGet(administrator, '/api/v1/admin/notifications'),
  // Audit/privacy remain protected backend controls even though normal navigation hides them.
  apiGet(administrator, '/api/v1/admin/privacy/requests'),
  apiGet(administrator, '/api/v1/admin/audit'),
  apiGet(administrator, '/api/v1/admin/reports/overview'),
  apiGet(administrator, '/api/v1/admin/privacy/legal-holds'),
]);

const submissions = await (await apiGet(administrator, '/api/v1/admin/submissions')).json();
if (!Array.isArray(submissions.items) || submissions.items.length === 0)
  throw new Error('Admin runtime probe requires at least one acceptance submission');
const selectedSubmission = submissions.items.find((item) =>
  String(item.publicId).startsWith('LIFECYCLE-'),
);
if (!selectedSubmission) throw new Error('Published lifecycle acceptance fixture is unavailable');
const submissionId = selectedSubmission.id;
await Promise.all([
  apiGet(administrator, `/api/v1/admin/submissions/${submissionId}`),
  apiGet(administrator, `/api/v1/admin/submissions/${submissionId}/assignment-options`),
]);

await Promise.all([
  webGet(administrator, '/dashboard', 'uz-Latn'),
  webGet(administrator, '/submissions', 'ru'),
  webGet(administrator, `/submissions/${submissionId}`, 'en'),
  webGet(administrator, '/journals', 'uz-Latn'),
  webGet(administrator, '/reviewers', 'ru'),
  webGet(administrator, '/telegram', 'en'),
  webGet(administrator, '/users', 'ru'),
  webGet(administrator, '/settings', 'uz-Latn'),
  webGet(administrator, '/notifications', 'en'),
]);

await expectStatus(
  globalThis.fetch(`${apiBase}/api/v1/auth/logout`, {
    method: 'POST',
    headers: {
      cookie: administrator.cookie,
      origin: 'http://admin-web:3000',
      'x-csrf-token': administrator.csrf,
    },
  }),
  204,
  'logout',
);
await expectStatus(
  globalThis.fetch(`${apiBase}/api/v1/auth/me`, { headers: { cookie: administrator.cookie } }),
  401,
  'revoked session',
);

process.stdout.write(
  'admin runtime probe: single-role authentication, API, eight-section UI and logout passed\n',
);
