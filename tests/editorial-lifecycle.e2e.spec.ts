import { randomUUID } from 'node:crypto';
import { loadConfig } from '@hmqa/config';
import { createPrismaClient } from '@hmqa/database';
import { encryptSecret, hashOpaqueToken } from '@hmqa/security';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../apps/api/src/app.js';

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const suite = databaseUrl && redisUrl ? describe : describe.skip;
const database = databaseUrl ? createPrismaClient(databaseUrl) : null;
const redis = redisUrl ? new Redis(redisUrl, { maxRetriesPerRequest: 2 }) : null;
const serviceSecret = 'editorial-lifecycle-service-secret';
const encryptionKey = 'editorial-lifecycle-encryption-key';
const staff = new Map<string, { employeeId: string; token: string; csrf: string }>();
let app: Awaited<ReturnType<typeof createApp>>;
let telegramUserId = '';
let ownerId = '';
let journalId = '';
let requirementId = '';
let submissionId = '';

function staffHeaders(role: string) {
  const identity = staff.get(role)!;
  return {
    cookie: `hmqa_session=${identity.token}`,
    origin: 'http://localhost:3000',
    'x-csrf-token': identity.csrf,
    'content-type': 'application/json',
  };
}

async function transition(
  role: string,
  id: string,
  expectedRowVersion: number,
  targetStatus: string,
  additional: Record<string, unknown> = {},
) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/admin/submissions/${id}/transitions`,
    headers: staffHeaders(role),
    payload: { confirm: true, expectedRowVersion, targetStatus, ...additional },
  });
}

suite('end-to-end editorial and revision lifecycle', () => {
  beforeAll(async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    for (const roleCode of ['AUTHOR', 'OPERATOR', 'EDITOR', 'CHIEF_EDITOR', 'ADMIN'] as const) {
      const role = await database!.role.findUniqueOrThrow({ where: { code: roleCode } });
      const employee = await database!.employee.create({
        data: {
          email: `${roleCode.toLowerCase()}-lifecycle-${randomUUID()}@example.invalid`,
          displayName: `Lifecycle ${roleCode}`,
          status: 'ACTIVE',
        },
      });
      await database!.employeeRole.create({ data: { employeeId: employee.id, roleId: role.id } });
      const token = `lifecycle-${roleCode}-${randomUUID()}`;
      const csrf = `lifecycle-csrf-${roleCode}-${randomUUID()}`;
      await database!.staffSession.create({
        data: {
          employeeId: employee.id,
          tokenHash: hashOpaqueToken(token),
          csrfHash: hashOpaqueToken(csrf),
          twoFactorAt: new Date(),
          stepUpUntil: new Date(Date.now() + 10 * 60_000),
          expiresAt: new Date(Date.now() + 60 * 60_000),
        },
      });
      staff.set(roleCode, { employeeId: employee.id, token, csrf });
    }

    telegramUserId = `4${Date.now()}`;
    const owner = await database!.user.create({
      data: {
        telegramUserId: BigInt(telegramUserId),
        telegramChatId: BigInt(telegramUserId),
        locale: 'en',
      },
    });
    ownerId = owner.id;
    await Promise.all([
      database!.authorProfile.create({
        data: {
          userId: ownerId,
          firstName: 'Lifecycle',
          lastName: 'Author',
          middleName: 'Test',
          phoneCipher: encryptSecret('+999000000001', encryptionKey),
          phoneHash: hashOpaqueToken('+999000000001'),
          emailCipher: encryptSecret('lifecycle@example.invalid', encryptionKey),
          emailHash: hashOpaqueToken('lifecycle@example.invalid'),
          organization: 'DEV/TEST ONLY — REQUIRES ACADEMY APPROVAL',
          position: 'Test author',
          degree: 'PhD',
          country: 'Uzbekistan',
          city: 'Tashkent',
          orcid: '0000-0002-1825-0097',
        },
      }),
      database!.consentRecord.create({
        data: {
          userId: ownerId,
          policyVersion: 'dev-test-only-v1',
          scope: 'submission_processing',
          granted: true,
          locale: 'en',
        },
      }),
    ]);
    const journal = await database!.journal.create({
      data: {
        code: `E${suffix}`.slice(0, 16),
        mode: 'NATIVE',
        active: true,
        fourEyesRequired: false,
      },
    });
    journalId = journal.id;
    const requirement = await database!.journalRequirementVersion.create({
      data: {
        journalId,
        version: 1,
        state: 'PUBLISHED',
        config: {
          requiredFiles: [
            {
              category: 'MANUSCRIPT',
              labels: { 'uz-Latn': 'Maqola', ru: 'Статья', en: 'Article' },
              formats: ['docx'],
              required: true,
              preflightRequired: true,
            },
          ],
          limits: {
            maxBytes: 1024 * 1024,
            maxFiles: 2,
            maxTotalBytes: 2 * 1024 * 1024,
          },
          preflight: { docx: { rulesVersion: 'lifecycle-e2e-v1', requiredMarkers: [] } },
          metadata: {
            abstractMinWords: 5,
            abstractMaxWords: 100,
            keywordMinCount: 3,
            keywordMaxCount: 10,
            coauthorMaxCount: 10,
          },
          workflow: {
            reviewModel: 'SINGLE_BLIND',
            requiredReviewerCount: 1,
            decisionRequiresCompletedReviews: false,
          },
        },
        configHash: randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64),
        changeNote: 'DEV/TEST ONLY — REQUIRES ACADEMY APPROVAL',
        effectiveAt: new Date(),
        publishedAt: new Date(),
      },
    });
    requirementId = requirement.id;
    await database!.journal.update({
      where: { id: journalId },
      data: { currentRequirementId: requirementId },
    });
    await database!.employeeJournalScope.createMany({
      data: ['OPERATOR', 'EDITOR', 'CHIEF_EDITOR'].map((roleCode) => ({
        employeeId: staff.get(roleCode)!.employeeId,
        journalId,
      })),
    });

    const originalFile = await database!.fileAsset.create({
      data: {
        objectKey: `e2e/lifecycle/${suffix}/v1.docx`,
        originalName: 'manuscript-v1.docx',
        declaredMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        detectedMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        extension: 'docx',
        sizeBytes: 1024n,
        sha256: '1'.repeat(64),
        scanStatus: 'CLEAN',
        storageStatus: 'STORED',
        storedAt: new Date(),
        provenance: { provider: 'e2e' },
      },
    });
    const submission = await database!.submission.create({
      data: {
        publicId: `LIFECYCLE-${suffix}`,
        journalId,
        ownerId,
        requirementVersionId: requirementId,
        status: 'SUBMITTED',
      },
    });
    submissionId = submission.id;
    const version = await database!.submissionVersion.create({
      data: {
        submissionId,
        versionNo: 1,
        profileSnapshot: { firstName: 'Lifecycle', lastName: 'Author' },
        declarations: { originalityConfirmed: true },
        submittedById: ownerId,
      },
    });
    await Promise.all([
      database!.submissionAuthor.create({
        data: {
          submissionVersionId: version.id,
          authorOrder: 1,
          isCorresponding: true,
          dataSnapshot: { firstName: 'Lifecycle', lastName: 'Author' },
        },
      }),
      database!.submissionMetadata.create({
        data: {
          submissionVersionId: version.id,
          manuscriptLanguage: 'en',
          articleType: 'Research article',
          sectionCode: 'law',
          titles: { en: 'Lifecycle verification' },
          abstracts: { en: 'A complete runtime lifecycle verification abstract.' },
          keywords: { en: ['workflow', 'journal', 'testing'] },
          fingerprint: '3'.repeat(64),
        },
      }),
      database!.submissionFile.create({
        data: {
          submissionVersionId: version.id,
          fileId: originalFile.id,
          category: 'MANUSCRIPT',
          required: true,
          versionNo: 1,
        },
      }),
      database!.preflightRun.create({
        data: {
          submissionVersionId: version.id,
          fileId: originalFile.id,
          status: 'COMPLETED',
          ruleSetVersion: 'lifecycle-e2e-v1',
          toolVersion: 'e2e',
          blockingCount: 0,
          finishedAt: new Date(),
        },
      }),
      database!.assignment.create({
        data: {
          submissionId,
          employeeId: staff.get('EDITOR')!.employeeId,
          journalId,
          kind: 'EDITOR',
          status: 'ACCEPTED',
          reason: 'Lifecycle E2E',
          assignedById: staff.get('CHIEF_EDITOR')!.employeeId,
        },
      }),
    ]);
    const reviewerEmployee = await database!.employee.create({
      data: {
        email: `reviewer-lifecycle-${randomUUID()}@example.invalid`,
        displayName: 'Lifecycle reviewer',
        status: 'ACTIVE',
      },
    });
    const reviewer = await database!.reviewerProfile.create({
      data: {
        employeeId: reviewerEmployee.id,
        expertise: ['DEV/TEST ONLY'],
        affiliation: 'DEV/TEST ONLY — REQUIRES ACADEMY APPROVAL',
      },
    });
    const anonymized = await database!.fileAsset.create({
      data: {
        objectKey: `e2e/lifecycle/${suffix}/anonymous-v1.pdf`,
        originalName: 'anonymous-v1.pdf',
        declaredMime: 'application/pdf',
        detectedMime: 'application/pdf',
        extension: 'pdf',
        sizeBytes: 512n,
        sha256: '4'.repeat(64),
        scanStatus: 'CLEAN',
        storageStatus: 'STORED',
        storedAt: new Date(),
        provenance: { provider: 'e2e', anonymizationAttested: true },
      },
    });
    await database!.reviewAssignment.create({
      data: {
        submissionId,
        reviewerId: reviewer.id,
        anonymizedFileId: anonymized.id,
        status: 'ACCEPTED',
        conflictDeclared: false,
        deadline: new Date(Date.now() + 7 * 86_400_000),
      },
    });

    const config = loadConfig({
      NODE_ENV: 'test',
      APP_BASE_URL: 'http://localhost:3001',
      ADMIN_BASE_URL: 'http://localhost:3000',
      BOT_BASE_URL: 'http://localhost:3002',
      DATABASE_URL: databaseUrl!,
      REDIS_URL: redisUrl!,
      TELEGRAM_BOT_TOKEN: '123456:lifecycle-test-token',
      TELEGRAM_WEBHOOK_SECRET: 'lifecycle-webhook-secret',
      PUBLIC_BOT_USERNAME: 'hmqa_lifecycle_test_bot',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_BUCKET: 'hmqa-lifecycle-test',
      S3_ACCESS_KEY: 'lifecycle-access',
      S3_SECRET_KEY: 'lifecycle-secret',
      SERVICE_AUTH_SECRET: serviceSecret,
      SESSION_SECRET: 'lifecycle-session-secret',
      ENCRYPTION_KEY: encryptionKey,
      METRICS_TOKEN: 'lifecycle-metrics-token',
    });
    app = await createApp({ config, database: database!, redis: redis! });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await redis?.quit();
    await database?.$disconnect();
  });

  it('runs intake, review, immutable revision, acceptance, copyediting, layout, and publication', async () => {
    const sequence = [
      ['OPERATOR', 'TECHNICAL_REVIEW', {}],
      ['OPERATOR', 'REGISTERED', {}],
      ['EDITOR', 'EDITORIAL_REVIEW', {}],
      ['EDITOR', 'UNDER_REVIEW', {}],
      [
        'EDITOR',
        'REVISION_REQUESTED',
        {
          publicReason: 'Please provide a corrected version.',
          deadline: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        },
      ],
    ] as const;
    let rowVersion = 0;
    for (const [role, status, additional] of sequence) {
      const response = await transition(role, submissionId, rowVersion, status, additional);
      expect(response.statusCode, `${role}:${status}:${response.body}`).toBe(200);
      rowVersion += 1;
      expect(response.json()).toMatchObject({ toStatus: status, rowVersion });
    }

    const revisionDraftResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/internal/telegram/users/${telegramUserId}/submissions/${submissionId}/revision-draft`,
      headers: { 'x-hmqa-service-secret': serviceSecret },
    });
    expect(revisionDraftResponse.statusCode).toBe(201);
    const revisionDraft = revisionDraftResponse.json<{ id: string; rowVersion: number }>();
    const revisedFile = await database!.fileAsset.create({
      data: {
        objectKey: `e2e/lifecycle/${submissionId}/v2.docx`,
        originalName: 'manuscript-v2.docx',
        declaredMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        detectedMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        extension: 'docx',
        sizeBytes: 2048n,
        sha256: '2'.repeat(64),
        scanStatus: 'CLEAN',
        storageStatus: 'STORED',
        storedAt: new Date(),
        provenance: { provider: 'e2e-revision' },
      },
    });
    await Promise.all([
      database!.draftFile.create({
        data: {
          draftId: revisionDraft.id,
          fileId: revisedFile.id,
          category: 'MANUSCRIPT',
          required: true,
        },
      }),
      database!.draftPreflightRun.create({
        data: {
          draftId: revisionDraft.id,
          fileId: revisedFile.id,
          status: 'COMPLETED',
          ruleSetVersion: 'lifecycle-e2e-v1',
          toolVersion: 'e2e',
          blockingCount: 0,
          finishedAt: new Date(),
        },
      }),
    ]);
    const preview = await app.inject({
      method: 'PATCH',
      url: `/api/v1/internal/telegram/users/${telegramUserId}/drafts/${revisionDraft.id}`,
      headers: {
        'x-hmqa-service-secret': serviceSecret,
        'content-type': 'application/json',
      },
      payload: {
        expectedRowVersion: revisionDraft.rowVersion,
        machineState: 'PREVIEW',
        expectedInputType: 'CALLBACK',
        contextPatch: {},
      },
    });
    expect(preview.statusCode).toBe(200);
    const revised = await app.inject({
      method: 'POST',
      url: `/api/v1/internal/telegram/users/${telegramUserId}/drafts/${revisionDraft.id}/submit`,
      headers: {
        'x-hmqa-service-secret': serviceSecret,
        'content-type': 'application/json',
        'idempotency-key': `revision-${submissionId}`,
      },
      payload: { expectedRowVersion: revisionDraft.rowVersion + 1 },
    });
    expect(revised.statusCode, revised.body).toBe(201);
    expect(revised.json()).toMatchObject({
      submissionId,
      publicId: expect.any(String),
      status: 'REVISION_SUBMITTED',
    });
    rowVersion += 1;

    for (const [role, status, additional] of [
      ['EDITOR', 'UNDER_REVIEW', {}],
      [
        'CHIEF_EDITOR',
        'ACCEPTED',
        { publicReason: 'Accepted after revision.', internalReason: 'Requirements satisfied.' },
      ],
      ['CHIEF_EDITOR', 'COPYEDITING', {}],
      ['CHIEF_EDITOR', 'LAYOUT', {}],
      [
        'CHIEF_EDITOR',
        'PUBLISHED',
        { publicationReference: 'https://example.invalid/journal/published-lifecycle' },
      ],
    ] as const) {
      const response = await transition(role, submissionId, rowVersion, status, additional);
      expect(response.statusCode, `${role}:${status}:${response.body}`).toBe(200);
      rowVersion += 1;
    }

    const stored = await database!.submission.findUniqueOrThrow({
      where: { id: submissionId },
      include: {
        versions: {
          orderBy: { versionNo: 'asc' },
          include: { files: { include: { file: true } } },
        },
        statusHistory: { orderBy: { createdAt: 'asc' } },
        notifications: true,
      },
    });
    expect(stored).toMatchObject({ status: 'PUBLISHED', currentVersionNo: 2, rowVersion: 11 });
    expect(stored.versions).toHaveLength(2);
    expect(stored.versions.map((version) => version.versionNo)).toEqual([1, 2]);
    expect(stored.versions[0]!.files[0]!.file.objectKey).not.toBe(
      stored.versions[1]!.files[0]!.file.objectKey,
    );
    expect(stored.statusHistory.map((item) => item.toStatus)).toEqual([
      'TECHNICAL_REVIEW',
      'REGISTERED',
      'EDITORIAL_REVIEW',
      'UNDER_REVIEW',
      'REVISION_REQUESTED',
      'REVISION_SUBMITTED',
      'UNDER_REVIEW',
      'ACCEPTED',
      'COPYEDITING',
      'LAYOUT',
      'PUBLISHED',
    ]);
    expect(stored.notifications).toHaveLength(11);
    expect(await database!.auditLog.count({ where: { entityId: submissionId } })).toBe(11);
  });

  it('rejects an author decision and executes the independent rejection branch', async () => {
    const forbidden = await database!.submission.create({
      data: {
        publicId: `FORBIDDEN-${randomUUID().slice(0, 8)}`,
        journalId,
        ownerId,
        requirementVersionId: requirementId,
        status: 'REGISTERED',
      },
    });
    const denied = await transition('AUTHOR', forbidden.id, 0, 'ACCEPTED', {
      publicReason: 'Self acceptance is forbidden.',
      internalReason: 'Forbidden path.',
    });
    expect(denied.statusCode).toBe(409);
    expect(denied.json()).toMatchObject({ code: 'INVALID_TRANSITION' });
    expect(await database!.statusHistory.count({ where: { submissionId: forbidden.id } })).toBe(0);

    const rejected = await database!.submission.create({
      data: {
        publicId: `REJECT-${randomUUID().slice(0, 8)}`,
        journalId,
        ownerId,
        requirementVersionId: requirementId,
        status: 'EDITORIAL_REVIEW',
      },
    });
    const reject = await transition('CHIEF_EDITOR', rejected.id, 0, 'REJECTED', {
      publicReason: 'Outside the journal scope.',
      internalReason: 'Editorial scope decision.',
    });
    expect(reject.statusCode, reject.body).toBe(200);
    const archived = await transition('ADMIN', rejected.id, 1, 'ARCHIVED');
    expect(archived.statusCode, archived.body).toBe(200);
    expect(
      await database!.submission.findUniqueOrThrow({ where: { id: rejected.id } }),
    ).toMatchObject({ status: 'ARCHIVED', rowVersion: 2 });
  });
});
