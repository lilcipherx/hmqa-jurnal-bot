import type { Update } from 'grammy/types';
import { describe, expect, it, vi } from 'vitest';
import { botCommands, createBot, type BotApi } from './bot.js';

function update(updateId: number, text: string): Update {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1_700_000_000,
      text,
      entities: text.startsWith('/')
        ? [{ offset: 0, length: text.length, type: 'bot_command' }]
        : undefined,
      chat: { id: 100, type: 'private', first_name: 'Test' },
      from: { id: 200, is_bot: false, first_name: 'Test', language_code: 'ru' },
    },
  } as Update;
}

function documentUpdate(updateId: number): Update {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1_700_000_000,
      document: {
        file_id: 'telegram-file-id',
        file_unique_id: 'telegram-unique-id',
        file_name: 'review.pdf',
        mime_type: 'application/pdf',
        file_size: 1024,
      },
      chat: { id: 100, type: 'private', first_name: 'Test' },
      from: { id: 200, is_bot: false, first_name: 'Test', language_code: 'ru' },
    },
  } as Update;
}

function callbackUpdate(updateId: number, data: string): Update {
  return {
    update_id: updateId,
    callback_query: {
      id: `callback-${updateId}`,
      chat_instance: 'test-chat',
      data,
      from: { id: 200, is_bot: false, first_name: 'Test', language_code: 'ru' },
      message: {
        message_id: updateId,
        date: 1_700_000_000,
        chat: { id: 100, type: 'private', first_name: 'Test' },
        text: 'test',
      },
    },
  } as Update;
}

