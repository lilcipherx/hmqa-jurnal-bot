import { randomUUID } from 'node:crypto';
import { loadConfig } from '@hmqa/config';
import { createPrismaClient } from '@hmqa/database';
import { encryptSecret } from '@hmqa/security';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const suite = databaseUrl && redisUrl ? describe : describe.skip;
const database = databaseUrl ? createPrismaClient(databaseUrl) : null;
const redis = redisUrl ? new Redis(redisUrl, { maxRetriesPerRequest: 2 }) : null;
const serviceSecret = 'locale-preservation-service-secret';
const encryptionKey = 'locale-preservation-encryption-key';
let app: Awaited<ReturnType<typeof createApp>>;
let telegramUserId = '';
let userId = '';
let draftId = '';
let submissionId = '';
let fileId = '';

suite('runtime locale persistence boundaries', () => {
  beforeAll(async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    telegramUserId = `5${Date.now()}`;
    const user = await database!.user.create({
      data: { telegramUserId: BigInt(telegramUserId), telegramChatId: BigInt(telegramUserId) },
    });
    userId = user.id;
    await database!.authorProfile.create({
      data: {
        userId,
        firstName: 'Locale',
        lastName: 'Persistence',
        phoneCipher: encryptSecret('+998901234567', encryptionKey),
        phoneHash: '1'.repeat(64),
        emailCipher: encryptSecret('locale@example.invalid', encryptionKey),
        emailHash: '2'.repeat(64),
        organization: 'DEV/TEST ONLY — REQUIRES ACADEMY APPROVAL',
        position: 'Test author',
      },
    });
    const journal = await database!.journal.create({
      data: { code: `L${suffix}`.slice(0, 16), mode: 'NATIVE', active: true },
    });
    const requirement = await database!.journalRequirementVersion.create({
      data: {
        journalId: journal.id,
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
          limits: { maxBytes: 1024, maxFiles: 1, maxTotalBytes: 1024 },
          preflight: { docx: { rulesVersion: 'locale-preservation-v1', requiredMarkers: [] } },
        },
        configHash: randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64),
        changeNote: 'DEV/TEST ONLY — REQUIRES ACADEMY APPROVAL',
        effectiveAt: new Date(),
        publishedAt: new Date(),
      },
    });
    const draft = await database!.draft.create({
      data: {
        userId,
        journalId: journal.id,
        requirementVersionId: requirement.id,
        machineState: 'ARTICLE_ABSTRACT',
        expectedInputType: 'TEXT',
        context: { articleTitle: 'Persistent title', stepEvidence: 'locale-switch' },
        rowVersion: 7,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    draftId = draft.id;
    const file = await database!.fileAsset.create({
      data: {
        originalName: 'persistent.docx',
        declaredMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        extension: 'docx',
        sizeBytes: 128n,
        provenance: { provider: 'telegram', providerFileId: 'persistent-test' },
      },
    });
    fileId = file.id;
    await database!.draftFile.create({
      data: { draftId, fileId, category: 'MANUSCRIPT', required: true },
    });
    const submission = await database!.submission.create({
      data: {
        publicId: `LOCALE-${suffix}`,
        journalId: journal.id,
        ownerId: userId,
        requirementVersionId: requirement.id,
        status: 'SUBMITTED',
      },
    });
    submissionId = submission.id;

    const config = loadConfig({
      NODE_ENV: 'test',
      APP_BASE_URL: 'http://localhost:3001',
      ADMIN_BASE_URL: 'http://localhost:3000',
      BOT_BASE_URL: 'http://localhost:3002',
      DATABASE_URL: databaseUrl!,
      REDIS_URL: redisUrl!,
      TELEGRAM_BOT_TOKEN: '123456:locale-test-token',
      TELEGRAM_WEBHOOK_SECRET: 'locale-test-webhook-secret',
      PUBLIC_BOT_USERNAME: 'hmqa_locale_test_bot',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_BUCKET: 'hmqa-locale-test',
      S3_ACCESS_KEY: 'locale-access',
      S3_SECRET_KEY: 'locale-secret',
      SERVICE_AUTH_SECRET: serviceSecret,
      SESSION_SECRET: 'locale-session-secret',
      ENCRYPTION_KEY: encryptionKey,
      METRICS_TOKEN: 'locale-metrics-token',
    });
    app = await createApp({ config, database: database!, redis: redis! });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await redis?.quit();
    await database?.$disconnect();
  });

  it('switches uz-Latn/ru/en without mutating profile, draft, files, submission, or wizard state', async () => {
    for (const locale of ['uz-Latn', 'ru', 'en'] as const) {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/internal/telegram/users/${telegramUserId}/locale`,
        headers: {
          'x-hmqa-service-secret': serviceSecret,
          'content-type': 'application/json',
        },
        payload: { locale },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ id: userId, locale });
      const [user, draft, submission, fileLink] = await Promise.all([
        database!.user.findUniqueOrThrow({
          where: { id: userId },
          include: { authorProfile: true },
        }),
        database!.draft.findUniqueOrThrow({ where: { id: draftId } }),
        database!.submission.findUniqueOrThrow({ where: { id: submissionId } }),
        database!.draftFile.findUniqueOrThrow({ where: { draftId_fileId: { draftId, fileId } } }),
      ]);
      expect(user.authorProfile).toMatchObject({
        firstName: 'Locale',
        lastName: 'Persistence',
        organization: 'DEV/TEST ONLY — REQUIRES ACADEMY APPROVAL',
      });
      expect(draft).toMatchObject({
        machineState: 'ARTICLE_ABSTRACT',
        expectedInputType: 'TEXT',
        rowVersion: 7,
        context: { articleTitle: 'Persistent title', stepEvidence: 'locale-switch' },
      });
      expect(fileLink).toMatchObject({ category: 'MANUSCRIPT', replacedAt: null });
      expect(submission).toMatchObject({ status: 'SUBMITTED', currentVersionNo: 1 });
    }
  });
});
