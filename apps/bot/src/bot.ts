import {
  escapeTelegramHtml,
  normalizeLocale,
  translate,
  type Locale,
  type TranslationKey,
} from '@hmqa/i18n';
import {
  journalRequirementConfigSchema,
  type JournalMetadataPolicy,
  type JournalRequirementFilePolicy,
} from '@hmqa/contracts';
import { Bot, InlineKeyboard, Keyboard, type Context } from 'grammy';
import { maskEmail, maskPhone } from '@hmqa/security';
import * as Sentry from '@sentry/node';
import { HmqaApiError, type DraftState, type HmqaApiClient, type UserState } from './api-client.js';

const databaseLocaleByPublicLocale: Readonly<Record<Locale, 'UZ_LATN' | 'RU' | 'EN'>> = {
  'uz-Latn': 'UZ_LATN',
  ru: 'RU',
  en: 'EN',
};

function localizedRecord<T extends { locale: 'UZ_LATN' | 'RU' | 'EN' }>(
  records: readonly T[],
  locale: Locale,
): T | undefined {
  const preferences = [databaseLocaleByPublicLocale[locale], 'RU', 'EN', 'UZ_LATN'] as const;
  for (const preferred of preferences) {
    const record = records.find(({ locale: candidate }) => candidate === preferred);
    if (record) return record;
  }
  return undefined;
}

export type BotApi = Pick<
  HmqaApiClient,
  | 'claimUpdate'
  | 'completeUpdate'
  | 'releaseUpdate'
  | 'syncUser'
  | 'setLocale'
  | 'getTelegramContent'
  | 'createProfileDraft'
  | 'finalizeProfileDraft'
  | 'recordConsent'
  | 'listJournals'
  | 'createDraft'
  | 'updateDraft'
  | 'attachTelegramFile'
  | 'finalizeDraft'
  | 'cancelDraft'
  | 'listSubmissions'
  | 'getSubmission'
  | 'getSubmissionFileUrl'
  | 'getSubmissionReceipt'
  | 'listNotifications'
  | 'createRevisionDraft'
>;

const localeCallbacks: Readonly<Record<string, Locale>> = {
  'lang:uz': 'uz-Latn',
  'lang:ru': 'ru',
  'lang:en': 'en',
};
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^\+[1-9]\d{7,14}$/;

function languageKeyboard() {
  return new InlineKeyboard()
    .text('O‘zbekcha', 'lang:uz')
    .text('Русский', 'lang:ru')
    .text('English', 'lang:en');
}

const degreeCodes = [
  'NONE',
  'PHD',
  'DSC',
  'CANDIDATE_OF_SCIENCES',
  'DOCTOR_OF_SCIENCES',
  'OTHER',
] as const;
const titleCodes = [
  'NONE',
  'PROFESSOR',
  'ASSOCIATE_PROFESSOR',
  'SENIOR_RESEARCHER',
  'OTHER',
] as const;

function degreeLabel(locale: Locale, code: string, custom?: unknown): string {
  if (code === 'OTHER' && typeof custom === 'string') return custom;
  const normalized = degreeCodes.includes(code as (typeof degreeCodes)[number])
    ? code.toLowerCase()
    : 'none';
  return translate(locale, `degree.${normalized}` as TranslationKey);
}

function titleLabel(locale: Locale, code: string, custom?: unknown): string {
  if (code === 'OTHER' && typeof custom === 'string') return custom;
  const normalized = titleCodes.includes(code as (typeof titleCodes)[number])
    ? code.toLowerCase()
    : 'none';
  return translate(locale, `title.${normalized}` as TranslationKey);
}

function degreeKeyboard(locale: Locale, prefix: 'AUTHOR' | 'PROFILE'): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const code of degreeCodes)
    keyboard.text(degreeLabel(locale, code), `profile-choice:degree:${prefix}:${code}`).row();
  return keyboard;
}

function titleKeyboard(locale: Locale, prefix: 'AUTHOR' | 'PROFILE'): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const code of titleCodes)
    keyboard.text(titleLabel(locale, code), `profile-choice:title:${prefix}:${code}`).row();
  return keyboard;
}

function helpKeyboard(locale: Locale): InlineKeyboard {
  return new InlineKeyboard()
    .text(translate(locale, 'help.submit.label'), 'help:submit')
    .row()
    .text(translate(locale, 'help.files.label'), 'help:files')
    .row()
    .text(translate(locale, 'help.statuses.label'), 'help:statuses')
    .row()
    .text(translate(locale, 'help.revision.label'), 'help:revision')
    .row()
    .text(translate(locale, 'help.contact.label'), 'help:contact');
}

async function showHelp(ctx: Context, locale: Locale) {
  return ctx.reply(translate(locale, 'help.summary'), { reply_markup: helpKeyboard(locale) });
}

async function showContact(ctx: Context, api: BotApi, locale: Locale, journalId?: string) {
  const { contact, content } = await api.getTelegramContent(locale, journalId);
  const rows = [
    contact.phone ? `${translate(locale, 'contact.phone')}: ${contact.phone}` : null,
    contact.email ? `${translate(locale, 'contact.email')}: ${contact.email}` : null,
    contact.telegram ? `${translate(locale, 'contact.telegram')}: ${contact.telegram}` : null,
    contact.address ? `${translate(locale, 'contact.address')}: ${contact.address}` : null,
    contact.workingHours ? `${translate(locale, 'contact.hours')}: ${contact.workingHours}` : null,
    contact.note,
    content.HELP_CONTACT,
  ].filter((row): row is string => Boolean(row));
  return ctx.reply(
    rows.length > 0
      ? `${translate(locale, 'contact.heading')}\n\n${rows.join('\n')}`
      : translate(locale, 'contact.not_configured'),
  );
}

export function mainMenu(locale: Locale) {
  return new Keyboard()
    .text(translate(locale, 'menu.submit_article'))
    .text(translate(locale, 'menu.my_articles'))
    .row()
    .text(translate(locale, 'menu.journals'))
    .text(translate(locale, 'journal.requirements'))
    .row()
    .text(translate(locale, 'menu.profile'))
    .text(translate(locale, 'menu.notifications'))
    .row()
    .text(translate(locale, 'menu.help'))
    .text(translate(locale, 'menu.contact'))
    .row()
    .text(translate(locale, 'menu.language'))
    .resized()
    .persistent();
}

export function botCommands(locale: Locale) {
  return [
    { command: 'start', description: translate(locale, 'bot.command.start') },
    { command: 'help', description: translate(locale, 'bot.command.help') },
    { command: 'journals', description: translate(locale, 'bot.command.journals') },
    { command: 'requirements', description: translate(locale, 'bot.command.requirements') },
    { command: 'submit', description: translate(locale, 'bot.command.submit') },
    { command: 'drafts', description: translate(locale, 'bot.command.drafts') },
    { command: 'articles', description: translate(locale, 'bot.command.articles') },
    { command: 'status', description: translate(locale, 'bot.command.status') },
    { command: 'profile', description: translate(locale, 'bot.command.profile') },
    { command: 'language', description: translate(locale, 'bot.command.language') },
    { command: 'cancel', description: translate(locale, 'bot.command.cancel') },
  ];
}

function consentKeyboard(locale: Locale) {
  return new InlineKeyboard()
    .text(translate(locale, 'consent.accept'), 'consent:yes')
    .row()
    .text(translate(locale, 'consent.decline'), 'consent:no');
}

export function resolveUserLocale(
  selectedLocale: Locale | null | undefined,
  telegramLocale: string | undefined,
): Locale {
  return selectedLocale ?? normalizeLocale(telegramLocale);
}

function requirementMetadataPolicy(draft: DraftState): JournalMetadataPolicy | null {
  const rawConfig =
    draft.requirementVersion?.config ?? draft.journal?.currentRequirement?.config ?? null;
  const parsed = journalRequirementConfigSchema.safeParse(rawConfig);
  return parsed.success ? parsed.data.metadata : null;
}

