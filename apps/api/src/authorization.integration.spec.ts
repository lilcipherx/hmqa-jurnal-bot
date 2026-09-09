import { randomUUID } from 'node:crypto';
import { loadConfig } from '@hmqa/config';
import { createPrismaClient } from '@hmqa/database';
import { hashOpaqueToken } from '@hmqa/security';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const suite = databaseUrl && redisUrl ? describe : describe.skip;
const database = databaseUrl ? createPrismaClient(databaseUrl) : null;
const redis = redisUrl ? new Redis(redisUrl, { maxRetriesPerRequest: 2 }) : null;
let app: Awaited<ReturnType<typeof createApp>>;
let employeeId = '';
let sessionId = '';
const token = `session-${randomUUID()}`;
const csrf = `csrf-${randomUUID()}`;

suite('API authentication and backend authorization', () => {
  beforeAll(async () => {
    const role = await database!.role.upsert({
      where: { code: 'ADMIN' },
      update: {},
      create: { code: 'ADMIN', description: 'Integration administrator' },
    });
    const employee = await database!.employee.create({
      data: {
        email: `admin-${randomUUID()}@example.invalid`,
        displayName: 'Integration Admin',
        status: 'ACTIVE',
      },
    });
    employeeId = employee.id;
    await database!.employeeRole.create({ data: { employeeId, roleId: role.id } });
    const session = await database!.staffSession.create({
      data: {
        employeeId,
        tokenHash: hashOpaqueToken(token),
        csrfHash: hashOpaqueToken(csrf),
        twoFactorAt: new Date(),
        stepUpUntil: new Date(Date.now() + 60_000),
        expiresAt: new Date(Date.now() + 60 * 60_000),
      },
    });
    sessionId = session.id;
    const config = loadConfig({
      NODE_ENV: 'test',
      APP_BASE_URL: 'http://localhost:3001',
      ADMIN_BASE_URL: 'http://localhost:3000',
      BOT_BASE_URL: 'http://localhost:3002',
      DATABASE_URL: databaseUrl!,
      REDIS_URL: redisUrl!,
      TELEGRAM_BOT_TOKEN: '123456:integration-token',
      TELEGRAM_WEBHOOK_SECRET: 'integration-webhook-secret',
      PUBLIC_BOT_USERNAME: 'hmqa_test_bot',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_BUCKET: 'hmqa-test',
      S3_ACCESS_KEY: 'test-access',
      S3_SECRET_KEY: 'test-secret',
      SERVICE_AUTH_SECRET: 'integration-service-secret',
      SESSION_SECRET: 'integration-session-secret',
      ENCRYPTION_KEY: 'integration-encryption-key',
      METRICS_TOKEN: 'integration-metrics-token',
    });
    app = await createApp({ config, database: database!, redis: redis! });
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
    await database?.staffSession.deleteMany({ where: { employeeId } });
    await database?.employeeRole.deleteMany({ where: { employeeId } });
    if (employeeId) await database?.employee.delete({ where: { id: employeeId } });
    await redis?.quit();
    await database?.$disconnect();
  });

  it('returns the authenticated employee and permission set', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: `hmqa_session=${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: employeeId, role: 'ADMIN' });
  });

  it('enforces submission permissions on the backend', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/submissions',
      headers: { cookie: `hmqa_session=${token}` },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects a state-changing request without CSRF and accepts the bound token', async () => {
    const denied = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: `hmqa_session=${token}`, origin: 'http://localhost:3000' },
    });
    expect(denied.statusCode).toBe(403);
    const allowed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: {
        cookie: `hmqa_session=${token}`,
        origin: 'http://localhost:3000',
        'x-csrf-token': csrf,
      },
    });
    expect(allowed.statusCode).toBe(204);
    expect(
      (await database!.staffSession.findUniqueOrThrow({ where: { id: sessionId } })).revokedAt,
    ).toBeInstanceOf(Date);
  });
});
