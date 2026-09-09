import { randomUUID } from 'node:crypto';
import { loadConfig } from '@hmqa/config';
import { createPrismaClient } from '@hmqa/database';
import { permissions, permissionsFor } from '@hmqa/domain';
import {
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
const encryptionKey = 'simplified-admin-rbac-integration-key';
const password = 'Simplified-admin-integration-password-2026!';
const serviceSecret = 'simplified-admin-service-secret';

interface Identity {
  employeeId: string;
  token: string;
  csrf: string;
  secret: string;
}

let app: Awaited<ReturnType<typeof createApp>>;
const admins: Identity[] = [];
let nonAdminToken = '';
let firstJournalId = '';
let secondJournalId = '';
let assignmentSubmissionId = '';

function headers(identity: Identity, csrf = false) {
  return {
    cookie: `hmqa_session=${identity.token}`,
    ...(csrf ? { origin: 'http://localhost:3000', 'x-csrf-token': identity.csrf } : {}),
  };
}

function requirementConfig(maxBytes = 10 * 1024 * 1024) {
  return {
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
    ],
    limits: { maxBytes, maxFiles: 10, maxTotalBytes: 50 * 1024 * 1024 },
    metadata: {
      abstractMinWords: 150,
      abstractMaxWords: 300,
      keywordMinCount: 5,
      keywordMaxCount: 10,
      coauthorMaxCount: 10,
    },
    preflight: { docx: { rulesVersion: 'admin-integration-v1', requiredMarkers: [] } },
    workflow: {
      reviewModel: 'NO_EXTERNAL_REVIEW',
      requiredReviewerCount: 0,
      decisionRequiresCompletedReviews: false,
    },
  };
}

function requirementLocalizations(prefix: string) {
  return {
    'uz-Latn': {
      title: `${prefix} UZ`,
      summary: `${prefix} UZ qisqacha`,
      body: `${prefix} UZ to‘liq matn`,
      help: `${prefix} UZ yordam`,
      contact: `${prefix} UZ aloqa`,
    },
    ru: {
      title: `${prefix} RU`,
      summary: `${prefix} RU кратко`,
      body: `${prefix} RU полный текст`,
      help: `${prefix} RU помощь`,
      contact: `${prefix} RU контакты`,
    },
    en: {
      title: `${prefix} EN`,
      summary: `${prefix} EN summary`,
      body: `${prefix} EN full text`,
      help: `${prefix} EN help`,
      contact: `${prefix} EN contact`,
    },
  };
}

