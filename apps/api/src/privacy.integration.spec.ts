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
const token = `privacy-session-${randomUUID()}`;
const csrf = `privacy-csrf-${randomUUID()}`;
const serviceSecret = 'privacy-integration-service-secret';
let app: Awaited<ReturnType<typeof createApp>>;
let employeeId = '';
let userId = '';
const caseIds: string[] = [];
const holdIds: string[] = [];

suite('data-subject request and legal-hold integration', () => {
  beforeAll(async () => {
    const role = await database!.role.upsert({
      where: { code: 'ADMIN' },
      update: {},
      create: { code: 'ADMIN', description: 'Privacy integration administrator' },
    });
    const employee = await database!.employee.create({
      data: {
        email: `privacy-${randomUUID()}@example.invalid`,
        displayName: 'Privacy Integration Admin',
        status: 'ACTIVE',
      },
    });
    employeeId = employee.id;
    await database!.employeeRole.create({ data: { employeeId, roleId: role.id } });
    await database!.staffSession.create({
      data: {
        employeeId,
        tokenHash: hashOpaqueToken(token),
        csrfHash: hashOpaqueToken(csrf),
        twoFactorAt: new Date(),
        stepUpUntil: new Date(Date.now() + 10 * 60_000),
        expiresAt: new Date(Date.now() + 60 * 60_000),
      },
    });
    const user = await database!.user.create({
      data: { telegramUserId: BigInt(`8${Date.now().toString().slice(-9)}`), locale: 'en' },
    });
    userId = user.id;
    await database!.consentRecord.create({
      data: {
        userId,
        policyVersion: 'privacy-integration-v1',
        scope: 'submission_processing',
        granted: true,
        locale: 'en',
      },
    });
    const config = loadConfig({
      NODE_ENV: 'test',
      APP_BASE_URL: 'http://localhost:3001',
      ADMIN_BASE_URL: 'http://localhost:3000',
      BOT_BASE_URL: 'http://localhost:3002',
      DATABASE_URL: databaseUrl!,
      REDIS_URL: redisUrl!,
      TELEGRAM_BOT_TOKEN: '123456:privacy-integration-token',
      TELEGRAM_WEBHOOK_SECRET: 'privacy-integration-webhook-secret',
      PUBLIC_BOT_USERNAME: 'hmqa_privacy_test_bot',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_BUCKET: 'hmqa-test',
      S3_ACCESS_KEY: 'test-access',
      S3_SECRET_KEY: 'test-secret',
      SERVICE_AUTH_SECRET: serviceSecret,
      SESSION_SECRET: 'privacy-integration-session-secret',
      ENCRYPTION_KEY: 'privacy-integration-encryption-key',
      METRICS_TOKEN: 'privacy-integration-metrics-token',
      RETENTION_ENABLED: 'false',
    });
    app = await createApp({ config, database: database!, redis: redis! });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    if (userId) {
      await database?.notification.deleteMany({ where: { userId } });
      await database?.legalHold.deleteMany({ where: { id: { in: holdIds } } });
      await database?.dataSubjectRequest.deleteMany({ where: { id: { in: caseIds } } });
      await database?.draft.deleteMany({ where: { userId } });
      await database?.authorProfile.deleteMany({ where: { userId } });
      await database?.consentRecord.deleteMany({ where: { userId } });
      await database?.user.delete({ where: { id: userId } });
    }
    if (employeeId) {
      await database?.staffSession.deleteMany({ where: { employeeId } });
      await database?.employeeRole.deleteMany({ where: { employeeId } });
      await database?.employee.delete({ where: { id: employeeId } });
    }
    await redis?.quit();
    await database?.$disconnect();
  });

  const serviceHeaders = () => ({ 'x-hmqa-service-secret': serviceSecret });
  const staffHeaders = () => ({
    cookie: `hmqa_session=${token}`,
    origin: 'http://localhost:3000',
    'x-csrf-token': csrf,
  });

  it('persists a durable self-service profile and returns masked contact values', async () => {
    const user = await database!.user.findUniqueOrThrow({ where: { id: userId } });
    const telegramUserId = String(user.telegramUserId);
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/internal/telegram/users/${telegramUserId}/profile-draft`,
      headers: serviceHeaders(),
      payload: { section: 'all' },
    });
    expect(created.statusCode).toBe(201);
    const draft = created.json<{ id: string; rowVersion: number }>();
    const advanced = await app.inject({
      method: 'PATCH',
      url: `/api/v1/internal/telegram/users/${telegramUserId}/drafts/${draft.id}`,
      headers: serviceHeaders(),
      payload: {
        expectedRowVersion: draft.rowVersion,
        machineState: 'PROFILE_CONFIRM',
        expectedInputType: 'CALLBACK',
        contextPatch: {
          firstName: 'Privacy',
          lastName: 'Author',
          middleName: '-',
          phone: '+999000000001',
          email: 'privacy.author@example.invalid',
          organization: 'Example Academy',
          position: 'Researcher',
          degree: 'PhD',
          academicTitle: '-',
          country: 'Uzbekistan',
          city: 'Tashkent',
          orcid: '0000-0002-1825-0097',
        },
      },
    });
    expect(advanced.statusCode).toBe(200);
    const submitted = await app.inject({
      method: 'POST',
      url: `/api/v1/internal/telegram/users/${telegramUserId}/profile-drafts/${draft.id}/submit`,
      headers: serviceHeaders(),
      payload: { expectedRowVersion: advanced.json<{ rowVersion: number }>().rowVersion },
    });
    expect(submitted.statusCode).toBe(200);
    const profile = await database!.authorProfile.findUniqueOrThrow({ where: { userId } });
    expect(profile).toMatchObject({
      firstName: 'Privacy',
      middleName: null,
      degree: 'PhD',
      orcid: '0000-0002-1825-0097',
    });
    const synced = await app.inject({
      method: 'POST',
      url: '/api/v1/internal/telegram/users/sync',
      headers: serviceHeaders(),
      payload: {
        telegramUserId,
        telegramChatId: telegramUserId,
        username: 'privacy_test',
      },
    });
    expect(synced.statusCode).toBe(200);
    expect(synced.json()).toMatchObject({
      profile: { email: 'pr************@example.invalid', phone: '+99********01' },
    });
  });

  it('deduplicates active author requests and exposes only the owner list', async () => {
    const telegramUserId = String(
      (await database!.user.findUniqueOrThrow({ where: { id: userId } })).telegramUserId,
    );
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/internal/telegram/users/${telegramUserId}/data-subject-requests`,
      headers: serviceHeaders(),
      payload: { type: 'ACCESS' },
    });
    expect(created.statusCode).toBe(201);
    const item = created.json<{ id: string; publicId: string; created: boolean }>();
    caseIds.push(item.id);
    expect(item).toMatchObject({ created: true, publicId: expect.stringMatching(/^DSR-/) });

    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/v1/internal/telegram/users/${telegramUserId}/data-subject-requests`,
      headers: serviceHeaders(),
      payload: { type: 'ACCESS' },
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toMatchObject({ id: item.id, created: false });

    const ownList = await app.inject({
      method: 'GET',
      url: `/api/v1/internal/telegram/users/${telegramUserId}/data-subject-requests`,
      headers: serviceHeaders(),
    });
    expect(ownList.statusCode).toBe(200);
    expect(ownList.json<{ items: { id: string }[] }>().items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: item.id })]),
    );
  });

  it('enforces case transitions, legal holds, reports, and unapproved retention policy', async () => {
    const accessCase = await database!.dataSubjectRequest.findFirstOrThrow({
      where: { id: caseIds[0]! },
    });
    let rowVersion = accessCase.rowVersion;
    for (const targetStatus of ['IDENTITY_VERIFICATION', 'IN_REVIEW'] as const) {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/privacy/requests/${accessCase.id}`,
        headers: staffHeaders(),
        payload: { expectedRowVersion: rowVersion, targetStatus },
      });
      expect(response.statusCode).toBe(200);
      rowVersion = response.json<{ rowVersion: number }>().rowVersion;
    }
    const approved = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/privacy/requests/${accessCase.id}`,
      headers: staffHeaders(),
      payload: {
        expectedRowVersion: rowVersion,
        targetStatus: 'APPROVED',
        decisionReason: 'Verified request is approved for the access procedure.',
      },
    });
    expect(approved.statusCode).toBe(200);
    rowVersion = approved.json<{ rowVersion: number }>().rowVersion;

    const hold = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/privacy/legal-holds',
      headers: staffHeaders(),
      payload: {
        subjectUserId: userId,
        dataSubjectRequestId: accessCase.id,
        reason: 'Preserve evidence while an authorized investigation is active.',
      },
    });
    expect(hold.statusCode).toBe(201);
    const holdId = hold.json<{ id: string }>().id;
    holdIds.push(holdId);

    const blocked = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/privacy/requests/${accessCase.id}`,
      headers: staffHeaders(),
      payload: { expectedRowVersion: rowVersion, targetStatus: 'EXECUTING' },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ code: 'LEGAL_HOLD_ACTIVE' });

    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/admin/privacy/legal-holds/${holdId}/release`,
          headers: staffHeaders(),
          payload: {
            releaseReason: 'The investigation is closed and preservation is no longer required.',
          },
        })
      ).statusCode,
    ).toBe(200);
    const executing = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/privacy/requests/${accessCase.id}`,
      headers: staffHeaders(),
      payload: { expectedRowVersion: rowVersion, targetStatus: 'EXECUTING' },
    });
    expect(executing.statusCode).toBe(200);
    rowVersion = executing.json<{ rowVersion: number }>().rowVersion;

    const missingReport = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/privacy/requests/${accessCase.id}`,
      headers: staffHeaders(),
      payload: { expectedRowVersion: rowVersion, targetStatus: 'COMPLETED' },
    });
    expect(missingReport.statusCode).toBe(422);
    const completed = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/privacy/requests/${accessCase.id}`,
      headers: staffHeaders(),
      payload: {
        expectedRowVersion: rowVersion,
        targetStatus: 'COMPLETED',
        executionReport: { artifactId: 'privacy-export-evidence' },
      },
    });
    expect(completed.statusCode).toBe(200);

    const erasure = await database!.dataSubjectRequest.create({
      data: {
        publicId: `DSR-${new Date().getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`,
        userId,
        type: 'ERASURE',
        status: 'APPROVED',
        locale: 'en',
        decisionReason: 'Synthetic approved erasure case for the policy guard test.',
        dueAt: new Date(Date.now() + 86_400_000),
      },
    });
    caseIds.push(erasure.id);
    const policyBlocked = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/privacy/requests/${erasure.id}`,
      headers: staffHeaders(),
      payload: { expectedRowVersion: erasure.rowVersion, targetStatus: 'EXECUTING' },
    });
    expect(policyBlocked.statusCode).toBe(409);
    expect(policyBlocked.json()).toMatchObject({ code: 'RETENTION_POLICY_NOT_APPROVED' });
  });
});