function statePrompt(locale: Locale, state: string, draft?: DraftState): string {
  const prompts: Record<string, TranslationKey> = {
    AUTHOR_FULL_NAME: 'author.full_name',
    AUTHOR_PHONE: 'author.phone',
    AUTHOR_EMAIL: 'author.email',
    AUTHOR_ORGANIZATION: 'author.organization',
    AUTHOR_POSITION: 'author.position',
    AUTHOR_DEGREE_CUSTOM: 'author.degree_custom',
    AUTHOR_TITLE_CUSTOM: 'author.title_custom',
    AUTHOR_COAUTHORS: 'author.coauthors',
    PROFILE_FULL_NAME: 'author.full_name',
    PROFILE_PHONE: 'author.phone',
    PROFILE_EMAIL: 'author.email',
    PROFILE_ORGANIZATION: 'author.organization',
    PROFILE_POSITION: 'author.position',
    PROFILE_DEGREE_CUSTOM: 'author.degree_custom',
    PROFILE_TITLE_CUSTOM: 'author.title_custom',
    ARTICLE_TITLE: 'article.title',
    ARTICLE_TYPE: 'article.type',
    ARTICLE_LANGUAGE: 'article.language',
    ARTICLE_SECTION: 'article.section',
  };
  const key = prompts[state];
  if (key) return translate(locale, key);
  const metadata = draft ? requirementMetadataPolicy(draft) : null;
  if (state === 'ARTICLE_ABSTRACT') {
    if (!metadata) return translate(locale, 'error.file_set_incomplete');
    return translate(locale, 'article.annotation', {
      annotation_limit: translate(locale, 'article.annotation_range', {
        min: metadata.abstractMinWords,
        max: metadata.abstractMaxWords,
      }),
    });
  }
  if (state === 'ARTICLE_KEYWORDS') {
    if (!metadata) return translate(locale, 'error.file_set_incomplete');
    return translate(locale, 'article.keywords', {
      keywords_rule: translate(locale, 'article.keyword_range', {
        min: metadata.keywordMinCount,
        max: metadata.keywordMaxCount,
      }),
    });
  }
  if (state === 'FILE_ARTICLE')
    return translate(locale, 'file.upload_article', { max_article_size: '19 MiB' });
  return translate(locale, 'menu.title');
}

async function loadUser(ctx: Context, api: BotApi): Promise<UserState | null> {
  if (!ctx.from || !ctx.chat) return null;
  return api.syncUser({
    telegramUserId: String(ctx.from.id),
    telegramChatId: String(ctx.chat.id),
    username: ctx.from.username ?? null,
  });
}

async function showConsent(ctx: Context, locale: Locale) {
  await ctx.reply(
    `${translate(locale, 'start.welcome')}\n\n${translate(locale, 'consent.short')}`,
    { reply_markup: consentKeyboard(locale) },
  );
}

async function showMenu(ctx: Context, locale: Locale, api?: BotApi, includeWelcome = false) {
  let support: string | null | undefined = null;
  try {
    support = api ? (await api.getTelegramContent(locale)).content.WELCOME_SUPPORT : null;
  } catch {
    // CMS availability must never prevent access to the durable main menu.
  }
  await ctx.reply(
    [translate(locale, includeWelcome ? 'start.welcome' : 'menu.title'), support]
      .filter(Boolean)
      .join('\n\n'),
    { reply_markup: mainMenu(locale) },
  );
}

async function showJournals(
  ctx: Context,
  api: BotApi,
  locale: Locale,
  forSubmission = false,
  forRequirements = false,
) {
  const journals = await api.listJournals(locale);
  if (journals.length === 0) return ctx.reply(translate(locale, 'journal.list_empty'));
  const keyboard = new InlineKeyboard();
  const action = forSubmission ? 'choose' : forRequirements ? 'requirements' : 'journal';
  for (const journal of journals) keyboard.text(journal.name, `${action}:${journal.id}`).row();
  return ctx.reply(
    forSubmission
      ? translate(locale, 'menu.submit_article')
      : forRequirements
        ? translate(locale, 'journal.requirements')
        : translate(locale, 'menu.journals'),
    { reply_markup: keyboard },
  );
}

function preview(locale: Locale, draft: DraftState): string {
  const value = draft.context;
  const text = (input: unknown): string =>
    typeof input === 'string' || typeof input === 'number' ? String(input) : '';
  const authorName =
    text(value.fullName) ||
    [value.lastName, value.firstName, value.middleName]
      .map(text)
      .filter((part) => part && part !== '-')
      .join(' ');
  const fields = [
    [translate(locale, 'submission.preview.author'), authorName],
    [translate(locale, 'submission.preview.phone'), maskPhone(text(value.phone))],
    [translate(locale, 'submission.preview.email'), maskEmail(text(value.email))],
    [translate(locale, 'submission.preview.organization'), text(value.organization)],
    [translate(locale, 'submission.preview.position'), text(value.position)],
    [
      translate(locale, 'submission.preview.degree'),
      degreeLabel(locale, text(value.degreeCode), value.degreeCustom ?? value.degree),
    ],
    [
      translate(locale, 'submission.preview.academic_title'),
      titleLabel(locale, text(value.titleCode), value.titleCustom ?? value.academicTitle),
    ],
    [translate(locale, 'submission.preview.coauthors'), text(value.coauthors)],
    [translate(locale, 'submission.preview.title'), text(value.articleTitle)],
    [translate(locale, 'submission.preview.article_type'), text(value.articleType)],
    [translate(locale, 'submission.preview.language'), text(value.articleLanguage)],
    [translate(locale, 'submission.preview.section'), text(value.articleSection)],
    [translate(locale, 'submission.preview.abstract'), text(value.abstract)],
    [translate(locale, 'submission.preview.keywords'), text(value.keywords)],
  ];
  return `<b>${escapeTelegramHtml(translate(locale, 'common.details'))}</b>\n\n${fields.map(([name, value]) => `<b>${escapeTelegramHtml(name!)}:</b> ${escapeTelegramHtml(value!)}`).join('\n')}`;
}

function profilePreview(
  locale: Locale,
  draft: DraftState,
  heading: TranslationKey = 'profile.confirm',
): string {
  const value = draft.context;
  const text = (input: unknown): string => (typeof input === 'string' ? input : '');
  const fields = [
    [
      '👤',
      text(value.fullName) ||
        [value.lastName, value.firstName, value.middleName]
          .map(text)
          .filter((part) => part && part !== '-')
          .join(' '),
    ],
    ['📞', maskPhone(text(value.phone))],
    ['✉️', maskEmail(text(value.email))],
    ['🏢', text(value.organization)],
    ['💼', text(value.position)],
    ['🎓', degreeLabel(locale, text(value.degreeCode), value.degreeCustom ?? value.degree)],
    ['🏅', titleLabel(locale, text(value.titleCode), value.titleCustom ?? value.academicTitle)],
  ];
  return `${escapeTelegramHtml(translate(locale, heading))}\n\n${fields
    .map(([name, fieldValue]) => `${escapeTelegramHtml(name!)} ${escapeTelegramHtml(fieldValue!)}`)
    .join('\n')}`;
}

function requirementFilePolicies(draft: DraftState): readonly JournalRequirementFilePolicy[] {
  const rawConfig =
    draft.requirementVersion?.config ?? draft.journal?.currentRequirement?.config ?? null;
  const parsed = journalRequirementConfigSchema.safeParse(rawConfig);
  return parsed.success ? parsed.data.requiredFiles : [];
}

function skippedFileCategories(draft: DraftState): ReadonlySet<string> {
  const value = draft.context.skippedFileCategories;
  return new Set(
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [],
  );
}

function currentFilePolicy(draft: DraftState): JournalRequirementFilePolicy | undefined {
  const policies = requirementFilePolicies(draft);
  const selected = draft.context.activeFileCategory;
  if (typeof selected === 'string') {
    const explicit = policies.find((policy) => policy.category === selected);
    if (explicit) return explicit;
  }
  const skipped = skippedFileCategories(draft);
  return policies.find(
    (policy) =>
      !skipped.has(policy.category) &&
      !draft.files.some((file) => file.category === policy.category && !file.replacedAt),
  );
}

function filePolicyLabel(locale: Locale, policy: JournalRequirementFilePolicy): string {
  return policy.labels[locale];
}

function submissionFileLabel(locale: Locale, config: unknown, category: string): string {
  const parsed = journalRequirementConfigSchema.safeParse(config);
  return (
    (parsed.success
      ? parsed.data.requiredFiles.find((policy) => policy.category === category)?.labels[locale]
      : undefined) ?? translate(locale, 'file.unnamed_category')
  );
}

function fileLimit(draft: DraftState, policy: JournalRequirementFilePolicy): number {
  const rawConfig =
    draft.requirementVersion?.config ?? draft.journal?.currentRequirement?.config ?? null;
  const parsed = journalRequirementConfigSchema.safeParse(rawConfig);
  return parsed.success
    ? Math.min(policy.maxBytes ?? parsed.data.limits.maxBytes, parsed.data.limits.maxBytes)
    : 19 * 1024 * 1024;
}

function replacementKeyboard(locale: Locale, draft: DraftState): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const policies = requirementFilePolicies(draft);
  for (const file of draft.files.filter((item) => !item.replacedAt)) {
    const index = policies.findIndex((policy) => policy.category === file.category);
    if (index < 0) continue;
    keyboard
      .text(
        `${translate(locale, 'submission.replace_file')}: ${filePolicyLabel(locale, policies[index]!)}`,
        `draft:replace:${index}:${draft.id}:${draft.rowVersion}`,
      )
      .row();
  }
  return keyboard;
}