describe('Telegram conversation', () => {
  it('publishes the complete localized slash-command catalog', () => {
    const expected = [
      'start',
      'help',
      'journals',
      'submit',
      'drafts',
      'status',
      'profile',
      'language',
      'cancel',
      'privacy',
    ];
    for (const locale of ['uz-Latn', 'ru', 'en'] as const) {
      const commands = botCommands(locale);
      expect(commands.map(({ command }) => command)).toEqual(expected);
      expect(commands.every(({ description }) => description.length > 0)).toBe(true);
    }
  });

  it('starts with language selection and persists update completion through the API', async () => {
    const completeUpdate = vi.fn().mockResolvedValue(undefined);
    const api = {
      claimUpdate: vi.fn().mockResolvedValue({
        claimed: true,
        correlationId: '64d4ef2c-418a-4d9c-a519-33c0abca8d9b',
      }),
      completeUpdate,
      releaseUpdate: vi.fn().mockResolvedValue(undefined),
      syncUser: vi.fn().mockResolvedValue({
        id: '4ef0649f-c2de-48ab-a8a7-f3bea4de9e04',
        locale: null,
        status: 'ACTIVE',
        consentActive: false,
        activeDraft: null,
        profile: null,
      }),
    } as unknown as BotApi;
    const bot = createBot('123456:ABC-telegram-test-token', api);
    const outgoing: { method: string; payload: unknown }[] = [];
    bot.api.config.use((_previous, method, payload) => {
      outgoing.push({ method, payload });
      return Promise.resolve(
        method === 'getMe'
          ? {
              ok: true,
              result: { id: 123456, is_bot: true, first_name: 'HMQA', username: 'hmqa_test_bot' },
            }
          : {
              ok: true,
              result: { message_id: 1, date: 1_700_000_000, chat: { id: 100, type: 'private' } },
            },
      ) as never;
    });
    await bot.init();
    outgoing.length = 0;
    await bot.handleUpdate(update(1, '/start'));
    expect(
      outgoing.some(
        (entry) =>
          entry.method === 'sendMessage' && JSON.stringify(entry.payload).includes('Выберите язык'),
      ),
    ).toBe(true);
    expect(completeUpdate).toHaveBeenCalledWith(1, 'PROCESSED');
  });

  it('routes status and privacy commands through consented API-backed flows', async () => {
    const listSubmissions = vi.fn().mockResolvedValue({ items: [] });
    const user = {
      id: '4ef0649f-c2de-48ab-a8a7-f3bea4de9e04',
      locale: 'ru',
      status: 'ACTIVE',
      consentActive: true,
      activeDraft: null,
      profile: null,
    };
    const api = {
      claimUpdate: vi.fn().mockResolvedValue({
        claimed: true,
        correlationId: '64d4ef2c-418a-4d9c-a519-33c0abca8d9b',
      }),
      completeUpdate: vi.fn().mockResolvedValue(undefined),
      releaseUpdate: vi.fn().mockResolvedValue(undefined),
      syncUser: vi.fn().mockResolvedValue(user),
      listSubmissions,
    } as unknown as BotApi;
    const bot = createBot('123456:ABC-telegram-test-token', api);
    const outgoing: { method: string; payload: unknown }[] = [];
    bot.api.config.use((_previous, method, payload) => {
      outgoing.push({ method, payload });
      return Promise.resolve(
        method === 'getMe'
          ? {
              ok: true,
              result: { id: 123456, is_bot: true, first_name: 'HMQA', username: 'hmqa_test_bot' },
            }
          : {
              ok: true,
              result: { message_id: 1, date: 1_700_000_000, chat: { id: 100, type: 'private' } },
            },
      ) as never;
    });
    await bot.init();
    outgoing.length = 0;

    await bot.handleUpdate(update(20, '/status'));
    await bot.handleUpdate(update(21, '/privacy'));

    expect(listSubmissions).toHaveBeenCalledWith('200');
    const payloads = outgoing
      .filter(({ method }) => method === 'sendMessage')
      .map(({ payload }) => JSON.stringify(payload));
    expect(payloads.some((payload) => payload.includes('У вас пока нет поданных статей'))).toBe(
      true,
    );
    expect(payloads.some((payload) => payload.includes('Персональные данные'))).toBe(true);
  });

  it('does not process an update that was already claimed', async () => {
    const api = {
      claimUpdate: vi.fn().mockResolvedValue({
        claimed: false,
        correlationId: '64d4ef2c-418a-4d9c-a519-33c0abca8d9b',
      }),
    } as unknown as BotApi;
    const bot = createBot('123456:ABC-telegram-test-token', api);
    const transformer = vi.fn().mockResolvedValue({
      ok: true,
      result: { id: 123456, is_bot: true, first_name: 'HMQA', username: 'hmqa_test_bot' },
    });
    bot.api.config.use(transformer as never);
    await bot.init();
    transformer.mockClear();
    await bot.handleUpdate(update(2, '/start'));
    expect(transformer).not.toHaveBeenCalled();
  });

  it('uses the published category and format policy for document steps', async () => {
    const config = {
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
          required: false,
          preflightRequired: true,
        },
      ],
      limits: { maxBytes: 19 * 1024 * 1024, maxFiles: 5, maxTotalBytes: 30 * 1024 * 1024 },
      preflight: { docx: { rulesVersion: 'bot-test-v1' } },
    };
    const draft = {
      id: '83a7a9e3-b6af-4a37-a873-d83dc3f09ccc',
      journalId: '43c0f310-e5ad-4565-b69d-bada3fd88512',
      requirementVersionId: '58be2910-4ed7-411e-be5a-d6c2fdb31dc1',
      machineState: 'FILE_ARTICLE',
      expectedInputType: 'DOCUMENT',
      context: {},
      rowVersion: 4,
      expiresAt: new Date('2027-01-01'),
      files: [
        {
          category: 'MANUSCRIPT',
          replacedAt: null,
          file: {
            id: '01ae5507-417e-47f8-a000-938676456cec',
            originalName: 'article.docx',
            scanStatus: 'CLEAN',
            storageStatus: 'STORED',
            sizeBytes: '1000',
          },
        },
      ],
      preflightRuns: [],
      requirementVersion: {
        id: '58be2910-4ed7-411e-be5a-d6c2fdb31dc1',
        version: 1,
        state: 'PUBLISHED',
        config,
      },
      journal: null,
    };
    const attachTelegramFile = vi.fn().mockResolvedValue({
      ...draft,
      machineState: 'FILE_SCANNING',
      context: { activeFileCategory: 'REVIEW_LETTER' },
      rowVersion: 5,
      files: [
        ...draft.files,
        {
          category: 'REVIEW_LETTER',
          replacedAt: null,
          file: {
            id: '42aa54fd-ea8e-4eeb-9103-d8172c549799',
            originalName: 'review.pdf',
            scanStatus: 'PENDING',
            storageStatus: 'PENDING',
            sizeBytes: '1024',
          },
        },
      ],
    });
    const api = {
      claimUpdate: vi.fn().mockResolvedValue({
        claimed: true,
        correlationId: '64d4ef2c-418a-4d9c-a519-33c0abca8d9b',
      }),
      completeUpdate: vi.fn().mockResolvedValue(undefined),
      releaseUpdate: vi.fn().mockResolvedValue(undefined),
      syncUser: vi.fn().mockResolvedValue({
        id: '4ef0649f-c2de-48ab-a8a7-f3bea4de9e04',
        locale: 'ru',
        status: 'ACTIVE',
        consentActive: true,
        activeDraft: draft,
        profile: null,
      }),
      attachTelegramFile,
    } as unknown as BotApi;
    const bot = createBot('123456:ABC-telegram-test-token', api);
    bot.api.config.use(
      (_previous, method) =>
        Promise.resolve(
          method === 'getMe'
            ? {
                ok: true,
                result: { id: 123456, is_bot: true, first_name: 'HMQA', username: 'hmqa_test_bot' },
              }
            : {
                ok: true,
                result: { message_id: 1, date: 1_700_000_000, chat: { id: 100, type: 'private' } },
              },
        ) as never,
    );
    await bot.init();
    await bot.handleUpdate(documentUpdate(3));
    expect(attachTelegramFile).toHaveBeenCalledWith(
      '200',
      draft,
      expect.objectContaining({ category: 'REVIEW_LETTER', fileName: 'review.pdf' }),
    );
  });

  it('lists immutable submission files and requests an owner-bound download URL', async () => {
    const submissionId = '41bfc9dc-f8f6-4610-aa3a-a0cd741f24e1';
    const fileId = '1904dc5f-81ca-4276-aeb1-128262f34883';
    const getSubmissionFileUrl = vi.fn().mockResolvedValue({
      url: 'https://storage.example.invalid/private-file?signature=test',
      expiresInSeconds: 300,
    });
    const getSubmissionReceipt = vi.fn().mockResolvedValue({
      status: 'READY',
      submissionVersion: 1,
      url: 'https://storage.example.invalid/receipt.pdf?signature=test',
      expiresInSeconds: 300,
    });
    const api = {
      claimUpdate: vi.fn().mockResolvedValue({
        claimed: true,
        correlationId: '64d4ef2c-418a-4d9c-a519-33c0abca8d9b',
      }),
      completeUpdate: vi.fn().mockResolvedValue(undefined),
      releaseUpdate: vi.fn().mockResolvedValue(undefined),
      syncUser: vi.fn().mockResolvedValue({
        id: '4ef0649f-c2de-48ab-a8a7-f3bea4de9e04',
        locale: 'ru',
        status: 'ACTIVE',
        consentActive: true,
        activeDraft: null,
        profile: null,
      }),
      getSubmission: vi.fn().mockResolvedValue({
        id: submissionId,
        publicId: 'HMQA-LAW-2026-000001',
        status: 'SUBMITTED',
        currentVersionNo: 1,
        submittedAt: new Date(),
        journal: { code: 'LAW' },
        requirementVersion: {
          version: 1,
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
            ],
            limits: {
              maxBytes: 19 * 1024 * 1024,
              maxFiles: 5,
              maxTotalBytes: 30 * 1024 * 1024,
            },
            preflight: { docx: { rulesVersion: 'bot-test-v1' } },
          },
        },
        statusHistory: [],
        messageThread: null,
        versions: [
          {
            versionNo: 1,
            createdAt: new Date(),
            files: [
              {
                category: 'MANUSCRIPT',
                required: true,
                versionNo: 1,
                createdAt: new Date(),
                file: {
                  id: fileId,
                  originalName: 'article.docx',
                  extension: 'docx',
                  sizeBytes: '1024',
                  sha256: 'a'.repeat(64),
                  scanStatus: 'CLEAN',
                  storageStatus: 'STORED',
                },
              },
            ],
          },
        ],
      }),
      getSubmissionFileUrl,
      getSubmissionReceipt,
    } as unknown as BotApi;
    const bot = createBot('123456:ABC-telegram-test-token', api);
    const outgoing: { method: string; payload: unknown }[] = [];
    bot.api.config.use((_previous, method, payload) => {
      outgoing.push({ method, payload });
      return Promise.resolve(
        method === 'getMe'
          ? {
              ok: true,
              result: { id: 123456, is_bot: true, first_name: 'HMQA', username: 'hmqa_test_bot' },
            }
          : method === 'answerCallbackQuery'
            ? { ok: true, result: true }
            : {
                ok: true,
                result: { message_id: 1, date: 1_700_000_000, chat: { id: 100, type: 'private' } },
              },
      ) as never;
    });
    await bot.init();
    outgoing.length = 0;

    await bot.handleUpdate(callbackUpdate(4, `submission:${submissionId}`));
    expect(JSON.stringify(outgoing)).toContain('Основная статья');
    expect(JSON.stringify(outgoing)).toContain(`file:${fileId}`);

    outgoing.length = 0;
    await bot.handleUpdate(callbackUpdate(5, `file:${fileId}`));
    expect(getSubmissionFileUrl).toHaveBeenCalledWith('200', fileId);
    expect(JSON.stringify(outgoing)).toContain('https://storage.example.invalid/private-file');

    outgoing.length = 0;
    await bot.handleUpdate(callbackUpdate(6, `receipt:${submissionId}`));
    expect(getSubmissionReceipt).toHaveBeenCalledWith('200', submissionId);
    expect(JSON.stringify(outgoing)).toContain('https://storage.example.invalid/receipt.pdf');
  });

  it('rejects an invalid ORCID before persisting the durable wizard state', async () => {
    const draft = {
      id: '83a7a9e3-b6af-4a37-a873-d83dc3f09ccc',
      journalId: '43c0f310-e5ad-4565-b69d-bada3fd88512',
      requirementVersionId: '58be2910-4ed7-411e-be5a-d6c2fdb31dc1',
      machineState: 'AUTHOR_ORCID',
      expectedInputType: 'TEXT',
      context: {},
      rowVersion: 7,
      expiresAt: new Date('2027-01-01'),
      files: [],
      preflightRuns: [],
      requirementVersion: null,
      journal: null,
    };
    const updateDraft = vi.fn().mockResolvedValue({
      ...draft,
      machineState: 'AUTHOR_COAUTHORS',
      rowVersion: 8,
      context: { orcid: '0000-0002-1825-0097' },
    });
    const api = {
      claimUpdate: vi.fn().mockResolvedValue({
        claimed: true,
        correlationId: '64d4ef2c-418a-4d9c-a519-33c0abca8d9b',
      }),
      completeUpdate: vi.fn().mockResolvedValue(undefined),
      releaseUpdate: vi.fn().mockResolvedValue(undefined),
      syncUser: vi.fn().mockResolvedValue({
        id: '4ef0649f-c2de-48ab-a8a7-f3bea4de9e04',
        locale: 'ru',
        status: 'ACTIVE',
        consentActive: true,
        activeDraft: draft,
        profile: null,
      }),
      updateDraft,
    } as unknown as BotApi;
    const bot = createBot('123456:ABC-telegram-test-token', api);
    const outgoing: { method: string; payload: unknown }[] = [];
    bot.api.config.use((_previous, method, payload) => {
      outgoing.push({ method, payload });
      return Promise.resolve(
        method === 'getMe'
          ? {
              ok: true,
              result: { id: 123456, is_bot: true, first_name: 'HMQA', username: 'hmqa_test_bot' },
            }
          : {
              ok: true,
              result: { message_id: 1, date: 1_700_000_000, chat: { id: 100, type: 'private' } },
            },
      ) as never;
    });
    await bot.init();
    outgoing.length = 0;

    await bot.handleUpdate(update(7, '0000-0002-1825-0098'));
    expect(updateDraft).not.toHaveBeenCalled();
    expect(JSON.stringify(outgoing)).toContain('Неверный ORCID');

    outgoing.length = 0;
    await bot.handleUpdate(update(8, '0000-0002-1825-0097'));
    expect(updateDraft).toHaveBeenCalledWith('200', draft, 'AUTHOR_COAUTHORS', 'TEXT', {
      orcid: '0000-0002-1825-0097',
    });
  });
});
