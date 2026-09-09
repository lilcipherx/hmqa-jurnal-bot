import { randomUUID } from 'node:crypto';
import { loadConfig } from '@hmqa/config';
import { createPrismaClient } from '@hmqa/database';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../apps/api/src/app.js';

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const suite = databaseUrl && redisUrl ? describe : describe.skip;
const database = databaseUrl ? createPrismaClient(databaseUrl) : null;
const redis = redisUrl ? new Redis(redisUrl, { maxRetriesPerRequest: 2 }) : null;
const serviceSecret = 'e2e-service-secret';
let app: Awaited<ReturnType<typeof createApp>>;

suite('author submission lifecycle', () => {
  beforeAll(async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      APP_BASE_URL: 'http://localhost:3001',
      ADMIN_BASE_URL: 'http://localhost:3000',
      BOT_BASE_URL: 'http://localhost:3002',
      DATABASE_URL: databaseUrl!,
      REDIS_URL: redisUrl!,
      TELEGRAM_BOT_TOKEN: '123456:e2e-token',
      TELEGRAM_WEBHOOK_SECRET: 'e2e-webhook-secret',
      PUBLIC_BOT_USERNAME: 'hmqa_e2e_bot',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_BUCKET: 'hmqa-e2e',
      S3_ACCESS_KEY: 'e2e-access',
      S3_SECRET_KEY: 'e2e-secret',
      SERVICE_AUTH_SECRET: serviceSecret,
      SESSION_SECRET: 'e2e-session-secret',
      ENCRYPTION_KEY: 'e2e-encryption-key',
      METRICS_TOKEN: 'e2e-metrics-token',
    });
    app = await createApp({ config, database: database!, redis: redis! });
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
    await redis?.quit();
    await database?.$disconnect();
  });

  it('persists consent, draft, clean file, immutable requirement and SUBMITTED registration', async () => {
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const journal = await database!.journal.create({
      data: {
        code: `E${suffix}`.slice(0, 16),
        mode: 'NATIVE',
        active: true,
        localizations: {
          create: [
            { locale: 'uz_Latn', name: 'E2E jurnal', shortName: 'E2E', description: 'E2E' },
            { locale: 'ru', name: 'E2E журнал', shortName: 'E2E', description: 'E2E' },
            { locale: 'en', name: 'E2E journal', shortName: 'E2E', description: 'E2E' },
          ],
        },
      },
    });
    const requirement = await database!.journalRequirementVersion.create({
      data: {
        journalId: journal.id,
        version: 1,
        state: 'PUBLISHED',
        effectiveAt: new Date(),
        publishedAt: new Date(),
        config: {
          requiredFiles: [
            {
              category: 'MANUSCRIPT',
              labels: {
                'uz-Latn': 'Asosiy maqola',
                ru: 'Основная статья',
                en: 'Main manuscript',
              },
              formats: ['docx'],
              required: true,
              preflightRequired: true,
            },
            {
              category: 'REVIEW_LETTER',
              labels: { 'uz-Latn': 'Taqriz', ru: 'Рецензия', en: 'Review letter' },
              formats: ['pdf', 'docx'],
              required: true,
              preflightRequired: true,
            },
          ],
          limits: {
            maxBytes: 19 * 1024 * 1024,
            maxFiles: 10,
            maxTotalBytes: 50 * 1024 * 1024,
          },
          metadata: {
            abstractMinWords: 5,
            abstractMaxWords: 100,
            keywordMinCount: 3,
            keywordMaxCount: 10,
            coauthorMaxCount: 1,
          },
          preflight: { docx: { rulesVersion: 'e2e-v1' } },
        },
        configHash: randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64),
        changeNote: 'e2e',
        localizations: {
          create: [
            { locale: 'uz_Latn', title: 'Talablar', summary: 'E2E', body: 'E2E' },
            { locale: 'ru', title: 'Требования', summary: 'E2E', body: 'E2E' },
            { locale: 'en', title: 'Requirements', summary: 'E2E', body: 'E2E' },
          ],
        },
      },
    });
    await database!.journal.update({
      where: { id: journal.id },
      data: { currentRequirementId: requirement.id },
    });
    const telegramUserId = `7${Date.now()}`;
    const call = async (
      method: 'GET' | 'POST' | 'PATCH',
      url: string,
      body?: Record<string, unknown>,
    ) => {
      const headers = { 'x-hmqa-service-secret': serviceSecret };
      if (body === undefined) return app.inject({ method, url, headers });
      return app.inject({
        method,
        url,
        headers: { ...headers, 'content-type': 'application/json' },
        payload: body,
      });
    };
    expect(
      (
        await call('POST', '/api/v1/internal/telegram/users/sync', {
          telegramUserId,
          telegramChatId: telegramUserId,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await call('PATCH', `/api/v1/internal/telegram/users/${telegramUserId}/locale`, {
          locale: 'ru',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await call('POST', `/api/v1/internal/telegram/users/${telegramUserId}/consents`, {
          policyVersion: 'privacy-v1',
          scope: 'submission_processing',
          granted: true,
          locale: 'ru',
        })
      ).statusCode,
    ).toBe(201);
    const draftResponse = await call(
      'POST',
      `/api/v1/internal/telegram/users/${telegramUserId}/drafts`,
      { journalId: journal.id },
    );
    expect(draftResponse.statusCode).toBe(201);
    const draft = draftResponse.json<{ id: string; rowVersion: number }>();
    const context = {
      requirementsAcknowledgedAt: new Date().toISOString(),
      firstName: 'E2E',
      lastName: 'Author',
      middleName: 'Verified',
      phone: '+999000000001',
      email: 'e2e@example.invalid',
      organization: 'Academy',
      position: 'Researcher',
      degree: 'PhD',
      academicTitle: '-',
      country: 'Uzbekistan',
      city: 'Tashkent',
      orcid: '0000-0002-1825-0097',
      coauthors: '-',
      articleTitle: 'Integration evidence',
      articleType: 'Research article',
      articleLanguage: 'en',
      articleSection: 'law',
      abstract: 'A sufficiently complete test abstract for the end to end acceptance flow.',
      keywords: 'law, evidence, testing, academy, workflow',
    };
    const advanced = await call(
      'PATCH',
      `/api/v1/internal/telegram/users/${telegramUserId}/drafts/${draft.id}`,
      {
        expectedRowVersion: draft.rowVersion,
        machineState: 'FILE_ARTICLE',
        expectedInputType: 'DOCUMENT',
        contextPatch: context,
      },
    );
    expect(advanced.statusCode).toBe(200);
    const fileResponse = await call(
      'POST',
      `/api/v1/internal/telegram/users/${telegramUserId}/drafts/${draft.id}/files`,
      {
        expectedRowVersion: 1,
        fileId: `telegram-${suffix}`,
        fileUniqueId: `unique-${suffix}`,
        fileName: 'article.docx',
        declaredMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sizeBytes: 1024,
        category: 'MANUSCRIPT',
      },
    );
    expect(fileResponse.statusCode).toBe(200);
    const withFile = fileResponse.json<{ files: { file: { id: string } }[] }>();
    const fileId = withFile.files[0]!.file.id;
    const reviewFileResponse = await call(
      'POST',
      `/api/v1/internal/telegram/users/${telegramUserId}/drafts/${draft.id}/files`,
      {
        expectedRowVersion: 2,
        fileId: `telegram-review-${suffix}`,
        fileUniqueId: `unique-review-${suffix}`,
        fileName: 'review.pdf',
        declaredMime: 'application/pdf',
        sizeBytes: 512,
        category: 'REVIEW_LETTER',
      },
    );
    expect(reviewFileResponse.statusCode).toBe(200);
    const filesAfterReview = reviewFileResponse.json<{
      files: { category: string; file: { id: string } }[];
    }>();
    const reviewFileId = filesAfterReview.files.find((entry) => entry.category === 'REVIEW_LETTER')!
      .file.id;
    await database!.$transaction([
      database!.fileAsset.update({
        where: { id: fileId },
        data: {
          scanStatus: 'CLEAN',
          storageStatus: 'STORED',
          sha256: 'a'.repeat(64),
          objectKey: `e2e/${fileId}.docx`,
          storedAt: new Date(),
        },
      }),
      database!.draftPreflightRun.update({
        where: { draftId_fileId: { draftId: draft.id, fileId } },
        data: { status: 'COMPLETED', finishedAt: new Date(), blockingCount: 0 },
      }),
      database!.fileAsset.update({
        where: { id: reviewFileId },
        data: {
          scanStatus: 'CLEAN',
          storageStatus: 'STORED',
          sha256: 'b'.repeat(64),
          objectKey: `e2e/${reviewFileId}.pdf`,
          storedAt: new Date(),
        },
      }),
      database!.draftPreflightRun.update({
        where: { draftId_fileId: { draftId: draft.id, fileId: reviewFileId } },
        data: { status: 'COMPLETED', finishedAt: new Date(), blockingCount: 0 },
      }),
    ]);
    const preview = await call(
      'PATCH',
      `/api/v1/internal/telegram/users/${telegramUserId}/drafts/${draft.id}`,
      {
        expectedRowVersion: 3,
        machineState: 'PREVIEW',
        expectedInputType: 'CALLBACK',
        contextPatch: {},
      },
    );
    expect(preview.statusCode).toBe(200);

    const invalidAbstract = await call(
      'PATCH',
      `/api/v1/internal/telegram/users/${telegramUserId}/drafts/${draft.id}`,
      {
        expectedRowVersion: 4,
        machineState: 'PREVIEW',
        expectedInputType: 'CALLBACK',
        contextPatch: { abstract: 'Short' },
      },
    );
    expect(invalidAbstract.statusCode).toBe(200);
    const abstractDenied = await call(
      'POST',
      `/api/v1/internal/telegram/users/${telegramUserId}/drafts/${draft.id}/submit`,
      { expectedRowVersion: 5 },
    );
    expect(abstractDenied.statusCode).toBe(422);
    expect(abstractDenied.json()).toMatchObject({ code: 'ABSTRACT_WORD_COUNT_INVALID' });

    const invalidKeywords = await call(
      'PATCH',
      `/api/v1/internal/telegram/users/${telegramUserId}/drafts/${draft.id}`,
      {
        expectedRowVersion: 5,
        machineState: 'PREVIEW',
        expectedInputType: 'CALLBACK',
        contextPatch: { abstract: context.abstract, keywords: 'law, evidence' },
      },
    );
    expect(invalidKeywords.statusCode).toBe(200);
    const keywordsDenied = await call(
      'POST',
      `/api/v1/internal/telegram/users/${telegramUserId}/drafts/${draft.id}/submit`,
      { expectedRowVersion: 6 },
    );
    expect(keywordsDenied.statusCode).toBe(422);
    expect(keywordsDenied.json()).toMatchObject({ code: 'KEYWORDS_COUNT_INVALID' });

    const invalidCoauthors = await call(
      'PATCH',
      `/api/v1/internal/telegram/users/${telegramUserId}/drafts/${draft.id}`,
      {
        expectedRowVersion: 6,
        machineState: 'PREVIEW',
        expectedInputType: 'CALLBACK',
        contextPatch: {
          keywords: context.keywords,
          coauthors:
            'First Author|first@example.invalid|Academy\nSecond Author|second@example.invalid|Academy',
        },
      },
    );
    expect(invalidCoauthors.statusCode).toBe(200);
    const coauthorsDenied = await call(
      'POST',
      `/api/v1/internal/telegram/users/${telegramUserId}/drafts/${draft.id}/submit`,
      { expectedRowVersion: 7 },
    );
    expect(coauthorsDenied.statusCode).toBe(422);
    expect(coauthorsDenied.json()).toMatchObject({ code: 'COAUTHOR_LIMIT' });

    const validMetadata = await call(
      'PATCH',
      `/api/v1/internal/telegram/users/${telegramUserId}/drafts/${draft.id}`,
      {
        expectedRowVersion: 7,
        machineState: 'PREVIEW',
        expectedInputType: 'CALLBACK',
        contextPatch: { coauthors: context.coauthors },
      },
    );
    expect(validMetadata.statusCode).toBe(200);
    const submitted = await call(
      'POST',
      `/api/v1/internal/telegram/users/${telegramUserId}/drafts/${draft.id}/submit`,
      { expectedRowVersion: 8 },
    );
    expect(submitted.statusCode).toBe(201);
    expect(submitted.json()).toMatchObject({ status: 'SUBMITTED' });
    const submissionResult = submitted.json<{
      submissionId: string;
      publicId: string;
      receiptJobId: string;
    }>();
    expect(submissionResult.publicId).toMatch(/^HMQA-[A-Z0-9_-]+-\d{4}-\d{6}$/);
    const repeatedSubmit = await call(
      'POST',
      `/api/v1/internal/telegram/users/${telegramUserId}/drafts/${draft.id}/submit`,
      { expectedRowVersion: 8 },
    );
    expect(repeatedSubmit.statusCode).toBe(201);
    expect(repeatedSubmit.json()).toMatchObject({
      submissionId: submissionResult.submissionId,
      publicId: submissionResult.publicId,
      receiptJobId: submissionResult.receiptJobId,
    });
    expect(
      await database!.submission.count({
        where: { owner: { telegramUserId: BigInt(telegramUserId) } },
      }),
    ).toBe(1);
    const stored = await database!.submission.findFirstOrThrow({
      where: { owner: { telegramUserId: BigInt(telegramUserId) } },
      include: {
        versions: { include: { files: true, preflightRuns: true, metadata: true, authors: true } },
        statusHistory: true,
        notifications: true,
      },
    });
    expect(stored.requirementVersionId).toBe(requirement.id);
    expect(stored.versions).toHaveLength(1);
    expect(stored.versions[0]!.files).toHaveLength(2);
    expect(stored.versions[0]!.preflightRuns[0]).toMatchObject({
      status: 'COMPLETED',
      blockingCount: 0,
    });
    expect(stored.versions[0]!.metadata).toMatchObject({
      articleType: 'Research article',
      manuscriptLanguage: 'en',
    });
    expect(stored.versions[0]!.authors[0]!.dataSnapshot).toMatchObject({
      middleName: 'Verified',
      degree: 'PhD',
      academicTitle: null,
      country: 'Uzbekistan',
      city: 'Tashkent',
      orcid: '0000-0002-1825-0097',
    });
    expect(stored.statusHistory[0]).toMatchObject({ fromStatus: 'DRAFT', toStatus: 'SUBMITTED' });
    expect(stored.notifications[0]!.eventCode).toBe('submission.submitted');
    const pendingReceipt = await database!.submissionReceipt.findUniqueOrThrow({
      where: { id: submissionResult.receiptJobId },
    });
    expect(pendingReceipt).toMatchObject({ status: 'PENDING', templateVersion: 'receipt-v1' });
    const receiptSnapshot = pendingReceipt.dataSnapshot as {
      publicId: string;
      files: { sha256: string }[];
    };
    expect(receiptSnapshot.publicId).toBe(stored.publicId);
    expect(receiptSnapshot.files).toHaveLength(2);
    expect(receiptSnapshot.files[0]!.sha256).toMatch(/^[a-f0-9]{64}$/);

    const detail = await call(
      'GET',
      `/api/v1/internal/telegram/users/${telegramUserId}/submissions/${stored.id}`,
    );
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).not.toHaveProperty('versions.0.files.0.file.objectKey');
    expect(
      detail.json<{ versions: { files: { file: { sizeBytes: string } }[] }[] }>().versions[0]!,
    ).toMatchObject({
      files: expect.arrayContaining([expect.objectContaining({ category: 'MANUSCRIPT' })]),
    });
    expect(
      detail.json<{ versions: { files: { file: { sizeBytes: string } }[] }[] }>().versions[0]!
        .files[0]!.file.sizeBytes,
    ).toMatch(/^\d+$/);

    const download = await call(
      'GET',
      `/api/v1/internal/telegram/users/${telegramUserId}/files/${fileId}/download`,
    );
    expect(download.statusCode).toBe(200);
    expect(download.json<{ url: string; expiresInSeconds: number }>()).toMatchObject({
      url: expect.stringMatching(/^http:\/\/localhost:9000\//),
      expiresInSeconds: expect.any(Number),
    });
    const audit = await database!.auditLog.findFirstOrThrow({
      where: { action: 'file.download_url.issued', entityId: fileId, actorId: stored.ownerId },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toMatchObject({ actorType: 'USER', actorRole: 'AUTHOR', journalId: journal.id });

    const anonymizedAsset = await database!.fileAsset.create({
      data: {
        objectKey: `e2e/anonymized/${randomUUID()}.pdf`,
        originalName: 'reviewer-package.pdf',
        declaredMime: 'application/pdf',
        detectedMime: 'application/pdf',
        extension: 'pdf',
        sizeBytes: 1024n,
        sha256: 'd'.repeat(64),
        scanStatus: 'CLEAN',
        storageStatus: 'STORED',
        storedAt: new Date(),
        provenance: { provider: 'admin-derived-upload', anonymizationAttested: true },
      },
    });
    await database!.submissionFile.create({
      data: {
        submissionVersionId: stored.versions[0]!.id,
        fileId: anonymizedAsset.id,
        category: 'ANONYMIZED_MANUSCRIPT',
        required: false,
        versionNo: 1,
      },
    });
    const authorDetailAfterDerivative = await call(
      'GET',
      `/api/v1/internal/telegram/users/${telegramUserId}/submissions/${stored.id}`,
    );
    expect(
      authorDetailAfterDerivative
        .json<{ versions: { files: { category: string }[] }[] }>()
        .versions.flatMap((version) => version.files),
    ).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ category: 'ANONYMIZED_MANUSCRIPT' })]),
    );
    const deniedDerivativeDownload = await call(
      'GET',
      `/api/v1/internal/telegram/users/${telegramUserId}/files/${anonymizedAsset.id}/download`,
    );
    expect(deniedDerivativeDownload.statusCode).toBe(404);

    const receiptAsset = await database!.fileAsset.create({
      data: {
        objectKey: `e2e/receipts/${pendingReceipt.id}.pdf`,
        originalName: `receipt-${stored.publicId}.pdf`,
        declaredMime: 'application/pdf',
        detectedMime: 'application/pdf',
        extension: 'pdf',
        sizeBytes: 2048n,
        sha256: 'c'.repeat(64),
        scanStatus: 'CLEAN',
        storageStatus: 'STORED',
        storedAt: new Date(),
        provenance: { source: 'GENERATED', kind: 'SUBMISSION_RECEIPT' },
      },
    });
    await database!.submissionReceipt.update({
      where: { id: pendingReceipt.id },
      data: { status: 'READY', fileId: receiptAsset.id, readyAt: new Date() },
    });
    const receiptDownload = await call(
      'GET',
      `/api/v1/internal/telegram/users/${telegramUserId}/submissions/${stored.id}/receipt`,
    );
    expect(receiptDownload.statusCode).toBe(200);
    expect(receiptDownload.json()).toMatchObject({
      status: 'READY',
      submissionVersion: 1,
      url: expect.stringMatching(/^http:\/\/localhost:9000\//),
    });

    const otherTelegramUserId = `8${Date.now()}`;
    await call('POST', '/api/v1/internal/telegram/users/sync', {
      telegramUserId: otherTelegramUserId,
      telegramChatId: otherTelegramUserId,
    });
    const deniedDownload = await call(
      'GET',
      `/api/v1/internal/telegram/users/${otherTelegramUserId}/files/${fileId}/download`,
    );
    expect(deniedDownload.statusCode).toBe(404);
  });
});