function renderNotification(
  locale: Locale,
  notification: {
    eventCode: string;
    templateSnapshot: unknown;
    variables: Record<string, unknown>;
  },
): string {
  const snapshot = notification.templateSnapshot;
  const key =
    typeof snapshot === 'object' &&
    snapshot !== null &&
    !Array.isArray(snapshot) &&
    'key' in snapshot &&
    typeof snapshot.key === 'string'
      ? snapshot.key
      : notification.eventCode;
  const variables = Object.fromEntries(
    Object.entries(notification.variables).map(([name, value]) => [name, String(value)]),
  );
  return translate(locale, key as TranslationKey, variables);
}

async function continueDraft(ctx: Context, api: BotApi, locale: Locale, draft: DraftState) {
  if (draft.machineState === 'PROFILE_SNAPSHOT') {
    return ctx.reply(profilePreview(locale, draft, 'profile.submission_snapshot'), {
      parse_mode: 'HTML',
      reply_markup: appendDraftNavigation(
        new InlineKeyboard()
          .text(
            translate(locale, 'profile.use_snapshot'),
            `draft:profile:confirm:${draft.id}:${draft.rowVersion}`,
          )
          .row()
          .text(
            translate(locale, 'profile.edit_for_submission'),
            `draft:profile:edit:${draft.id}:${draft.rowVersion}`,
          ),
        locale,
        draft,
      ),
    });
  }
  if (draft.machineState === 'PROFILE_CONFIRM') {
    return ctx.reply(profilePreview(locale, draft), {
      parse_mode: 'HTML',
      reply_markup: appendDraftNavigation(
        new InlineKeyboard()
          .text(translate(locale, 'profile.save'), `profile:save:${draft.id}:${draft.rowVersion}`)
          .row()
          .text(translate(locale, 'common.cancel'), 'draft:cancel'),
        locale,
        draft,
      ),
    });
  }
  if (draft.machineState === 'REQUIREMENTS_ACK') {
    const requirement = draft.requirementVersion ?? draft.journal?.currentRequirement;
    const localization = requirement
      ? localizedRecord(requirement.localizations, locale)
      : undefined;
    const journalLocalization = draft.journal
      ? localizedRecord(draft.journal.localizations, locale)
      : undefined;
    const text = `${localization?.title ?? draft.journal?.code ?? ''}\n\n${localization?.summary ?? localization?.body ?? ''}\n\n${translate(locale, 'requirements.ack', { requirements_version: requirement?.version ?? '?', journal_name: journalLocalization?.name ?? draft.journal?.code ?? '?' })}`;
    return ctx.reply(text, {
      reply_markup: appendDraftNavigation(
        new InlineKeyboard()
          .text(translate(locale, 'common.confirm'), `draft:ack:${draft.id}:${draft.rowVersion}`)
          .row()
          .text(translate(locale, 'common.cancel'), 'draft:cancel'),
        locale,
        draft,
        false,
      ),
    });
  }
  if (draft.machineState === 'FILE_SCANNING') {
    const policy = currentFilePolicy(draft);
    const active = policy
      ? draft.files.find((item) => item.category === policy.category && !item.replacedAt)
      : undefined;
    const preflight = active
      ? draft.preflightRuns.find((run) => run.fileId === active.file.id)
      : undefined;
    if (active?.file.scanStatus === 'CLEAN' && active.file.storageStatus === 'STORED') {
      if (!preflight || preflight.status !== 'COMPLETED' || preflight.blockingCount > 0) {
        return ctx.reply(
          translate(locale, 'preflight.complete', {
            blocking_count: preflight?.blockingCount ?? 1,
            error_count: preflight?.errorCount ?? 0,
            warning_count: preflight?.warningCount ?? 0,
          }),
          {
            reply_markup: new InlineKeyboard().text(
              translate(locale, 'common.retry'),
              'draft:refresh',
            ),
          },
        );
      }
      const pending = await api.updateDraft(
        String(ctx.from!.id),
        draft,
        'FILE_ARTICLE',
        'DOCUMENT',
        {
          activeFileCategory: null,
        },
      );
      if (currentFilePolicy(pending)) return continueDraft(ctx, api, locale, pending);
      const updated = await api.updateDraft(String(ctx.from!.id), pending, 'PREVIEW', 'CALLBACK');
      const keyboard = new InlineKeyboard()
        .text(
          translate(locale, 'submission.final_submit'),
          `draft:submit:${updated.id}:${updated.rowVersion}`,
        )
        .row();
      for (const row of replacementKeyboard(locale, updated).inline_keyboard)
        keyboard.add(...row).row();
      appendDraftNavigation(keyboard, locale, updated);
      return ctx.reply(preview(locale, updated), { parse_mode: 'HTML', reply_markup: keyboard });
    }
    if (active && ['INFECTED', 'SUSPICIOUS', 'ERROR', 'TIMEOUT'].includes(active.file.scanStatus))
      return ctx.reply(translate(locale, 'error.file_security'), {
        reply_markup: new InlineKeyboard().text(
          translate(locale, 'common.retry'),
          `draft:replace:${Math.max(
            0,
            requirementFilePolicies(draft).findIndex((item) => item.category === policy?.category),
          )}:${draft.id}:${draft.rowVersion}`,
        ),
      });
    return ctx.reply(
      translate(locale, 'file.accepted', {
        filename: active?.file.originalName ?? '-',
        size: active?.file.sizeBytes ?? '0',
      }),
      {
        reply_markup: new InlineKeyboard().text(translate(locale, 'common.retry'), 'draft:refresh'),
      },
    );
  }
  if (draft.machineState === 'FILE_ARTICLE') {
    const policy = currentFilePolicy(draft);
    if (!policy) return ctx.reply(translate(locale, 'error.file_set_incomplete'));
    const maximum = fileLimit(draft, policy);
    const keyboard = new Keyboard()
      .text(translate(locale, 'common.save_draft'))
      .text(translate(locale, 'common.cancel'))
      .row()
      .text(translate(locale, 'common.back'))
      .text(translate(locale, 'common.home'));
    if (!policy.required) keyboard.row().text(translate(locale, 'common.skip'));
    return ctx.reply(
      translate(locale, 'file.upload_category', {
        category: filePolicyLabel(locale, policy),
        allowed_formats: policy.formats.map((format) => format.toUpperCase()).join(', '),
        max_size: `${Math.floor(maximum / 1024 / 1024)} MiB`,
        requirement: policy.required
          ? translate(locale, 'file.required')
          : translate(locale, 'file.optional'),
      }),
      { reply_markup: keyboard.resized() },
    );
  }
  if (draft.machineState === 'PREVIEW') {
    const keyboard = new InlineKeyboard()
      .text(
        translate(locale, 'submission.final_submit'),
        `draft:submit:${draft.id}:${draft.rowVersion}`,
      )
      .row();
    for (const row of replacementKeyboard(locale, draft).inline_keyboard)
      keyboard.add(...row).row();
    appendDraftNavigation(keyboard, locale, draft);
    return ctx.reply(preview(locale, draft), {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  }
  if (draft.machineState === 'AUTHOR_DEGREE' || draft.machineState === 'PROFILE_DEGREE') {
    return ctx.reply(translate(locale, 'author.degree_select'), {
      reply_markup: appendDraftNavigation(
        degreeKeyboard(locale, draft.machineState.startsWith('AUTHOR_') ? 'AUTHOR' : 'PROFILE'),
        locale,
        draft,
      ),
    });
  }
  if (
    draft.machineState === 'AUTHOR_ACADEMIC_TITLE' ||
    draft.machineState === 'PROFILE_ACADEMIC_TITLE'
  ) {
    return ctx.reply(translate(locale, 'author.title_select'), {
      reply_markup: appendDraftNavigation(
        titleKeyboard(locale, draft.machineState.startsWith('AUTHOR_') ? 'AUTHOR' : 'PROFILE'),
        locale,
        draft,
      ),
    });
  }
  if (draft.machineState === 'ARTICLE_LANGUAGE') {
    return ctx.reply(statePrompt(locale, draft.machineState, draft), {
      reply_markup: new Keyboard()
        .text(translate(locale, 'language.uz'))
        .text(translate(locale, 'language.ru'))
        .text(translate(locale, 'language.en'))
        .row()
        .text(translate(locale, 'common.save_draft'))
        .text(translate(locale, 'common.cancel'))
        .row()
        .text(translate(locale, 'common.back'))
        .text(translate(locale, 'common.home'))
        .resized(),
    });
  }
  return ctx.reply(statePrompt(locale, draft.machineState, draft), {
    reply_markup: new Keyboard()
      .text(translate(locale, 'common.save_draft'))
      .text(translate(locale, 'common.cancel'))
      .row()
      .text(translate(locale, 'common.back'))
      .text(translate(locale, 'common.home'))
      .resized(),
  });
}

const textSteps: Readonly<Record<string, { field: string; next: string; expected: string }>> = {
  AUTHOR_FULL_NAME: { field: 'fullName', next: 'AUTHOR_PHONE', expected: 'TEXT' },
  AUTHOR_PHONE: { field: 'phone', next: 'AUTHOR_EMAIL', expected: 'TEXT' },
  AUTHOR_EMAIL: { field: 'email', next: 'AUTHOR_ORGANIZATION', expected: 'TEXT' },
  AUTHOR_ORGANIZATION: { field: 'organization', next: 'AUTHOR_POSITION', expected: 'TEXT' },
  AUTHOR_POSITION: { field: 'position', next: 'AUTHOR_DEGREE', expected: 'CALLBACK' },
  AUTHOR_DEGREE_CUSTOM: {
    field: 'degreeCustom',
    next: 'AUTHOR_ACADEMIC_TITLE',
    expected: 'CALLBACK',
  },
  AUTHOR_TITLE_CUSTOM: { field: 'titleCustom', next: 'AUTHOR_COAUTHORS', expected: 'TEXT' },
  AUTHOR_COAUTHORS: { field: 'coauthors', next: 'ARTICLE_TITLE', expected: 'TEXT' },
  ARTICLE_TITLE: { field: 'articleTitle', next: 'ARTICLE_TYPE', expected: 'TEXT' },
  ARTICLE_TYPE: { field: 'articleType', next: 'ARTICLE_LANGUAGE', expected: 'TEXT' },
  ARTICLE_LANGUAGE: { field: 'articleLanguage', next: 'ARTICLE_SECTION', expected: 'TEXT' },
  ARTICLE_SECTION: { field: 'articleSection', next: 'ARTICLE_ABSTRACT', expected: 'TEXT' },
  ARTICLE_ABSTRACT: { field: 'abstract', next: 'ARTICLE_KEYWORDS', expected: 'TEXT' },
  ARTICLE_KEYWORDS: { field: 'keywords', next: 'FILE_ARTICLE', expected: 'DOCUMENT' },
};

const profileTextFields: Readonly<Record<string, string>> = {
  PROFILE_FULL_NAME: 'fullName',
  PROFILE_PHONE: 'phone',
  PROFILE_EMAIL: 'email',
  PROFILE_ORGANIZATION: 'organization',
  PROFILE_POSITION: 'position',
  PROFILE_DEGREE_CUSTOM: 'degreeCustom',
  PROFILE_TITLE_CUSTOM: 'titleCustom',
};

function nextProfileState(draft: DraftState): string {
  const section = draft.context.profileSection;
  const all = section === 'all';
  const transitions: Readonly<Record<string, string>> = {
    PROFILE_FULL_NAME: all ? 'PROFILE_PHONE' : 'PROFILE_CONFIRM',
    PROFILE_PHONE: all ? 'PROFILE_EMAIL' : 'PROFILE_CONFIRM',
    PROFILE_EMAIL: all ? 'PROFILE_ORGANIZATION' : 'PROFILE_CONFIRM',
    PROFILE_ORGANIZATION: all ? 'PROFILE_POSITION' : 'PROFILE_CONFIRM',
    PROFILE_POSITION: all ? 'PROFILE_DEGREE' : 'PROFILE_CONFIRM',
    PROFILE_DEGREE_CUSTOM: all ? 'PROFILE_ACADEMIC_TITLE' : 'PROFILE_CONFIRM',
    PROFILE_TITLE_CUSTOM: 'PROFILE_CONFIRM',
  };
  return transitions[draft.machineState] ?? 'PROFILE_CONFIRM';
}

function previousDraftStep(
  draft: DraftState,
): { machineState: string; expectedInputType: string } | null {
  if (draft.machineState === 'PROFILE_CONFIRM') {
    const stateBySection: Readonly<Record<string, string>> = {
      all: 'PROFILE_ACADEMIC_TITLE',
      name: 'PROFILE_FULL_NAME',
      phone: 'PROFILE_PHONE',
      email: 'PROFILE_EMAIL',
      organization: 'PROFILE_ORGANIZATION',
      position: 'PROFILE_POSITION',
      degree: 'PROFILE_DEGREE',
      title: 'PROFILE_ACADEMIC_TITLE',
    };
    const profileSection = draft.context.profileSection;
    const machineState =
      stateBySection[typeof profileSection === 'string' ? profileSection : 'all'] ??
      'PROFILE_ACADEMIC_TITLE';
    return {
      machineState,
      expectedInputType: ['PROFILE_DEGREE', 'PROFILE_ACADEMIC_TITLE'].includes(machineState)
        ? 'CALLBACK'
        : 'TEXT',
    };
  }
  const previous: Readonly<Record<string, { machineState: string; expectedInputType: string }>> = {
    PROFILE_SNAPSHOT: { machineState: 'REQUIREMENTS_ACK', expectedInputType: 'CALLBACK' },
    AUTHOR_FULL_NAME: { machineState: 'REQUIREMENTS_ACK', expectedInputType: 'CALLBACK' },
    AUTHOR_PHONE: { machineState: 'AUTHOR_FULL_NAME', expectedInputType: 'TEXT' },
    AUTHOR_EMAIL: { machineState: 'AUTHOR_PHONE', expectedInputType: 'TEXT' },
    AUTHOR_ORGANIZATION: { machineState: 'AUTHOR_EMAIL', expectedInputType: 'TEXT' },
    AUTHOR_POSITION: { machineState: 'AUTHOR_ORGANIZATION', expectedInputType: 'TEXT' },
    AUTHOR_DEGREE: { machineState: 'AUTHOR_POSITION', expectedInputType: 'TEXT' },
    AUTHOR_DEGREE_CUSTOM: { machineState: 'AUTHOR_DEGREE', expectedInputType: 'CALLBACK' },
    AUTHOR_ACADEMIC_TITLE: { machineState: 'AUTHOR_DEGREE', expectedInputType: 'CALLBACK' },
    AUTHOR_TITLE_CUSTOM: { machineState: 'AUTHOR_ACADEMIC_TITLE', expectedInputType: 'CALLBACK' },
    AUTHOR_COAUTHORS: { machineState: 'AUTHOR_ACADEMIC_TITLE', expectedInputType: 'CALLBACK' },
    ARTICLE_TITLE: { machineState: 'AUTHOR_COAUTHORS', expectedInputType: 'TEXT' },
    ARTICLE_TYPE: { machineState: 'ARTICLE_TITLE', expectedInputType: 'TEXT' },
    ARTICLE_LANGUAGE: { machineState: 'ARTICLE_TYPE', expectedInputType: 'TEXT' },
    ARTICLE_SECTION: { machineState: 'ARTICLE_LANGUAGE', expectedInputType: 'TEXT' },
    ARTICLE_ABSTRACT: { machineState: 'ARTICLE_SECTION', expectedInputType: 'TEXT' },
    ARTICLE_KEYWORDS: { machineState: 'ARTICLE_ABSTRACT', expectedInputType: 'TEXT' },
    FILE_ARTICLE: { machineState: 'ARTICLE_KEYWORDS', expectedInputType: 'TEXT' },
    PREVIEW: { machineState: 'FILE_ARTICLE', expectedInputType: 'DOCUMENT' },
    PROFILE_PHONE: { machineState: 'PROFILE_FULL_NAME', expectedInputType: 'TEXT' },
    PROFILE_EMAIL: { machineState: 'PROFILE_PHONE', expectedInputType: 'TEXT' },
    PROFILE_ORGANIZATION: { machineState: 'PROFILE_EMAIL', expectedInputType: 'TEXT' },
    PROFILE_POSITION: { machineState: 'PROFILE_ORGANIZATION', expectedInputType: 'TEXT' },
    PROFILE_DEGREE: { machineState: 'PROFILE_POSITION', expectedInputType: 'TEXT' },
    PROFILE_DEGREE_CUSTOM: { machineState: 'PROFILE_DEGREE', expectedInputType: 'CALLBACK' },
    PROFILE_ACADEMIC_TITLE: { machineState: 'PROFILE_DEGREE', expectedInputType: 'CALLBACK' },
    PROFILE_TITLE_CUSTOM: {
      machineState: 'PROFILE_ACADEMIC_TITLE',
      expectedInputType: 'CALLBACK',
    },
  };
  return previous[draft.machineState] ?? null;
}

function draftNavigation(locale: Locale, draft: DraftState, includeBack = true): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (includeBack && previousDraftStep(draft)) {
    keyboard
      .text(translate(locale, 'common.back'), `draft:back:${draft.id}:${draft.rowVersion}`)
      .row();
  }
  return keyboard.text(translate(locale, 'common.home'), 'menu:home');
}

function appendDraftNavigation(
  keyboard: InlineKeyboard,
  locale: Locale,
  draft: DraftState,
  includeBack = true,
): InlineKeyboard {
  for (const row of draftNavigation(locale, draft, includeBack).inline_keyboard)
    keyboard.add(...row).row();
  return keyboard;
}

function profileKeyboard(locale: Locale, hasProfile: boolean): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (!hasProfile) keyboard.text(translate(locale, 'profile.create'), 'profile:edit:all').row();
  else
    keyboard
      .text(translate(locale, 'profile.edit'), 'profile:edit:all')
      .row()
      .text(translate(locale, 'profile.edit_name'), 'profile:edit:name')
      .row()
      .text(translate(locale, 'profile.edit_phone'), 'profile:edit:phone')
      .row()
      .text(translate(locale, 'profile.edit_email'), 'profile:edit:email')
      .row()
      .text(translate(locale, 'profile.edit_organization'), 'profile:edit:organization')
      .row()
      .text(translate(locale, 'profile.edit_position'), 'profile:edit:position')
      .row()
      .text(translate(locale, 'profile.edit_degree'), 'profile:edit:degree')
      .row()
      .text(translate(locale, 'profile.edit_title'), 'profile:edit:title')
      .row();
  return keyboard.text(translate(locale, 'common.home'), 'menu:home');
}