suite('simplified administrator authorization model', () => {
  beforeAll(async () => {
    const adminRole = await database!.role.upsert({
      where: { code: 'ADMIN' },
      update: {},
      create: { code: 'ADMIN', description: 'Administrator' },
    });
    const passwordHash = await hashPassword(password);
    for (let index = 0; index < 2; index += 1) {
      const secret = generateTotpSecret();
      const employee = await database!.employee.create({
        data: {
          email: `admin-${index}-${randomUUID()}@example.invalid`,
          displayName: `Integration administrator ${index + 1}`,
          passwordHash,
          status: 'ACTIVE',
          totpEnabled: true,
          totpSecretCipher: encryptSecret(secret, encryptionKey),
          roles: { create: { roleId: adminRole.id } },
        },
      });
      const token = generateOpaqueToken();
      const csrf = generateOpaqueToken();
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
      admins.push({ employeeId: employee.id, token, csrf, secret });
    }

    const nonAdmin = await database!.employee.create({
      data: {
        email: `non-admin-${randomUUID()}@example.invalid`,
        displayName: 'Non administrator',
        status: 'ACTIVE',
      },
    });
    nonAdminToken = generateOpaqueToken();
    await database!.staffSession.create({
      data: {
        employeeId: nonAdmin.id,
        tokenHash: hashOpaqueToken(nonAdminToken),
        csrfHash: hashOpaqueToken(generateOpaqueToken()),
        twoFactorAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 60_000),
      },
    });

    const suffix = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
    const [first, second] = await Promise.all([
      database!.journal.create({ data: { code: `SA${suffix}`, mode: 'NATIVE' } }),
      database!.journal.create({ data: { code: `SB${suffix}`, mode: 'NATIVE' } }),
    ]);
    firstJournalId = first.id;
    secondJournalId = second.id;

    const requirement = await database!.journalRequirementVersion.create({
      data: {
        journalId: first.id,
        version: 1,
        state: 'PUBLISHED',
        config: {},
        configHash: randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64),
        changeNote: 'Simplified administrator assignment integration fixture',
        publishedAt: new Date(),
      },
    });
    const author = await database!.user.create({
      data: { telegramUserId: BigInt(`9${Date.now()}${Math.floor(Math.random() * 1000)}`) },
    });
    const submission = await database!.submission.create({
      data: {
        publicId: `HMQA-ASSIGN-${randomUUID()}`,
        journalId: first.id,
        ownerId: author.id,
        requirementVersionId: requirement.id,
      },
    });
    assignmentSubmissionId = submission.id;

    const config = loadConfig({
      NODE_ENV: 'test',
      APP_BASE_URL: 'http://localhost:3001',
      ADMIN_BASE_URL: 'http://localhost:3000',
      BOT_BASE_URL: 'http://localhost:3002',
      DATABASE_URL: databaseUrl!,
      REDIS_URL: redisUrl!,
      TELEGRAM_BOT_TOKEN: '123456:simplified-admin-test-token',
      TELEGRAM_WEBHOOK_SECRET: 'simplified-admin-webhook-secret',
      PUBLIC_BOT_USERNAME: 'hmqa_simplified_admin_test_bot',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_BUCKET: 'hmqa-test',
      S3_ACCESS_KEY: 'test-access',
      S3_SECRET_KEY: 'test-secret',
      SERVICE_AUTH_SECRET: serviceSecret,
      SESSION_SECRET: 'simplified-admin-session-secret',
      ENCRYPTION_KEY: encryptionKey,
      METRICS_TOKEN: 'simplified-admin-metrics-token',
    });
    app = await createApp({ config, database: database!, redis: redis! });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await redis?.quit();
    await database?.$disconnect();
  });

  it('gives every administrator every product permission', () => {
    expect([...permissionsFor('ADMIN')].sort()).toEqual([...permissions].sort());
  });

  it('allows multiple administrators to use every main administration resource', async () => {
    const resources = [
      '/api/v1/admin/dashboard',
      '/api/v1/admin/submissions?group=all',
      '/api/v1/admin/reviews/assigned',
      '/api/v1/admin/journals',
      '/api/v1/admin/reviewers',
      '/api/v1/admin/telegram-content',
      '/api/v1/admin/notifications',
      '/api/v1/admin/employees',
      '/api/v1/admin/reports/overview',
      '/api/v1/admin/audit',
      '/api/v1/admin/settings/runtime',
    ];
    for (const admin of admins) {
      for (const resource of resources) {
        const response = await app.inject({
          method: 'GET',
          url: resource,
          headers: headers(admin),
        });
        expect(response.statusCode, resource).toBe(200);
      }
      const journals = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/journals',
        headers: headers(admin),
      });
      const ids = journals.json<{ items: { id: string }[] }>().items.map(({ id }) => id);
      expect(ids).toEqual(expect.arrayContaining([firstJournalId, secondJournalId]));
    }
  });

  it('rejects an authenticated employee without the ADMIN membership', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: `hmqa_session=${nonAdminToken}` },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('exposes only ADMIN in the staff role catalog', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/roles',
      headers: headers(admins[0]!),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ items: { code: string }[] }>().items.map(({ code }) => code)).toEqual([
      'ADMIN',
    ]);
  });

  it('lets an administrator create a localized journal and records the action', async () => {
    const code = `UJ${randomUUID().replaceAll('-', '').slice(0, 8)}`.toUpperCase();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/journals',
      headers: { ...headers(admins[0]!, true), 'content-type': 'application/json' },
      payload: {
        code,
        mode: 'NATIVE',
        active: false,
        fourEyesRequired: false,
        acceptanceOpensAt: '2030-01-01T00:00:00.000Z',
        acceptanceClosesAt: '2030-02-01T00:00:00.000Z',
        localizations: {
          'uz-Latn': { name: 'UAT jurnal', shortName: 'UAT', description: 'Sinov jurnali' },
          ru: { name: 'Журнал UAT', shortName: 'UAT', description: 'Тестовый журнал' },
          en: { name: 'UAT journal', shortName: 'UAT', description: 'Test journal' },
        },
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    const journal = response.json<{
      id: string;
      code: string;
      active: boolean;
      acceptanceOpensAt: string;
      acceptanceClosesAt: string;
    }>();
    expect(journal.code).toBe(code);
    expect(journal.active).toBe(false);
    expect(journal.acceptanceOpensAt).toBe('2030-01-01T00:00:00.000Z');
    expect(journal.acceptanceClosesAt).toBe('2030-02-01T00:00:00.000Z');
    expect(
      await database!.auditLog.count({
        where: { action: 'journal.created', entityId: journal.id, actorId: admins[0]!.employeeId },
      }),
    ).toBe(1);
  });

  it('edits only DRAFT requirement versions with optimistic locking and audits the update', async () => {
    const administrator = admins[0]!;
    const writeHeaders = {
      ...headers(administrator, true),
      'content-type': 'application/json',
    };
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/journals/${firstJournalId}/requirements`,
      headers: writeHeaders,
      payload: {
        config: requirementConfig(),
        changeNote: 'Initial structured draft',
        localizations: requirementLocalizations('Initial'),
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const draft = created.json<{ id: string; rowVersion: number }>();

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/requirements/${draft.id}`,
      headers: writeHeaders,
      payload: {
        config: requirementConfig(12 * 1024 * 1024),
        changeNote: 'Updated structured draft',
        localizations: requirementLocalizations('Updated'),
        expectedRowVersion: draft.rowVersion,
      },
    });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json()).toMatchObject({ rowVersion: draft.rowVersion + 1 });
    expect(
      updated
        .json<{ localizations: { locale: string; title: string }[] }>()
        .localizations.find(({ locale }) => locale === 'ru'),
    ).toMatchObject({ title: 'Updated RU' });
    expect(
      await database!.auditLog.count({
        where: {
          action: 'journal.requirement.updated',
          entityId: draft.id,
          actorId: administrator.employeeId,
        },
      }),
    ).toBe(1);

    const submittedForReview = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/requirements/${draft.id}/state`,
      headers: writeHeaders,
      payload: {
        targetState: 'REVIEW',
        expectedRowVersion: draft.rowVersion + 1,
      },
    });
    expect(submittedForReview.statusCode, submittedForReview.body).toBe(200);

    const immutable = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/requirements/${draft.id}`,
      headers: writeHeaders,
      payload: {
        config: requirementConfig(),
        changeNote: 'Must not update a version in review',
        localizations: requirementLocalizations('Rejected update'),
        expectedRowVersion: draft.rowVersion + 2,
      },
    });
    expect(immutable.statusCode).toBe(409);
    expect(immutable.json()).toMatchObject({ code: 'REQUIREMENT_IMMUTABLE' });

    const returnedToDraft = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/requirements/${draft.id}/state`,
      headers: writeHeaders,
      payload: {
        targetState: 'DRAFT',
        expectedRowVersion: draft.rowVersion + 2,
      },
    });
    expect(returnedToDraft.statusCode, returnedToDraft.body).toBe(200);
    const editableAgain = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/requirements/${draft.id}`,
      headers: writeHeaders,
      payload: {
        config: requirementConfig(),
        changeNote: 'Editable after return to draft',
        localizations: requirementLocalizations('Returned draft'),
        expectedRowVersion: draft.rowVersion + 3,
      },
    });
    expect(editableAgain.statusCode, editableAgain.body).toBe(200);
  });

  it('serializes concurrent requirement version creation by multiple administrators', async () => {
    const journal = await database!.journal.create({
      data: { code: `RC${randomUUID().replaceAll('-', '').slice(0, 8)}`.toUpperCase() },
    });
    const responses = await Promise.all(
      admins.map((administrator, index) =>
        app.inject({
          method: 'POST',
          url: `/api/v1/admin/journals/${journal.id}/requirements`,
          headers: {
            ...headers(administrator, true),
            'content-type': 'application/json',
          },
          payload: {
            config: requirementConfig(10 * 1024 * 1024 + index),
            changeNote: `Concurrent draft ${index + 1}`,
            localizations: requirementLocalizations(`Concurrent ${index + 1}`),
          },
        }),
      ),
    );
    expect(responses.map(({ statusCode }) => statusCode)).toEqual([201, 201]);
    expect(
      (
        await database!.journalRequirementVersion.findMany({
          where: { journalId: journal.id },
          orderBy: { version: 'asc' },
          select: { version: true },
        })
      ).map(({ version }) => version),
    ).toEqual([1, 2]);

    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/journals/${journal.id}/requirements`,
      headers: {
        ...headers(admins[0]!, true),
        'content-type': 'application/json',
      },
      payload: {
        config: requirementConfig(10 * 1024 * 1024),
        changeNote: 'Duplicate concurrent configuration',
        localizations: requirementLocalizations('Duplicate concurrent configuration'),
      },
    });
    expect(duplicate.statusCode, duplicate.body).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: 'DUPLICATE_REQUIREMENT_CONFIG' });
  });

  it('edits Telegram contact/content, applies journal fallback, and audits every change', async () => {
    const administrator = admins[0]!;
    const writeHeaders = {
      ...headers(administrator, true),
      'content-type': 'application/json',
    };
    const localized = (prefix: string) => [
      {
        locale: 'uz-Latn',
        address: `${prefix} UZ address`,
        workingHours: `${prefix} UZ hours`,
        note: `${prefix} UZ note`,
      },
      {
        locale: 'ru',
        address: `${prefix} RU address`,
        workingHours: `${prefix} RU hours`,
        note: `${prefix} RU note`,
      },
      {
        locale: 'en',
        address: `${prefix} EN address`,
        workingHours: `${prefix} EN hours`,
        note: `${prefix} EN note`,
      },
    ];
    const global = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/telegram-content/contact',
      headers: writeHeaders,
      payload: {
        journalId: null,
        phone: '+998 71 000 00 00',
        email: 'global-contact@example.invalid',
        telegram: '@hmqa_global_uat',
        localizations: localized('Global'),
      },
    });
    expect(global.statusCode, global.body).toBe(200);

    const journal = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/telegram-content/contact',
      headers: writeHeaders,
      payload: {
        journalId: firstJournalId,
        phone: '+998 71 111 11 11',
        email: null,
        telegram: null,
        localizations: localized('Journal'),
      },
    });
    expect(journal.statusCode, journal.body).toBe(200);

    const content = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/telegram-content/items/HELP_SUBMIT',
      headers: writeHeaders,
      payload: {
        uzLatn: 'UAT: jurnalni tanlang va fayllarni yuklang.',
        ru: 'UAT: выберите журнал и загрузите файлы.',
        en: 'UAT: choose a journal and upload the files.',
      },
    });
    expect(content.statusCode, content.body).toBe(200);

    const telegramRead = await app.inject({
      method: 'GET',
      url: `/api/v1/internal/telegram/content?locale=en&journalId=${firstJournalId}`,
      headers: { 'x-hmqa-service-secret': serviceSecret },
    });
    expect(telegramRead.statusCode, telegramRead.body).toBe(200);
    expect(telegramRead.json()).toMatchObject({
      contact: {
        phone: '+998 71 111 11 11',
        email: 'global-contact@example.invalid',
        telegram: '@hmqa_global_uat',
        address: 'Journal EN address',
        workingHours: 'Journal EN hours',
        note: 'Journal EN note',
      },
      content: { HELP_SUBMIT: 'UAT: choose a journal and upload the files.' },
    });

    const localeFallback = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/telegram-content/contact',
      headers: writeHeaders,
      payload: {
        journalId: firstJournalId,
        phone: null,
        email: null,
        telegram: null,
        localizations: [
          {
            locale: 'uz-Latn',
            address: null,
            workingHours: null,
            note: null,
          },
          {
            locale: 'ru',
            address: 'Journal RU fallback address',
            workingHours: 'Journal RU fallback hours',
            note: 'Journal RU fallback note',
          },
          { locale: 'en', address: null, workingHours: null, note: null },
        ],
      },
    });
    expect(localeFallback.statusCode, localeFallback.body).toBe(200);
    const fallbackRead = await app.inject({
      method: 'GET',
      url: `/api/v1/internal/telegram/content?locale=en&journalId=${firstJournalId}`,
      headers: { 'x-hmqa-service-secret': serviceSecret },
    });
    expect(fallbackRead.statusCode, fallbackRead.body).toBe(200);
    expect(fallbackRead.json()).toMatchObject({
      contact: {
        phone: '+998 71 000 00 00',
        email: 'global-contact@example.invalid',
        telegram: '@hmqa_global_uat',
        address: 'Journal RU fallback address',
        workingHours: 'Journal RU fallback hours',
        note: 'Journal RU fallback note',
      },
    });
    expect(
      await database!.auditLog.count({
        where: {
          actorId: administrator.employeeId,
          action: { in: ['telegram.contact.updated', 'telegram.content.updated'] },
        },
      }),
    ).toBeGreaterThanOrEqual(3);
  });

  it('rejects obsolete role input when inviting an administrator', async () => {
    const administrator = admins[0]!;
    const email = `obsolete-role-${randomUUID()}@example.invalid`;
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/employees',
      headers: {
        ...headers(administrator, true),
        'content-type': 'application/json',
      },
      payload: {
        email,
        displayName: 'Obsolete role attempt',
        role: 'EDITOR',
        currentPassword: password,
        currentTotp: generateTotpCode(administrator.secret),
        confirmation: true,
      },
    });
    expect(response.statusCode).toBe(422);
    expect(await database!.employee.count({ where: { email } })).toBe(0);
  });

  it('assigns an article to an administrator without accepting obsolete assignment kinds', async () => {
    const administrator = admins[0]!;
    const adminRole = await database!.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
    const expiredAdministrator = await database!.employee.create({
      data: {
        email: `expired-admin-${randomUUID()}@example.invalid`,
        displayName: 'Expired administrator',
        status: 'ACTIVE',
        roles: {
          create: {
            roleId: adminRole.id,
            expiresAt: new Date(Date.now() - 60_000),
          },
        },
      },
    });
    const obsolete = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/submissions/${assignmentSubmissionId}/assignments`,
      headers: { ...headers(administrator, true), 'content-type': 'application/json' },
      payload: {
        employeeId: admins[1]!.employeeId,
        reason: 'Integration assignment',
        kind: 'EDITOR',
      },
    });
    expect(obsolete.statusCode).toBe(422);

    const expired = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/submissions/${assignmentSubmissionId}/assignments`,
      headers: { ...headers(administrator, true), 'content-type': 'application/json' },
      payload: {
        employeeId: expiredAdministrator.id,
        reason: 'Must not assign expired access',
      },
    });
    expect(expired.statusCode).toBe(422);

    const options = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/submissions/${assignmentSubmissionId}/assignment-options`,
      headers: headers(administrator),
    });
    expect(options.statusCode, options.body).toBe(200);
    expect(
      options
        .json<{ employees: { id: string }[] }>()
        .employees.some(({ id }) => id === expiredAdministrator.id),
    ).toBe(false);
    const administrators = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/employees',
      headers: headers(administrator),
    });
    expect(administrators.statusCode, administrators.body).toBe(200);
    expect(
      administrators
        .json<{ items: { id: string }[] }>()
        .items.some(({ id }) => id === expiredAdministrator.id),
    ).toBe(false);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/submissions/${assignmentSubmissionId}/assignments`,
      headers: { ...headers(administrator, true), 'content-type': 'application/json' },
      payload: {
        employeeId: admins[1]!.employeeId,
        reason: 'Integration assignment',
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json()).toMatchObject({
      employeeId: admins[1]!.employeeId,
      kind: 'ADMIN',
      status: 'PENDING',
    });
    expect(
      await database!.auditLog.count({
        where: {
          action: 'submission.assignment.created',
          entityId: response.json<{ id: string }>().id,
          actorId: administrator.employeeId,
        },
      }),
    ).toBe(1);
  });

  it('prevents disabling the current administrator and never leaves zero active admins', async () => {
    const current = admins[0]!;
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/employees/${current.employeeId}`,
      headers: { ...headers(current, true), 'content-type': 'application/json' },
      payload: {
        status: 'DISABLED',
        currentPassword: password,
        currentTotp: generateTotpCode(current.secret),
        confirmation: true,
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'SELF_DISABLE_FORBIDDEN' });
    expect(
      await database!.employee.count({
        where: { status: 'ACTIVE', roles: { some: { role: { code: 'ADMIN' } } } },
      }),
    ).toBeGreaterThan(0);
  });
});
