import { randomUUID } from 'node:crypto';
import { loadConfig } from '@hmqa/config';
import { createPrismaClient } from '@hmqa/database';
import { roles, type Role } from '@hmqa/domain';
import { hashOpaqueToken } from '@hmqa/security';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const suite = databaseUrl && redisUrl ? describe : describe.skip;
const database = databaseUrl ? createPrismaClient(databaseUrl) : null;
const redis = redisUrl ? new Redis(redisUrl, { maxRetriesPerRequest: 2 }) : null;
const sessions = new Map<Role, { employeeId: string; token: string; csrf: string }>();
let app: Awaited<ReturnType<typeof createApp>>;
let scopedSubmissionId = '';
let foreignSubmissionId = '';
let decisionSubmissionId = '';

function headersFor(role: Role, csrf = false) {
  const session = sessions.get(role)!;
  return {
    cookie: `hmqa_session=${session.token}`,
    ...(csrf ? { origin: 'http://localhost:3000', 'x-csrf-token': session.csrf } : {}),
  };
}

suite('exhaustive backend RBAC boundaries', () => {
  beforeAll(async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
    for (const roleCode of roles) {
      const role = await database!.role.upsert({
        where: { code: roleCode },
        update: {},
        create: { code: roleCode, description: `Integration ${roleCode}` },
      });
      const employee = await database!.employee.create({
        data: {
          email: `${roleCode.toLowerCase()}-${randomUUID()}@example.invalid`,
          displayName: `Integration ${roleCode}`,
          status: 'ACTIVE',
        },
      });
      await database!.employeeRole.create({ data: { employeeId: employee.id, roleId: role.id } });
      const token = `session-${roleCode}-${randomUUID()}`;
      const csrf = `csrf-${roleCode}-${randomUUID()}`;
      await database!.staffSession.create({
        data: {
          employeeId: employee.id,
          tokenHash: hashOpaqueToken(token),
          csrfHash: hashOpaqueToken(csrf),
          twoFactorAt: new Date(),
          stepUpUntil: new Date(Date.now() + 60_000),
          expiresAt: new Date(Date.now() + 60 * 60_000),
        },
      });
      sessions.set(roleCode, { employeeId: employee.id, token, csrf });
    }

    const [journalA, journalB, owner] = await Promise.all([
      database!.journal.create({ data: { code: `RA${suffix}`, mode: 'NATIVE', active: true } }),
      database!.journal.create({ data: { code: `RB${suffix}`, mode: 'NATIVE', active: true } }),
      database!.user.create({
        data: {
          telegramUserId: BigInt(`6${Date.now()}`),
          telegramChatId: BigInt(`6${Date.now()}`),
          locale: 'ru',
        },
      }),
    ]);
    const requirementConfig = {
      requiredFiles: [
        {
          category: 'MANUSCRIPT',
          labels: { 'uz-Latn': 'Maqola', ru: 'Статья', en: 'Article' },
          formats: ['docx'],
          required: true,
          preflightRequired: true,
        },
      ],
      limits: { maxBytes: 1024 * 1024, maxFiles: 2, maxTotalBytes: 2 * 1024 * 1024 },
      workflow: {
        reviewModel: 'NO_EXTERNAL_REVIEW',
        requiredReviewerCount: 0,
        decisionRequiresCompletedReviews: false,
      },
    };
    const [requirementA, requirementB] = await Promise.all([
      database!.journalRequirementVersion.create({
        data: {
          journalId: journalA.id,
          version: 1,
          state: 'PUBLISHED',
          config: requirementConfig,
          configHash: 'a'.repeat(64),
          changeNote: 'DEV/TEST ONLY — REQUIRES ACADEMY APPROVAL',
          effectiveAt: new Date(),
          publishedAt: new Date(),
        },
      }),
      database!.journalRequirementVersion.create({
        data: {
          journalId: journalB.id,
          version: 1,
          state: 'PUBLISHED',
          config: requirementConfig,
          configHash: 'b'.repeat(64),
          changeNote: 'DEV/TEST ONLY — REQUIRES ACADEMY APPROVAL',
          effectiveAt: new Date(),
          publishedAt: new Date(),
        },
      }),
    ]);
    const [scoped, foreign, decision] = await Promise.all([
      database!.submission.create({
        data: {
          publicId: `RBAC-A-${suffix}`,
          journalId: journalA.id,
          ownerId: owner.id,
          requirementVersionId: requirementA.id,
          status: 'SUBMITTED',
        },
      }),
      database!.submission.create({
        data: {
          publicId: `RBAC-B-${suffix}`,
          journalId: journalB.id,
          ownerId: owner.id,
          requirementVersionId: requirementB.id,
          status: 'SUBMITTED',
        },
      }),
      database!.submission.create({
        data: {
          publicId: `RBAC-D-${suffix}`,
          journalId: journalA.id,
          ownerId: owner.id,
          requirementVersionId: requirementA.id,
          status: 'EDITORIAL_REVIEW',
        },
      }),
    ]);
    scopedSubmissionId = scoped.id;
    foreignSubmissionId = foreign.id;
    decisionSubmissionId = decision.id;

    await database!.employeeJournalScope.createMany({
      data: ['OPERATOR', 'EDITOR', 'CHIEF_EDITOR', 'CONTENT_ADMIN'].map((role) => ({
        employeeId: sessions.get(role as Role)!.employeeId,
        journalId: journalA.id,
      })),
    });

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
    await redis?.quit();
    await database?.$disconnect();
  });

  it('rejects missing and expired staff sessions', async () => {
    const missing = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(missing.statusCode).toBe(401);

    const employee = await database!.employee.create({
      data: {
        email: `expired-${randomUUID()}@example.invalid`,
        displayName: 'Expired session',
        status: 'ACTIVE',
      },
    });
    const expiredToken = `expired-${randomUUID()}`;
    await database!.staffSession.create({
      data: {
        employeeId: employee.id,
        tokenHash: hashOpaqueToken(expiredToken),
        csrfHash: hashOpaqueToken(randomUUID()),
        twoFactorAt: new Date(Date.now() - 120_000),
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    const expired = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: `hmqa_session=${expiredToken}` },
    });
    expect(expired.statusCode).toBe(401);
  });

  it('enforces the reviewed role-to-resource matrix through HTTP responses', async () => {
    const resources = [
      '/api/v1/admin/submissions',
      '/api/v1/admin/reviews/assigned',
      '/api/v1/admin/employees',
      '/api/v1/admin/audit',
      '/api/v1/admin/reports/overview',
      '/api/v1/admin/settings/runtime',
    ] as const;
    const expected: Record<Role, readonly number[]> = {
      AUTHOR: [403, 403, 403, 403, 403, 403],
      OPERATOR: [200, 403, 403, 200, 403, 403],
      EDITOR: [200, 403, 403, 200, 403, 403],
      REVIEWER: [403, 200, 403, 403, 403, 403],
      CHIEF_EDITOR: [200, 403, 403, 200, 200, 403],
      CONTENT_ADMIN: [403, 403, 403, 200, 403, 403],
      ADMIN: [403, 403, 200, 200, 403, 200],
      AUDITOR: [403, 403, 403, 200, 200, 200],
    };
    for (const role of roles) {
      for (const [index, resource] of resources.entries()) {
        const response = await app.inject({
          method: 'GET',
          url: resource,
          headers: headersFor(role),
        });
        expect(response.statusCode, `${role}:${resource}`).toBe(expected[role][index]);
      }
    }
  });

  it('prevents a journal-scoped operator from listing or reading another journal', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/submissions',
      headers: headersFor('OPERATOR'),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<{ items: { id: string }[] }>().items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: scopedSubmissionId })]),
    );
    expect(list.json<{ items: { id: string }[] }>().items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: foreignSubmissionId })]),
    );

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/submissions/${foreignSubmissionId}`,
      headers: headersFor('OPERATOR'),
    });
    expect(detail.statusCode).toBe(403);
  });

  it('denies reviewer assignment and final decisions to unprivileged roles', async () => {
    const reviewerAssignment = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/submissions/${scopedSubmissionId}/reviewer-assignments`,
      headers: { ...headersFor('REVIEWER', true), 'content-type': 'application/json' },
      payload: {},
    });
    expect(reviewerAssignment.statusCode).toBe(403);

    const editorDecision = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/submissions/${decisionSubmissionId}/transitions`,
      headers: { ...headersFor('EDITOR', true), 'content-type': 'application/json' },
      payload: {
        confirm: true,
        expectedRowVersion: 0,
        targetStatus: 'ACCEPTED',
        publicReason: 'Integration decision',
        internalReason: 'Integration decision basis',
      },
    });
    expect(editorDecision.statusCode).toBe(403);

    const chiefDecision = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/submissions/${decisionSubmissionId}/transitions`,
      headers: { ...headersFor('CHIEF_EDITOR', true), 'content-type': 'application/json' },
      payload: {
        confirm: true,
        expectedRowVersion: 0,
        targetStatus: 'ACCEPTED',
        publicReason: 'Integration decision',
        internalReason: 'Integration decision basis',
      },
    });
    expect(chiefDecision.statusCode).toBe(200);
  });
});