async function showSubmissions(ctx: Context, api: BotApi, locale: Locale, telegramUserId: string) {
  const result = await api.listSubmissions(telegramUserId);
  if (result.items.length === 0) return ctx.reply(translate(locale, 'submission.list_empty'));
  const keyboard = new InlineKeyboard();
  for (const item of result.items) {
    keyboard
      .text(`${translate(locale, 'common.details')} · ${item.publicId}`, `submission:${item.id}`)
      .row();
    if (item.status === 'NEEDS_CORRECTION' || item.status === 'REVISION_REQUESTED')
      keyboard
        .text(
          `${translate(locale, 'submission.new_version')} · ${item.publicId}`,
          `revision:${item.id}`,
        )
        .row();
  }
  return ctx.reply(
    result.items
      .map(
        (item) =>
          `${item.publicId} — ${translate(locale, `status.${item.status.toLowerCase()}` as TranslationKey)}`,
      )
      .join('\n'),
    { reply_markup: keyboard },
  );
}

async function showNotifications(
  ctx: Context,
  api: BotApi,
  locale: Locale,
  telegramUserId: string,
) {
  const result = await api.listNotifications(telegramUserId);
  if (result.items.length === 0) return ctx.reply(translate(locale, 'notification.list_empty'));
  return ctx.reply(
    result.items
      .map(
        (item) =>
          `${item.createdAt.toLocaleDateString(locale)} — ${renderNotification(locale, item)}`,
      )
      .join('\n'),
  );
}

