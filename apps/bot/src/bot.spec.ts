import type { Update } from 'grammy/types';
import { describe, expect, it, vi } from 'vitest';
import { botCommands, createBot, mainMenu, resolveUserLocale, type BotApi } from './bot.js';

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
      'requirements',
      'submit',
      'drafts',
      'articles',
      'status',
      'profile',
      'language',
      'cancel',
    ];
    for (const locale of ['uz-Latn', 'ru', 'en'] as const) {
      const commands = botCommands(locale);
      expect(commands.map(({ command }) => command)).toEqual(expected);
      expect(commands.every(({ description }) => description.length > 0)).toBe(true);
    }
    const menu = JSON.stringify(mainMenu('ru'));
    expect(menu).toContain('☎️ Связаться');
    expect(menu).toContain('📋 Требования');
    expect(menu).not.toContain('Запросить мои данные');
    expect(menu).not.toContain('Запросить удаление данных');
  });

  it('prefers the persisted locale for error responses', () => {
    expect(resolveUserLocale('en', 'ru')).toBe('en');
    expect(resolveUserLocale(null, 'ru')).toBe('ru');
    expect(resolveUserLocale(undefined, 'unknown')).toBe('uz-Latn');
  });

  it('renders the selected journal and requirement localization in a resumed draft', async () => {
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
        profile: null,
        activeDraft: {
          id: '83a7a9e3-b6af-4a37-a873-d83dc3f09ccc',
          journalId: '43c0f310-e5ad-4565-b69d-bada3fd88512',
          requirementVersionId: '58be2910-4ed7-411e-be5a-d6c2fdb31dc1',
          machineState: 'REQUIREMENTS_ACK',
          expectedInputType: 'CALLBACK',
          context: {},
          rowVersion: 1,
          expiresAt: new Date('2027-01-01'),
          files: [],
          preflightRuns: [],
          requirementVersion: {
            id: '58be2910-4ed7-411e-be5a-d6c2fdb31dc1',
            version: 1,
            state: 'PUBLISHED',
            config: {},
            localizations: [
              {
                locale: 'UZ_LATN',
                title: 'O‘zbek talablar',
                summary: 'O‘zbek xulosa',
                body: 'O‘zbek matn',
                help: null,
                contact: null,
              },
              {
                locale: 'RU',
                title: 'Русские требования',
                summary: 'Русское резюме',
                body: 'Русский текст',
                help: null,
                contact: null,
              },
            ],
          },
          journal: {
            code: 'UAT',
            localizations: [
              {
                locale: 'UZ_LATN',
                name: 'O‘zbek jurnal',
                description: 'O‘zbek tavsif',
                contactText: null,
              },
              {
                locale: 'RU',
                name: 'Русский журнал',
                description: 'Русское описание',
                contactText: null,
              },
            ],
            currentRequirement: {
              id: '58be2910-4ed7-411e-be5a-d6c2fdb31dc1',
              version: 2,
              config: {},
              localizations: [
                {
                  locale: 'UZ_LATN',
                  title: 'O‘zbek talablar',
                  summary: 'O‘zbek xulosa',
                  body: 'O‘zbek matn',
                  help: null,
                  contact: null,
                },
                {
                  locale: 'RU',
                  title: 'Новые русские требования',
                  summary: 'Новое русское резюме',
                  body: 'Новый русский текст',
                  help: null,
                  contact: null,
                },
              ],
            },
          },
        },
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

    await bot.handleUpdate(update(9, '/start'));

    const payloads = JSON.stringify(outgoing);
    expect(payloads).toContain('Русские требования');
    expect(payloads).toContain('Русское резюме');
    expect(payloads).toContain('Русский журнал');
    expect(payloads).not.toContain('O‘zbek talablar');
    expect(payloads).not.toContain('Новые русские требования');
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

  it('routes status through the consented API flow without exposing privacy commands', async () => {
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

    expect(listSubmissions).toHaveBeenCalledWith('200');
    const payloads = outgoing
      .filter(({ method }) => method === 'sendMessage')
      .map(({ payload }) => JSON.stringify(payload));
    expect(payloads.some((payload) => payload.includes('У вас пока нет поданных статей'))).toBe(
      true,
    );
    expect(payloads.every((payload) => !payload.includes('Запросить мои данные'))).toBe(true);
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

  it('persists normalized degree and title selections, including a custom value', async () => {
    let draft = {
      id: '83a7a9e3-b6af-4a37-a873-d83dc3f09ccc',
      journalId: '43c0f310-e5ad-4565-b69d-bada3fd88512',
      requirementVersionId: '58be2910-4ed7-411e-be5a-d6c2fdb31dc1',
      machineState: 'AUTHOR_DEGREE',
      expectedInputType: 'CALLBACK',
      context: {},
      rowVersion: 7,
      expiresAt: new Date('2027-01-01'),
      files: [],
      preflightRuns: [],
      requirementVersion: null,
      journal: null,
    };
    const updateDraft = vi
      .fn()
      .mockImplementation(
        (
          _telegramUserId: string,
          current: typeof draft,
          machineState: string,
          expectedInputType: string,
          contextPatch: Record<string, unknown> = {},
        ) => {
          draft = {
            ...current,
            machineState,
            expectedInputType,
            rowVersion: current.rowVersion + 1,
            context: { ...current.context, ...contextPatch },
          };
          return Promise.resolve(draft);
        },
      );
    const api = {
      claimUpdate: vi.fn().mockResolvedValue({
        claimed: true,
        correlationId: '64d4ef2c-418a-4d9c-a519-33c0abca8d9b',
      }),
      completeUpdate: vi.fn().mockResolvedValue(undefined),
      releaseUpdate: vi.fn().mockResolvedValue(undefined),
      syncUser: vi.fn().mockImplementation(() =>
        Promise.resolve({
          id: '4ef0649f-c2de-48ab-a8a7-f3bea4de9e04',
          locale: 'ru',
          status: 'ACTIVE',
          consentActive: true,
          activeDraft: draft,
          profile: null,
        }),
      ),
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

    await bot.handleUpdate(callbackUpdate(7, 'profile-choice:degree:AUTHOR:PHD'));
    expect(updateDraft).toHaveBeenLastCalledWith(
      '200',
      expect.objectContaining({ machineState: 'AUTHOR_DEGREE' }),
      'AUTHOR_ACADEMIC_TITLE',
      'CALLBACK',
      { degreeCode: 'PHD', degreeCustom: null },
    );
    expect(JSON.stringify(outgoing)).toContain('Выберите учёное звание');

    outgoing.length = 0;
    await bot.handleUpdate(update(8, '⬅️ Назад'));
    expect(updateDraft).toHaveBeenLastCalledWith(
      '200',
      expect.objectContaining({ machineState: 'AUTHOR_ACADEMIC_TITLE' }),
      'AUTHOR_DEGREE',
      'CALLBACK',
    );
    expect(draft.context).toMatchObject({ degreeCode: 'PHD' });

    await bot.handleUpdate(callbackUpdate(9, 'profile-choice:degree:AUTHOR:PHD'));
    outgoing.length = 0;
    await bot.handleUpdate(callbackUpdate(10, 'profile-choice:title:AUTHOR:OTHER'));
    expect(updateDraft).toHaveBeenLastCalledWith(
      '200',
      expect.objectContaining({ machineState: 'AUTHOR_ACADEMIC_TITLE' }),
      'AUTHOR_TITLE_CUSTOM',
      'TEXT',
      { titleCode: 'OTHER', titleCustom: null },
    );

    outgoing.length = 0;
    await bot.handleUpdate(update(11, 'International research fellow'));
    expect(updateDraft).toHaveBeenLastCalledWith(
      '200',
      expect.objectContaining({ machineState: 'AUTHOR_TITLE_CUSTOM' }),
      'AUTHOR_COAUTHORS',
      'TEXT',
      { titleCustom: 'International research fellow' },
    );
    expect(draft.context).toMatchObject({
      degreeCode: 'PHD',
      titleCode: 'OTHER',
      titleCustom: 'International research fellow',
    });
  });

  it('shows meaningful help and current configured contact data', async () => {
    const journalId = '43c0f310-e5ad-4565-b69d-bada3fd88512';
    const getTelegramContent = vi.fn().mockResolvedValue({
      contact: {
        phone: '+998 71 000 00 00',
        email: 'editorial@example.invalid',
        telegram: '@hmqa_support_test',
        address: 'Test address',
        workingHours: 'Mon–Fri 09:00–18:00',
        note: 'UAT contact only',
      },
      content: { HELP_SUBMIT: 'Configured: choose a journal and upload the required files.' },
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
      getTelegramContent,
      listJournals: vi.fn().mockResolvedValue([
        {
          id: journalId,
          code: 'UAT',
          mode: 'NATIVE',
          name: 'Тестовый журнал',
          description: 'Описание журнала',
          requirements: {
            id: '58be2910-4ed7-411e-be5a-d6c2fdb31dc1',
            version: 3,
            effectiveAt: new Date(),
            state: 'PUBLISHED',
            title: 'Требования UAT',
            summary: 'Краткие требования',
            body: 'Полный текст опубликованных требований.',
            help: null,
          },
        },
      ]),
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

    await bot.handleUpdate(update(10, '/help'));
    expect(JSON.stringify(outgoing)).toContain('Как подать статью');
    expect(JSON.stringify(outgoing)).toContain('Требования к файлам');

    outgoing.length = 0;
    await bot.handleUpdate(callbackUpdate(11, 'help:submit'));
    expect(JSON.stringify(outgoing)).toContain('Configured: choose a journal');

    outgoing.length = 0;
    await bot.handleUpdate(update(12, '☎️ Связаться'));
    const contactPayload = JSON.stringify(outgoing);
    expect(contactPayload).toContain('+998 71 000 00 00');
    expect(contactPayload).toContain('editorial@example.invalid');
    expect(contactPayload).toContain('@hmqa_support_test');
    expect(contactPayload).not.toContain('доступны в карточке журнала');

    outgoing.length = 0;
    await bot.handleUpdate(update(13, '📋 Требования'));
    expect(JSON.stringify(outgoing)).toContain(`requirements:${journalId}`);

    outgoing.length = 0;
    await bot.handleUpdate(callbackUpdate(14, `requirements:${journalId}`));
    const requirementPayload = JSON.stringify(outgoing);
    expect(requirementPayload).toContain('Требования · версия 3');
    expect(requirementPayload).toContain('Полный текст опубликованных требований.');

    outgoing.length = 0;
    await bot.handleUpdate(callbackUpdate(15, `contact:journal:${journalId}`));
    expect(getTelegramContent).toHaveBeenLastCalledWith('ru', journalId);
    expect(JSON.stringify(outgoing)).toContain('+998 71 000 00 00');
  });
});
