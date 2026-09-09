import { randomUUID } from 'node:crypto';
import { loadConfig } from '@hmqa/config';
import { createPrismaClient } from '@hmqa/database';
import { encryptSecret, generateTotpCode, generateTotpSecret, hashPassword } from '@hmqa/security';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const suite = databaseUrl && redisUrl ? describe : describe.skip;
const database = databaseUrl ? createPrismaClient(databaseUrl) : null;
const redis = redisUrl ? new Redis(redisUrl, { maxRetriesPerRequest: 2 }) : null;
const encryptionKey = 'auth-security-integration-key';
const password = 'Integration-only-password-2026!';
const identities = new Map<string, { secret: string; employeeId: string }>();
let app: Awaited<ReturnType<typeof createApp>>;

suite('staff authentication security', () => {
  beforeAll(async () => {
    const passwordHash = await hashPassword(password);
    for (const name of ['valid', 'lockout']) {
      const secret = generateTotpSecret();
      const employee = await database!.employee.create({
        data: {
          email: `${name}-${randomUUID()}@example.invalid`,
          displayName: `Integration ${name}`,
          passwordHash,
          status: 'ACTIVE',
          totpEnabled: true,
          totpSecretCipher: encryptSecret(secret, encryptionKey),
        },
      });
      identities.set(name, { secret, employeeId: employee.id });
    }
    const config = loadConfig({
      NODE_ENV: 'test',
      APP_BASE_URL: 'http://localhost:3001',
      ADMIN_BASE_URL: 'http://localhost:3000',
      BOT_BASE_URL: 'http://localhost:3002',
      DATABASE_URL: databaseUrl!,
      REDIS_URL: redisUrl!,
      TELEGRAM_BOT_TOKEN: '123456:auth-test-token',
      TELEGRAM_WEBHOOK_SECRET: 'auth-test-webhook-secret',
      PUBLIC_BOT_USERNAME: 'hmqa_auth_test_bot',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_BUCKET: 'hmqa-auth-test',
      S3_ACCESS_KEY: 'auth-access',
      S3_SECRET_KEY: 'auth-secret',
      SERVICE_AUTH_SECRET: 'auth-service-secret',
      SESSION_SECRET: 'auth-session-secret',
      ENCRYPTION_KEY: encryptionKey,
      METRICS_TOKEN: 'auth-metrics-token',
    });
    app = await createApp({ config, database: database!, redis: redis! });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await redis?.quit();
    await database?.$disconnect();
  });

  async function login(name: string, passwordValue: string) {
    const identity = identities.get(name)!;
    const employee = await database!.employee.findUniqueOrThrow({
      where: { id: identity.employeeId },
    });
    return app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: employee.email,
        password: passwordValue,
        totp: generateTotpCode(identity.secret),
      },
    });
  }

  it('requires the correct password and current TOTP before issuing an opaque session', async () => {
    const response = await login('valid', password);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.cookies.find((cookie) => cookie.name === 'hmqa_session')).toMatchObject({
      httpOnly: true,
      sameSite: 'Strict',
    });
    expect(response.json()).toMatchObject({ csrfToken: expect.any(String) });
    expect(response.body).not.toContain(password);
    expect(response.body).not.toContain(identities.get('valid')!.secret);
  });

  it('locks an employee after five failed passwords and denies correct credentials while locked', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const denied = await login('lockout', 'Wrong-integration-password-2026!');
      expect(denied.statusCode).toBe(401);
      expect(denied.json()).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    }
    const locked = await login('lockout', password);
    expect(locked.statusCode).toBe(401);
    const employee = await database!.employee.findUniqueOrThrow({
      where: { id: identities.get('lockout')!.employeeId },
    });
    expect(employee.failedLoginCount).toBe(5);
    expect(employee.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
  });
});