async function showProfile(ctx: Context, user: UserState, locale: Locale) {
  const profile = user.profile;
  return ctx.reply(
    profile
      ? [
          `👤 ${profile.fullName}`,
          `📞 ${profile.phone}`,
          `✉️ ${profile.email}`,
          `🏢 ${profile.organization}`,
          `💼 ${profile.position}`,
          `🎓 ${degreeLabel(locale, profile.degreeCode, profile.degreeCustom)}`,
          `🏅 ${titleLabel(locale, profile.titleCode, profile.titleCustom)}`,
        ].join('\n')
      : translate(locale, 'profile.not_created'),
    { reply_markup: profileKeyboard(locale, Boolean(profile)) },
  );
}

async function requireConsentedUser(ctx: Context, api: BotApi): Promise<UserState | null> {
  const user = await loadUser(ctx, api);
  if (!user?.locale) {
    await ctx.reply(translate('uz-Latn', 'start.choose_language'), {
      reply_markup: languageKeyboard(),
    });
    return null;
  }
  if (!user.consentActive) {
    await showConsent(ctx, user.locale);
    return null;
  }
  return user;
}

export function createBot(token: string, api: BotApi, apiRoot?: string): Bot {
  const bot = new Bot(token, apiRoot ? { client: { apiRoot } } : undefined);

  bot.use(async (ctx, next) => {
    const claim = await api.claimUpdate(ctx.update.update_id);
    if (!claim.claimed) return;
    try {
      await next();
      await api.completeUpdate(ctx.update.update_id, 'PROCESSED');
    } catch (error) {
      await api.releaseUpdate(ctx.update.update_id).catch(() => undefined);
      throw error;
    }
  });

  bot.command('start', async (ctx) => {
    const user = await loadUser(ctx, api);
    if (!user?.locale)
      return ctx.reply(translate('uz-Latn', 'start.choose_language'), {
        reply_markup: languageKeyboard(),
      });
    if (!user.consentActive) return showConsent(ctx, user.locale);
    if (user.activeDraft) {
      await showMenu(ctx, user.locale, api, true);
      return continueDraft(ctx, api, user.locale, user.activeDraft);
    }
    return showMenu(ctx, user.locale, api, true);
  });

  bot.command('help', async (ctx) => {
    const user = await loadUser(ctx, api);
    const locale = user?.locale ?? normalizeLocale(ctx.from?.language_code);
    return showHelp(ctx, locale);
  });

  bot.command('language', async (ctx) => {
    const user = await loadUser(ctx, api);
    const locale = user?.locale ?? normalizeLocale(ctx.from?.language_code);
    return ctx.reply(translate(locale, 'start.choose_language'), {
      reply_markup: languageKeyboard(),
    });
  });

  bot.command('journals', async (ctx) => {
    const user = await requireConsentedUser(ctx, api);
    if (user) return showJournals(ctx, api, user.locale!, false);
  });

  bot.command('requirements', async (ctx) => {
    const user = await requireConsentedUser(ctx, api);
    if (user) return showJournals(ctx, api, user.locale!, false, true);
  });

  bot.command('submit', async (ctx) => {
    const user = await requireConsentedUser(ctx, api);
    if (user) return showJournals(ctx, api, user.locale!, true);
  });

  bot.command('drafts', async (ctx) => {
    const user = await requireConsentedUser(ctx, api);
    if (!user) return;
    if (!user.activeDraft) return ctx.reply(translate(user.locale!, 'submission.draft_empty'));
    return continueDraft(ctx, api, user.locale!, user.activeDraft);
  });

  bot.command('status', async (ctx) => {
    const user = await requireConsentedUser(ctx, api);
    if (user && ctx.from) return showSubmissions(ctx, api, user.locale!, String(ctx.from.id));
  });

  bot.command('articles', async (ctx) => {
    const user = await requireConsentedUser(ctx, api);
    if (user && ctx.from) return showSubmissions(ctx, api, user.locale!, String(ctx.from.id));
  });

  bot.command('profile', async (ctx) => {
    const user = await requireConsentedUser(ctx, api);
    if (user) return showProfile(ctx, user, user.locale!);
  });

  bot.command('cancel', async (ctx) => {
    const user = await requireConsentedUser(ctx, api);
    if (!user || !ctx.from) return;
    if (!user.activeDraft) return ctx.reply(translate(user.locale!, 'submission.draft_empty'));
    await api.cancelDraft(String(ctx.from.id), user.activeDraft.id);
    await ctx.reply(translate(user.locale!, 'submission.draft_cancelled'));
    return showMenu(ctx, user.locale!, api);
  });

  bot.callbackQuery(/^lang:(uz|ru|en)$/, async (ctx) => {
    const locale = localeCallbacks[ctx.callbackQuery.data]!;
    await api.setLocale(String(ctx.from.id), locale);
    await ctx.answerCallbackQuery();
    await showConsent(ctx, locale);
  });

  bot.callbackQuery(/^consent:(yes|no)$/, async (ctx) => {
    const user = await loadUser(ctx, api);
    const locale = user?.locale ?? normalizeLocale(ctx.from.language_code);
    const granted = ctx.callbackQuery.data.endsWith('yes');
    await api.recordConsent(String(ctx.from.id), locale, granted);
    await ctx.answerCallbackQuery();
    if (granted) return showMenu(ctx, locale, api);
    return ctx.reply(translate(locale, 'consent.short'));
  });

  bot.callbackQuery('menu:home', async (ctx) => {
    const user = await loadUser(ctx, api);
    const locale = user?.locale ?? 'uz-Latn';
    await ctx.answerCallbackQuery();
    return showMenu(ctx, locale, api);
  });

  bot.callbackQuery(/^help:(submit|files|statuses|revision|contact)$/, async (ctx) => {
    const user = await loadUser(ctx, api);
    const locale = user?.locale ?? 'uz-Latn';
    const topic = ctx.match[1]!;
    await ctx.answerCallbackQuery();
    if (topic === 'contact') return showContact(ctx, api, locale);
    const contentKey = {
      submit: 'HELP_SUBMIT',
      files: 'HELP_FILES',
      statuses: 'HELP_STATUSES',
      revision: 'HELP_REVISION',
    }[topic]!;
    const configured = (await api.getTelegramContent(locale)).content[contentKey];
    return ctx.reply(configured ?? translate(locale, `help.${topic}.text` as TranslationKey), {
      reply_markup: helpKeyboard(locale),
    });
  });

  bot.callbackQuery(/^profile-choice:(degree|title):(AUTHOR|PROFILE):([A-Z_]+)$/, async (ctx) => {
    const user = await loadUser(ctx, api);
    const locale = user?.locale ?? 'uz-Latn';
    const draft = user?.activeDraft;
    await ctx.answerCallbackQuery();
    if (!draft) return ctx.reply(translate(locale, 'error.stale_action'));
    const kind = ctx.match[1]!;
    const prefix = ctx.match[2] as 'AUTHOR' | 'PROFILE';
    const code = ctx.match[3]!;
    const expectedState = kind === 'degree' ? `${prefix}_DEGREE` : `${prefix}_ACADEMIC_TITLE`;
    if (draft.machineState !== expectedState)
      return ctx.reply(translate(locale, 'error.stale_action'));
    if (kind === 'degree') {
      if (!degreeCodes.includes(code as (typeof degreeCodes)[number]))
        return ctx.reply(translate(locale, 'error.stale_action'));
      const isOther = code === 'OTHER';
      const next = isOther
        ? `${prefix}_DEGREE_CUSTOM`
        : prefix === 'AUTHOR' || draft.context.profileSection === 'all'
          ? `${prefix}_ACADEMIC_TITLE`
          : 'PROFILE_CONFIRM';
      const updated = await api.updateDraft(
        String(ctx.from.id),
        draft,
        next,
        isOther ? 'TEXT' : 'CALLBACK',
        { degreeCode: code, degreeCustom: null },
      );
      return continueDraft(ctx, api, locale, updated);
    }
    if (!titleCodes.includes(code as (typeof titleCodes)[number]))
      return ctx.reply(translate(locale, 'error.stale_action'));
    const isOther = code === 'OTHER';
    const updated = await api.updateDraft(
      String(ctx.from.id),
      draft,
      isOther
        ? `${prefix}_TITLE_CUSTOM`
        : prefix === 'AUTHOR'
          ? 'AUTHOR_COAUTHORS'
          : 'PROFILE_CONFIRM',
      isOther || prefix === 'AUTHOR' ? 'TEXT' : 'CALLBACK',
      { titleCode: code, titleCustom: null },
    );
    return continueDraft(ctx, api, locale, updated);
  });

  bot.callbackQuery(
    /^profile:edit:(all|name|phone|email|organization|position|degree|title)$/,
    async (ctx) => {
      const user = await loadUser(ctx, api);
      const locale = user?.locale ?? 'uz-Latn';
      await ctx.answerCallbackQuery();
      if (!user?.consentActive) return showConsent(ctx, locale);
      const section = ctx.match[1] as
        'all' | 'name' | 'phone' | 'email' | 'organization' | 'position' | 'degree' | 'title';
      const draft = await api.createProfileDraft(String(ctx.from.id), section);
      return continueDraft(ctx, api, locale, draft);
    },
  );

  bot.callbackQuery(/^profile:save:([0-9a-f-]{36}):(\d+)$/, async (ctx) => {
    const user = await loadUser(ctx, api);
    const locale = user?.locale ?? 'uz-Latn';
    const draft = user?.activeDraft;
    await ctx.answerCallbackQuery();
    if (!draft || draft.id !== ctx.match[1] || draft.rowVersion !== Number(ctx.match[2]))
      return ctx.reply(translate(locale, 'error.stale_action'));
    await api.finalizeProfileDraft(String(ctx.from.id), draft);
    await ctx.reply(translate(locale, 'profile.saved'));
    return showMenu(ctx, locale, api);
  });

  bot.callbackQuery(/^journal:([0-9a-f-]{36})$/, async (ctx) => {
    const user = await loadUser(ctx, api);
    const locale = user?.locale ?? 'uz-Latn';
    const journals = await api.listJournals(locale);
    const journal = journals.find((item) => item.id === ctx.match[1]);
    await ctx.answerCallbackQuery();
    if (!journal) return ctx.reply(translate(locale, 'journal.list_empty'));
    return ctx.reply(
      `<b>${escapeTelegramHtml(journal.name)}</b>\n\n${escapeTelegramHtml(journal.description)}`,
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard()
          .text(translate(locale, 'journal.requirements'), `requirements:${journal.id}`)
          .row()
          .text(translate(locale, 'menu.contact'), `contact:journal:${journal.id}`)
          .row()
          .text(translate(locale, 'journal.submit_here'), `choose:${journal.id}`),
      },
    );
  });

  bot.callbackQuery(/^requirements:([0-9a-f-]{36})$/, async (ctx) => {
    const user = await loadUser(ctx, api);
    const locale = user?.locale ?? 'uz-Latn';
    const journals = await api.listJournals(locale);
    const journal = journals.find((item) => item.id === ctx.match[1]);
    await ctx.answerCallbackQuery();
    if (!journal?.requirements) return ctx.reply(translate(locale, 'requirements.unavailable'));
    const requirement = journal.requirements;
    return ctx.reply(
      `${translate(locale, 'requirements.version', { version: String(requirement.version) })}\n\n${requirement.title}\n\n${requirement.body || requirement.summary}`,
      {
        reply_markup: new InlineKeyboard()
          .text(translate(locale, 'journal.submit_here'), `choose:${journal.id}`)
          .row()
          .text(translate(locale, 'menu.contact'), `contact:journal:${journal.id}`)
          .row()
          .text(translate(locale, 'common.home'), 'menu:home'),
      },
    );
  });

  bot.callbackQuery(/^contact:journal:([0-9a-f-]{36})$/, async (ctx) => {
    const user = await loadUser(ctx, api);
    const locale = user?.locale ?? 'uz-Latn';
    await ctx.answerCallbackQuery();
    return showContact(ctx, api, locale, ctx.match[1]);
  });

  bot.callbackQuery(/^choose:([0-9a-f-]{36})$/, async (ctx) => {
    const user = await loadUser(ctx, api);
    const locale = user?.locale ?? 'uz-Latn';
    await ctx.answerCallbackQuery();
    if (!user?.consentActive) return showConsent(ctx, locale);
    const draft = await api.createDraft(String(ctx.from.id), ctx.match[1]);
    return continueDraft(ctx, api, locale, draft);
  });

  bot.callbackQuery(/^draft:ack:([0-9a-f-]{36}):(\d+)$/, async (ctx) => {
    const user = await loadUser(ctx, api);
    const locale = user?.locale ?? 'uz-Latn';
    const draft = user?.activeDraft;
    await ctx.answerCallbackQuery();
    if (!draft || draft.id !== ctx.match[1] || draft.rowVersion !== Number(ctx.match[2]))
      return ctx.reply(translate(locale, 'error.stale_action'));
    const hasProfile = draft.context.profileSnapshotAvailable === true;
    const updated = await api.updateDraft(
      String(ctx.from.id),
      draft,
      hasProfile ? 'PROFILE_SNAPSHOT' : 'AUTHOR_FULL_NAME',
      hasProfile ? 'CALLBACK' : 'TEXT',
      {
        requirementsAcknowledgedAt: new Date().toISOString(),
        requirementVersionId: draft.requirementVersionId,
      },
    );
    return continueDraft(ctx, api, locale, updated);
  });

  bot.callbackQuery(/^draft:profile:(confirm|edit):([0-9a-f-]{36}):(\d+)$/, async (ctx) => {
    const user = await loadUser(ctx, api);
    const locale = user?.locale ?? 'uz-Latn';
    const draft = user?.activeDraft;
    await ctx.answerCallbackQuery();
    if (!draft || draft.id !== ctx.match[2] || draft.rowVersion !== Number(ctx.match[3]))
      return ctx.reply(translate(locale, 'error.stale_action'));
    const edit = ctx.match[1] === 'edit';
    const updated = await api.updateDraft(
      String(ctx.from.id),
      draft,
      edit ? 'AUTHOR_FULL_NAME' : 'AUTHOR_COAUTHORS',
      'TEXT',
    );
    return continueDraft(ctx, api, locale, updated);
  });

  bot.callbackQuery('draft:cancel', async (ctx) => {
    const user = await loadUser(ctx, api);
    const locale = user?.locale ?? 'uz-Latn';
    await ctx.answerCallbackQuery();
    if (user?.activeDraft) await api.cancelDraft(String(ctx.from.id), user.activeDraft.id);
    await ctx.reply(translate(locale, 'submission.draft_cancelled'));
    return showMenu(ctx, locale, api);
  });

  bot.callbackQuery(/^draft:back:([0-9a-f-]{36}):(\d+)$/, async (ctx) => {
    const user = await loadUser(ctx, api);
    const locale = user?.locale ?? 'uz-Latn';
    const draft = user?.activeDraft;
    await ctx.answerCallbackQuery();
    if (!draft || draft.id !== ctx.match[1] || draft.rowVersion !== Number(ctx.match[2]))
      return ctx.reply(translate(locale, 'error.stale_action'));
    const previous = previousDraftStep(draft);
    if (!previous) return showMenu(ctx, locale, api);
    const updated = await api.updateDraft(
      String(ctx.from.id),
      draft,
      previous.machineState,
      previous.expectedInputType,
    );
    return continueDraft(ctx, api, locale, updated);
  });

  bot.callbackQuery(/^draft:replace:(\d{1,2}):([0-9a-f-]{36}):(\d+)$/, async (ctx) => {
    const user = await loadUser(ctx, api);
    const locale = user?.locale ?? 'uz-Latn';
    const draft = user?.activeDraft;
    await ctx.answerCallbackQuery();
    if (!draft || draft.id !== ctx.match[2] || draft.rowVersion !== Number(ctx.match[3]))
      return ctx.reply(translate(locale, 'error.stale_action'));
    const policy = requirementFilePolicies(draft)[Number(ctx.match[1])];
    if (!policy) return ctx.reply(translate(locale, 'error.stale_action'));
    const skipped = [...skippedFileCategories(draft)].filter(
      (category) => category !== policy.category,
    );
    const updated = await api.updateDraft(String(ctx.from.id), draft, 'FILE_ARTICLE', 'DOCUMENT', {
      activeFileCategory: policy.category,
      skippedFileCategories: skipped,
    });
    return continueDraft(ctx, api, locale, updated);
  });

  bot.callbackQuery('draft:refresh', async (ctx) => {
    const user = await loadUser(ctx, api);
    await ctx.answerCallbackQuery();
    if (!user?.activeDraft) return showMenu(ctx, user?.locale ?? 'uz-Latn', api);
    return continueDraft(ctx, api, user.locale ?? 'uz-Latn', user.activeDraft);
  });

  bot.callbackQuery(/^draft:submit:([0-9a-f-]{36}):(\d+)$/, async (ctx) => {
    const user = await loadUser(ctx, api);
    const locale = user?.locale ?? 'uz-Latn';
    const draft = user?.activeDraft;
    await ctx.answerCallbackQuery();
    if (!draft || draft.id !== ctx.match[1] || draft.rowVersion !== Number(ctx.match[2]))
      return ctx.reply(translate(locale, 'error.stale_action'));
    const submission = await api.finalizeDraft(String(ctx.from.id), draft);
    await ctx.reply(
      translate(locale, 'submission.registered', { public_id: submission.publicId }),
      {
        reply_markup: new InlineKeyboard().text(
          translate(locale, 'receipt.download'),
          `receipt:${submission.submissionId}`,
        ),
      },
    );
    return showMenu(ctx, locale, api);
  });

  bot.callbackQuery(/^revision:([0-9a-f-]{36})$/, async (ctx) => {
    const user = await loadUser(ctx, api);
    const locale = user?.locale ?? 'uz-Latn';
    await ctx.answerCallbackQuery();
    if (!user?.consentActive) return showConsent(ctx, locale);
    const draft = await api.createRevisionDraft(String(ctx.from.id), ctx.match[1]!);
    return continueDraft(ctx, api, locale, draft);
  });

  bot.callbackQuery(/^submission:([0-9a-f-]{36})$/, async (ctx) => {
    const user = await loadUser(ctx, api);
    const locale = user?.locale ?? 'uz-Latn';
    await ctx.answerCallbackQuery();
    const item = await api.getSubmission(String(ctx.from.id), ctx.match[1]!);
    const reasons = item.statusHistory
      .map((event) => event.publicReason)
      .filter((reason): reason is string => Boolean(reason));
    const messages = item.messageThread?.messages.map((message) => message.body) ?? [];
    const files = item.versions.flatMap((version) =>
      version.files.map((link) => ({ submissionVersionNo: version.versionNo, ...link })),
    );
    const details = [
      `<b>${escapeTelegramHtml(item.publicId)}</b>`,
      `${escapeTelegramHtml(translate(locale, 'admin.table.journal'))}: ${escapeTelegramHtml(item.journal.code)}`,
      `${escapeTelegramHtml(translate(locale, 'admin.table.status'))}: ${escapeTelegramHtml(translate(locale, `status.${item.status.toLowerCase()}` as TranslationKey))}`,
      `${escapeTelegramHtml(translate(locale, 'admin.table.version'))}: ${item.currentVersionNo}`,
      ...(files.length > 0
        ? [
            '',
            `<b>${escapeTelegramHtml(translate(locale, 'file.list'))}</b>`,
            ...files.map(
              (link) =>
                `📎 ${escapeTelegramHtml(translate(locale, 'file.version', { version: `${link.submissionVersionNo}.${link.versionNo}` }))} · ${escapeTelegramHtml(submissionFileLabel(locale, item.requirementVersion.config, link.category))} · ${escapeTelegramHtml(link.file.originalName)}`,
            ),
          ]
        : []),
      ...reasons.map((reason) => `• ${escapeTelegramHtml(reason)}`),
      ...messages.map((message) => `💬 ${escapeTelegramHtml(message)}`),
    ];
    const keyboard = new InlineKeyboard();
    keyboard.text(translate(locale, 'receipt.download'), `receipt:${item.id}`).row();
    for (const link of files) {
      if (link.file.scanStatus === 'CLEAN' && link.file.storageStatus === 'STORED')
        keyboard
          .text(
            `${translate(locale, 'file.download')} · ${link.file.originalName}`,
            `file:${link.file.id}`,
          )
          .row();
    }
    return ctx.reply(details.join('\n'), {
      parse_mode: 'HTML',
      ...(keyboard.inline_keyboard.length > 0 ? { reply_markup: keyboard } : {}),
    });
  });

  bot.callbackQuery(/^file:([0-9a-f-]{36})$/, async (ctx) => {
    const user = await loadUser(ctx, api);
    const locale = user?.locale ?? 'uz-Latn';
    await ctx.answerCallbackQuery();
    const result = await api.getSubmissionFileUrl(String(ctx.from.id), ctx.match[1]!);
    const keyboard = new InlineKeyboard().url(translate(locale, 'file.download'), result.url);
    return ctx.reply(
      translate(locale, 'file.download_ready', {
        minutes: String(Math.max(1, Math.ceil(result.expiresInSeconds / 60))),
      }),
      { reply_markup: keyboard },
    );
  });

  bot.callbackQuery(/^receipt:([0-9a-f-]{36})$/, async (ctx) => {
    const user = await loadUser(ctx, api);
    const locale = user?.locale ?? 'uz-Latn';
    await ctx.answerCallbackQuery();
    const result = await api.getSubmissionReceipt(String(ctx.from.id), ctx.match[1]!);
    if (result.status === 'FAILED') return ctx.reply(translate(locale, 'receipt.failed'));
    if (result.status !== 'READY' || !result.url || !result.expiresInSeconds)
      return ctx.reply(translate(locale, 'receipt.pending'));
    return ctx.reply(
      translate(locale, 'receipt.ready', {
        minutes: String(Math.max(1, Math.ceil(result.expiresInSeconds / 60))),
      }),
      {
        reply_markup: new InlineKeyboard().url(translate(locale, 'receipt.download'), result.url),
      },
    );
  });

  bot.on('message:document', async (ctx) => {
    const user = await loadUser(ctx, api);
    const locale = user?.locale ?? 'uz-Latn';
    const draft = user?.activeDraft;
    if (!draft || draft.machineState !== 'FILE_ARTICLE')
      return ctx.reply(statePrompt(locale, draft?.machineState ?? 'MAIN_MENU', draft ?? undefined));
    const policy = currentFilePolicy(draft);
    if (!policy) return ctx.reply(translate(locale, 'error.file_set_incomplete'));
    const document = ctx.message.document;
    const fileName = document.file_name ?? '';
    const extension = /\.([a-z0-9]{1,16})$/i.exec(fileName)?.[1]?.toLowerCase();
    const allowedFormats = policy.formats.map((format) => format.toUpperCase()).join(', ');
    if (!extension || !policy.formats.includes(extension as 'docx' | 'pdf'))
      return ctx.reply(translate(locale, 'error.file_format', { allowed_formats: allowedFormats }));
    const maximum = fileLimit(draft, policy);
    if ((document.file_size ?? 0) > maximum)
      return ctx.reply(
        translate(locale, 'error.file_size', {
          max_size: `${Math.floor(maximum / 1024 / 1024)} MiB`,
        }),
      );
    const updated = await api.attachTelegramFile(String(ctx.from.id), draft, {
      fileId: document.file_id,
      fileUniqueId: document.file_unique_id,
      fileName,
      ...(document.mime_type ? { declaredMime: document.mime_type } : {}),
      sizeBytes: document.file_size ?? 0,
      category: policy.category,
    });
    return continueDraft(ctx, api, locale, updated);
  });

  bot.on('message:text', async (ctx) => {
    const user = await loadUser(ctx, api);
    if (!user?.locale)
      return ctx.reply(translate('uz-Latn', 'start.choose_language'), {
        reply_markup: languageKeyboard(),
      });
    const locale = user.locale;
    const text = ctx.message.text.trim();
    if (text === translate(locale, 'menu.language'))
      return ctx.reply(translate(locale, 'start.choose_language'), {
        reply_markup: languageKeyboard(),
      });
    if (text === translate(locale, 'common.home')) return showMenu(ctx, locale, api);
    if (text === translate(locale, 'menu.journals')) return showJournals(ctx, api, locale);
    if (text === translate(locale, 'journal.requirements'))
      return showJournals(ctx, api, locale, false, true);
    if (text === translate(locale, 'menu.submit_article'))
      return showJournals(ctx, api, locale, true);
    if (text === translate(locale, 'menu.help')) return showHelp(ctx, locale);
    if (text === translate(locale, 'menu.contact')) return showContact(ctx, api, locale);
    if (text === translate(locale, 'menu.my_articles')) {
      return showSubmissions(ctx, api, locale, String(ctx.from.id));
    }
    if (text === translate(locale, 'menu.notifications')) {
      return showNotifications(ctx, api, locale, String(ctx.from.id));
    }
    if (text === translate(locale, 'menu.profile')) {
      return showProfile(ctx, user, locale);
    }
    if (text === translate(locale, 'common.back')) {
      const draft = user.activeDraft;
      if (!draft) return showMenu(ctx, locale, api);
      const previous = previousDraftStep(draft);
      if (!previous) return showMenu(ctx, locale, api);
      const updated = await api.updateDraft(
        String(ctx.from.id),
        draft,
        previous.machineState,
        previous.expectedInputType,
      );
      return continueDraft(ctx, api, locale, updated);
    }
    if (text === translate(locale, 'common.cancel')) {
      if (user.activeDraft) await api.cancelDraft(String(ctx.from.id), user.activeDraft.id);
      await ctx.reply(translate(locale, 'submission.draft_cancelled'));
      return showMenu(ctx, locale, api);
    }
    if (text === translate(locale, 'common.save_draft')) {
      await ctx.reply(translate(locale, 'submission.draft_saved'));
      return showMenu(ctx, locale, api);
    }
    const draft = user.activeDraft;
    if (draft?.machineState === 'FILE_ARTICLE' && text === translate(locale, 'common.skip')) {
      const policy = currentFilePolicy(draft);
      if (!policy || policy.required)
        return ctx.reply(translate(locale, 'error.file_set_incomplete'));
      const pending = await api.updateDraft(
        String(ctx.from.id),
        draft,
        'FILE_ARTICLE',
        'DOCUMENT',
        {
          activeFileCategory: null,
          skippedFileCategories: [...skippedFileCategories(draft), policy.category],
        },
      );
      if (currentFilePolicy(pending)) return continueDraft(ctx, api, locale, pending);
      const previewDraft = await api.updateDraft(
        String(ctx.from.id),
        pending,
        'PREVIEW',
        'CALLBACK',
      );
      return continueDraft(ctx, api, locale, previewDraft);
    }
    const profileField = draft && profileTextFields[draft.machineState];
    const nextProfile = draft && profileField ? nextProfileState(draft) : null;
    const step =
      draft && profileField
        ? {
            field: profileField,
            next: nextProfile!,
            expected: ['PROFILE_CONFIRM', 'PROFILE_DEGREE', 'PROFILE_ACADEMIC_TITLE'].includes(
              nextProfile!,
            )
              ? 'CALLBACK'
              : 'TEXT',
          }
        : draft && textSteps[draft.machineState];
    if (!draft || !step) return showMenu(ctx, locale, api);
    if (step.field === 'email' && !emailPattern.test(text))
      return ctx.reply(translate(locale, 'validation.email'));
    if (step.field === 'phone' && !phonePattern.test(text))
      return ctx.reply(translate(locale, 'validation.phone'));
    if (text.length > 10_000)
      return ctx.reply(translate(locale, 'validation.required', { field: step.field }));
    if (step.field === 'abstract') {
      const metadata = requirementMetadataPolicy(draft);
      if (!metadata) return ctx.reply(translate(locale, 'error.file_set_incomplete'));
      const words = text.trim().split(/\s+/u).length;
      if (words < metadata.abstractMinWords || words > metadata.abstractMaxWords) {
        return ctx.reply(statePrompt(locale, draft.machineState, draft));
      }
    }
    if (step.field === 'keywords') {
      const metadata = requirementMetadataPolicy(draft);
      if (!metadata) return ctx.reply(translate(locale, 'error.file_set_incomplete'));
      const count = text
        .split(/[,;\n]/)
        .map((item) => item.trim())
        .filter(Boolean).length;
      if (count < metadata.keywordMinCount || count > metadata.keywordMaxCount) {
        return ctx.reply(statePrompt(locale, draft.machineState, draft));
      }
    }
    if (step.field === 'coauthors' && text !== '-') {
      const metadata = requirementMetadataPolicy(draft);
      if (!metadata) return ctx.reply(translate(locale, 'error.file_set_incomplete'));
      const count = text.split('\n').filter((line) => line.trim().length > 0).length;
      if (count > metadata.coauthorMaxCount) {
        return ctx.reply(translate(locale, 'validation.coauthor_policy'));
      }
    }
    let normalizedText = text;
    if (step.field === 'articleLanguage') {
      const languageChoices = [
        ['uz-Latn', translate(locale, 'language.uz')],
        ['ru', translate(locale, 'language.ru')],
        ['en', translate(locale, 'language.en')],
      ] as const;
      const choice = languageChoices.find(([, label]) => label === text);
      if (!choice) return ctx.reply(translate(locale, 'validation.article_language'));
      normalizedText = choice[0];
    }
    const updated = await api.updateDraft(String(ctx.from.id), draft, step.next, step.expected, {
      [step.field]: normalizedText,
    });
    return continueDraft(ctx, api, locale, updated);
  });

  bot.catch(async ({ error, ctx }) => {
    const reference = crypto.randomUUID();
    let locale = resolveUserLocale(undefined, ctx.from?.language_code);
    try {
      locale = resolveUserLocale((await loadUser(ctx, api))?.locale, ctx.from?.language_code);
    } catch {
      // The original failure may be an API outage; keep the Telegram locale as a safe fallback.
    }
    if (error instanceof HmqaApiError) {
      const key: TranslationKey = [
        'FILE_NOT_READY',
        'REQUIRED_FILE_MISSING',
        'REQUIREMENT_CONFIG_INVALID',
      ].includes(error.code)
        ? 'error.file_set_incomplete'
        : error.code === 'ACTIVE_DRAFT_CONFLICT'
          ? 'profile.active_draft_conflict'
          : error.code === 'ABSTRACT_WORD_COUNT_INVALID'
            ? 'validation.abstract_policy'
            : error.code === 'KEYWORDS_COUNT_INVALID'
              ? 'validation.keyword_policy'
              : error.code === 'COAUTHOR_LIMIT'
                ? 'validation.coauthor_policy'
                : 'error.system';
      await ctx.reply(translate(locale, key, { correlation_id: reference })).catch(() => undefined);
      return;
    }
    Sentry.captureException(error, {
      tags: {
        service: 'bot',
        correlationId: reference,
        updateType: ctx.update.message ? 'message' : 'callback_query',
      },
    });
    await ctx
      .reply(translate(locale, 'error.system', { correlation_id: reference }))
      .catch(() => undefined);
  });
  return bot;
}
