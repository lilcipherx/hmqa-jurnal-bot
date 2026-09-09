import { randomUUID } from 'node:crypto';
import { loadConfig } from '@hmqa/config';
import { createPrismaClient } from '@hmqa/database';
import {
  decryptSecret,
  encryptSecret,
  generateOpaqueToken,
  generateTotpCode,
  generateTotpSecret,
  hashOpaqueToken,
  hashPassword,
} from '@hmqa/security';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const suite = databaseUrl && redisUrl ? describe : describe.skip;
const database = databaseUrl ? createPrismaClient(databaseUrl) : null;
const redis = redisUrl ? new Redis(redisUrl, { maxRetriesPerRequest: 2 }) : null;
const encryptionKey = 'totp-management-integration-encryption-key';
const currentPassword = 'Integration-current-password-2026!';
const changedPassword = 'Integration-changed-password-2026!';

interface Identity {
  employeeId: string;
  email: string;
  secret: string;
  token: string;
  csrf: string;
  sessionId: string;
}

const identities = new Map<string, Identity>();
let app: Awaited<ReturnType<typeof createApp>>;

suite('staff TOTP and password management', () => {
  beforeAll(async () => {
    const passwordHash = await hashPassword(currentPassword);
    const adminRole = await database!.role.upsert({
      where: { code: 'ADMIN' },
      update: {},
      create: { code: 'ADMIN', description: 'Integration administrator' },
    });
    for (const [name, roleId] of [
      ['admin', adminRole.id],
      ['non-admin', null],
      ['target', adminRole.id],
      ['self-reset', adminRole.id],
      ['password-change', adminRole.id],
    ] as const) {
      const secret = generateTotpSecret();
      const email = `${name}-${randomUUID()}@example.invalid`;
      const employee = await database!.employee.create({
        data: {
          email,
          displayName: `TOTP integration ${name}`,
          passwordHash,
          status: 'ACTIVE',
          totpEnabled: true,
          totpSecretCipher: encryptSecret(secret, encryptionKey),
          ...(roleId ? { roles: { create: { roleId } } } : {}),
        },
      });
      const token = generateOpaqueToken();
      const csrf = generateOpaqueToken();
      const session = await database!.staffSession.create({
        data: {
          employeeId: employee.id,
          tokenHash: hashOpaqueToken(token),
          csrfHash: hashOpaqueToken(csrf),
          twoFactorAt: new Date(),
          stepUpUntil: new Date(Date.now() + 60_000),
          expiresAt: new Date(Date.now() + 60 * 60_000),
        },
      });
      identities.set(name, {
        employeeId: employee.id,
        email,
        secret,
        token,
        csrf,
        sessionId: session.id,
      });
    }

    const config = loadConfig({
      NODE_ENV: 'test',
      APP_BASE_URL: 'http://localhost:3001',
      ADMIN_BASE_URL: 'http://localhost:3000',
      BOT_BASE_URL: 'http://localhost:3002',
      DATABASE_URL: databaseUrl!,
      REDIS_URL: redisUrl!,
      TELEGRAM_BOT_TOKEN: '123456:totp-management-test-token',
      TELEGRAM_WEBHOOK_SECRET: 'totp-management-test-webhook-secret',
      PUBLIC_BOT_USERNAME: 'hmqa_totp_management_test_bot',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_BUCKET: 'hmqa-totp-management-test',
      S3_ACCESS_KEY: 'totp-test-access',
      S3_SECRET_KEY: 'totp-test-secret',
      SERVICE_AUTH_SECRET: 'totp-test-service-secret',
      SESSION_SECRET: 'totp-test-session-secret',
      ENCRYPTION_KEY: encryptionKey,
      METRICS_TOKEN: 'totp-test-metrics-token',
    });
    app = await createApp({ config, database: database!, redis: redis! });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    const employeeIds = [...identities.values()].map((identity) => identity.employeeId);
    await database?.staffSession.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await database?.staffTotpEnrollment.deleteMany({
      where: { employeeId: { in: employeeIds } },
    });
    await database?.employeeRole.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await database?.employee.deleteMany({ where: { id: { in: employeeIds } } });
    await redis?.quit();
    await database?.$disconnect();
  });

  function staffHeaders(identity: Identity) {
    return {
      cookie: `hmqa_session=${identity.token}`,
      origin: 'http://localhost:3000',
      'x-csrf-token': identity.csrf,
    };
  }

  function stepUpPayload(identity: Identity) {
    return {
      currentPassword,
      currentTotp: generateTotpCode(identity.secret),
      confirmation: true,
    };
  }

  async function login(identity: Identity, password: string, totp: string) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: '203.0.113.42',
      payload: { email: identity.email, password, totp },
    });
  }

  it('forbids an unauthenticated reset', async () => {
    const target = identities.get('target')!;
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/employees/${target.employeeId}/totp/reset`,
      payload: { currentPassword, currentTotp: '000000', confirmation: true },
    });
    expect(response.statusCode).toBe(401);
  });

  it('forbids a non-admin from resetting another staff account', async () => {
    const nonAdmin = identities.get('non-admin')!;
    const target = identities.get('target')!;
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/employees/${target.employeeId}/totp/reset`,
      headers: staffHeaders(nonAdmin),
      payload: stepUpPayload(nonAdmin),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('requires fresh administrator password and TOTP for another-account reset', async () => {
    const admin = identities.get('admin')!;
    const target = identities.get('target')!;
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/employees/${target.employeeId}/totp/reset`,
      headers: staffHeaders(admin),
      payload: {
        currentPassword: 'Wrong-integration-password-2026!',
        currentTotp: generateTotpCode(admin.secret),
        confirmation: true,
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'STEP_UP_AUTH_FAILED' });
    expect(
      (await database!.employee.findUniqueOrThrow({ where: { id: target.employeeId } }))
        .totpEnabled,
    ).toBe(true);
  });

  it('resets TOTP, revokes sessions, rejects the old code, enrolls a new secret, and audits safely', async () => {
    const admin = identities.get('admin')!;
    const target = identities.get('target')!;
    const reset = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/employees/${target.employeeId}/totp/reset`,
      headers: staffHeaders(admin),
      payload: stepUpPayload(admin),
    });
    expect(reset.statusCode, reset.body).toBe(200);
    expect(reset.json()).toMatchObject({
      employeeId: target.employeeId,
      reEnrollmentRequired: true,
      sessionsRevoked: 1,
    });

    const afterReset = await database!.employee.findUniqueOrThrow({
      where: { id: target.employeeId },
    });
    expect(afterReset.totpEnabled).toBe(false);
    expect(afterReset.totpSecretCipher).toBeNull();
    expect(afterReset.totpResetRequiredAt).toBeInstanceOf(Date);
    expect(
      (await database!.staffSession.findUniqueOrThrow({ where: { id: target.sessionId } }))
        .revokedAt,
    ).toBeInstanceOf(Date);

    const resetAudit = await database!.auditLog.findFirstOrThrow({
      where: {
        actorId: admin.employeeId,
        entityId: target.employeeId,
        action: 'employee.totp.reset.admin',
      },
      orderBy: { createdAt: 'desc' },
    });
    const serializedResetAudit = JSON.stringify({
      before: resetAudit.before,
      after: resetAudit.after,
    });
    expect(serializedResetAudit).not.toContain(currentPassword);
    expect(serializedResetAudit).not.toContain(target.secret);
    expect(serializedResetAudit).not.toContain(generateTotpCode(admin.secret));

    const oldCode = generateTotpCode(target.secret);
    let enrollmentLogin = await login(target, currentPassword, oldCode);
    expect(enrollmentLogin.statusCode, enrollmentLogin.body).toBe(428);
    let enrollmentCookie = enrollmentLogin.cookies.find(
      (cookie) => cookie.name === 'hmqa_totp_enrollment',
    );
    expect(enrollmentCookie).toMatchObject({ httpOnly: true, sameSite: 'Strict' });

    let newSecret = '';
    let newCode = oldCode;
    for (let attempt = 0; attempt < 3 && newCode === oldCode; attempt += 1) {
      const inspected = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/totp/enrollment',
        headers: { cookie: `hmqa_totp_enrollment=${enrollmentCookie!.value}` },
      });
      expect(inspected.statusCode, inspected.body).toBe(200);
      newSecret = inspected.json<{ totpSecret: string }>().totpSecret;
      newCode = generateTotpCode(newSecret);
      if (newCode === oldCode) {
        enrollmentLogin = await login(target, currentPassword, oldCode);
        enrollmentCookie = enrollmentLogin.cookies.find(
          (cookie) => cookie.name === 'hmqa_totp_enrollment',
        );
      }
    }
    expect(newSecret).not.toBe(target.secret);
    expect(newCode).not.toBe(oldCode);

    const oldCodeCompletion = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/totp/enrollment/complete',
      headers: {
        cookie: `hmqa_totp_enrollment=${enrollmentCookie!.value}`,
        origin: 'http://localhost:3000',
      },
      payload: { totp: oldCode },
    });
    expect(oldCodeCompletion.statusCode).toBe(422);

    const completed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/totp/enrollment/complete',
      headers: {
        cookie: `hmqa_totp_enrollment=${enrollmentCookie!.value}`,
        origin: 'http://localhost:3000',
      },
      payload: { totp: newCode },
    });
    expect(completed.statusCode, completed.body).toBe(200);
    expect(completed.cookies.find((cookie) => cookie.name === 'hmqa_session')).toBeDefined();

    const enrolled = await database!.employee.findUniqueOrThrow({
      where: { id: target.employeeId },
    });
    expect(enrolled.totpEnabled).toBe(true);
    expect(enrolled.totpResetRequiredAt).toBeNull();
    expect(decryptSecret(enrolled.totpSecretCipher!, encryptionKey)).toBe(newSecret);
    expect(
      (
        await database!.staffTotpEnrollment.findFirstOrThrow({
          where: { employeeId: target.employeeId, completedAt: { not: null } },
          orderBy: { createdAt: 'desc' },
        })
      ).secretCipher,
    ).toBeNull();
    expect(
      await database!.auditLog.count({
        where: { entityId: target.employeeId, action: 'employee.totp.enrolled' },
      }),
    ).toBe(1);

    expect((await login(target, currentPassword, oldCode)).statusCode).toBe(401);
    expect((await login(target, currentPassword, newCode)).statusCode).toBe(200);
  });

  it('supports self-service reset and revokes every active self session', async () => {
    const identity = identities.get('self-reset')!;
    const secondToken = generateOpaqueToken();
    await database!.staffSession.create({
      data: {
        employeeId: identity.employeeId,
        tokenHash: hashOpaqueToken(secondToken),
        csrfHash: hashOpaqueToken(generateOpaqueToken()),
        twoFactorAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 60_000),
      },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/totp/reset',
      headers: staffHeaders(identity),
      payload: stepUpPayload(identity),
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(
      await database!.staffSession.count({
        where: { employeeId: identity.employeeId, revokedAt: null },
      }),
    ).toBe(0);
    expect(
      await database!.auditLog.count({
        where: { entityId: identity.employeeId, action: 'employee.totp.reset.self' },
      }),
    ).toBe(1);
  });

  it('changes a password with step-up and revokes all sessions without changing TOTP', async () => {
    const identity = identities.get('password-change')!;
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/change',
      headers: staffHeaders(identity),
      payload: { ...stepUpPayload(identity), newPassword: changedPassword },
    });
    expect(response.statusCode, response.body).toBe(204);
    expect(
      (await database!.staffSession.findUniqueOrThrow({ where: { id: identity.sessionId } }))
        .revokedAt,
    ).toBeInstanceOf(Date);
    const code = generateTotpCode(identity.secret);
    expect((await login(identity, currentPassword, code)).statusCode).toBe(401);
    expect((await login(identity, changedPassword, code)).statusCode).toBe(200);
    expect(
      await database!.auditLog.count({
        where: { entityId: identity.employeeId, action: 'employee.password.changed' },
      }),
    ).toBe(1);
  });
});
