import {
  escapeTelegramHtml,
  normalizeLocale,
  translate,
  type Locale,
  type TranslationKey,
} from '@hmqa/i18n';
import {
  journalRequirementConfigSchema,
  orcidSchema,
  type JournalMetadataPolicy,
  type JournalRequirementFilePolicy,
} from '@hmqa/contracts';
import { Bot, InlineKeyboard, Keyboard, type Context } from 'grammy';
import { maskEmail, maskPhone } from '@hmqa/security';
import * as Sentry from '@sentry/node';
import { HmqaApiError, type DraftState, type HmqaApiClient, type UserState } from './api-client.js';

export type BotApi = Pick<
  HmqaApiClient,
  | 'claimUpdate'
  | 'completeUpdate'
  | 'releaseUpdate'
  | 'syncUser'
  | 'setLocale'
  | 'createProfileDraft'
  | 'finalizeProfileDraft'
  | 'recordConsent'
  | 'listConsents'
  | 'listPrivacyRequests'
  | 'createPrivacyRequest'
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

export function mainMenu(locale: Locale) {
  return new Keyboard()
    .text(translate(locale, 'menu.submit_article'))
    .text(translate(locale, 'menu.journals'))
    .row()
    .text(translate(locale, 'menu.my_articles'))
    .text(translate(locale, 'menu.notifications'))
    .row()
    .text(translate(locale, 'menu.profile'))
    .text(translate(locale, 'menu.help'))
    .row()
    .text(translate(locale, 'menu.contact'))
    .text(translate(locale, 'menu.language'))
    .resized()
    .persistent();
}

export function botCommands(locale: Locale) {
  return [
    { command: 'start', description: translate(locale, 'bot.command.start') },
    { command: 'help', description: translate(locale, 'bot.command.help') },
    { command: 'journals', description: translate(locale, 'bot.command.journals') },
    { command: 'submit', description: translate(locale, 'bot.command.submit') },
    { command: 'drafts', description: translate(locale, 'bot.command.drafts') },
    { command: 'status', description: translate(locale, 'bot.command.status') },
    { command: 'profile', description: translate(locale, 'bot.command.profile') },
    { command: 'language', description: translate(locale, 'bot.command.language') },
    { command: 'cancel', description: translate(locale, 'bot.command.cancel') },
    { command: 'privacy', description: translate(locale, 'bot.command.privacy') },
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
    AUTHOR_LAST_NAME: 'author.last_name',
    AUTHOR_FIRST_NAME: 'author.first_name',
    AUTHOR_MIDDLE_NAME: 'author.middle_name',
    AUTHOR_PHONE: 'author.phone',
    AUTHOR_EMAIL: 'author.email',
    AUTHOR_ORGANIZATION: 'author.organization',
    AUTHOR_POSITION: 'author.position',
    AUTHOR_DEGREE: 'author.degree',
    AUTHOR_ACADEMIC_TITLE: 'author.academic_title',
    AUTHOR_COUNTRY: 'author.country',
    AUTHOR_CITY: 'author.city',
    AUTHOR_ORCID: 'author.orcid',
    AUTHOR_COAUTHORS: 'author.coauthors',
    PROFILE_LAST_NAME: 'author.last_name',
    PROFILE_FIRST_NAME: 'author.first_name',
    PROFILE_MIDDLE_NAME: 'author.middle_name',
    PROFILE_PHONE: 'author.phone',
    PROFILE_EMAIL: 'author.email',
    PROFILE_ORGANIZATION: 'author.organization',
    PROFILE_POSITION: 'author.position',
    PROFILE_DEGREE: 'author.degree',
    PROFILE_ACADEMIC_TITLE: 'author.academic_title',
    PROFILE_COUNTRY: 'author.country',
    PROFILE_CITY: 'author.city',
    PROFILE_ORCID: 'author.orcid',
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

async function showMenu(ctx: Context, locale: Locale) {
  await ctx.reply(translate(locale, 'menu.title'), { reply_markup: mainMenu(locale) });
}

async function showJournals(ctx: Context, api: BotApi, locale: Locale, forSubmission = false) {
  const journals = await api.listJournals(locale);
  if (journals.length === 0) return ctx.reply(translate(locale, 'journal.list_empty'));
  const keyboard = new InlineKeyboard();
  for (const journal of journals)
    keyboard.text(journal.name, `${forSubmission ? 'choose' : 'journal'}:${journal.id}`).row();
  return ctx.reply(
    forSubmission ? translate(locale, 'menu.submit_article') : translate(locale, 'menu.journals'),
    { reply_markup: keyboard },
  );
}

function preview(locale: Locale, draft: DraftState): string {
  const value = draft.context;
  const text = (input: unknown): string =>
    typeof input === 'string' || typeof input === 'number' ? String(input) : '';
  const optional = (input: unknown): string => {
    const result = text(input);
    return !result || result === '-' ? translate(locale, 'common.not_specified') : result;
  };
  const authorName = [value.lastName, value.firstName, value.middleName]
    .map(text)
    .filter((part) => part && part !== '-')
    .join(' ');
  const fields = [
    [translate(locale, 'submission.preview.author'), authorName],
    [translate(locale, 'submission.preview.phone'), maskPhone(text(value.phone))],
    [translate(locale, 'submission.preview.email'), maskEmail(text(value.email))],
    [translate(locale, 'submission.preview.organization'), text(value.organization)],
    [translate(locale, 'submission.preview.position'), text(value.position)],
    [translate(locale, 'submission.preview.degree'), optional(value.degree)],
    [translate(locale, 'submission.preview.academic_title'), optional(value.academicTitle)],
    [translate(locale, 'submission.preview.country'), optional(value.country)],
    [translate(locale, 'submission.preview.city'), optional(value.city)],
    [translate(locale, 'submission.preview.orcid'), optional(value.orcid)],
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
  const optional = (input: unknown): string => {
    const result = text(input);
    return !result || result === '-' ? translate(locale, 'common.not_specified') : result;
  };
  const fields = [
    [
      translate(locale, 'submission.preview.author'),
      [value.lastName, value.firstName, value.middleName]
        .map(text)
        .filter((part) => part && part !== '-')
        .join(' '),
    ],
    [translate(locale, 'submission.preview.phone'), maskPhone(text(value.phone))],
    [translate(locale, 'submission.preview.email'), maskEmail(text(value.email))],
    [translate(locale, 'submission.preview.organization'), text(value.organization)],
    [translate(locale, 'submission.preview.position'), text(value.position)],
    [translate(locale, 'submission.preview.degree'), optional(value.degree)],
    [translate(locale, 'submission.preview.academic_title'), optional(value.academicTitle)],
    [translate(locale, 'submission.preview.country'), optional(value.country)],
    [translate(locale, 'submission.preview.city'), optional(value.city)],
    [translate(locale, 'submission.preview.orcid'), optional(value.orcid)],
  ];
  return `${escapeTelegramHtml(translate(locale, heading))}\n\n${fields
    .map(
      ([name, fieldValue]) =>
        `<b>${escapeTelegramHtml(name!)}</b>: ${escapeTelegramHtml(fieldValue!)}`,
    )
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
      reply_markup: new InlineKeyboard()
        .text(
          translate(locale, 'profile.use_snapshot'),
          `draft:profile:confirm:${draft.id}:${draft.rowVersion}`,
        )
        .row()
        .text(
          translate(locale, 'profile.edit_for_submission'),
          `draft:profile:edit:${draft.id}:${draft.rowVersion}`,
        ),
    });
  }
  if (draft.machineState === 'PROFILE_CONFIRM') {
    return ctx.reply(profilePreview(locale, draft), {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard()
        .text(translate(locale, 'profile.save'), `profile:save:${draft.id}:${draft.rowVersion}`)
        .row()
        .text(translate(locale, 'common.cancel'), 'draft:cancel'),
    });
  }
  if (draft.machineState === 'REQUIREMENTS_ACK') {
    const requirement = draft.journal?.currentRequirement;
    const localization = requirement?.localizations[0];
    const text = `${localization?.title ?? draft.journal?.code ?? ''}\n\n${localization?.summary ?? localization?.body ?? ''}\n\n${translate(locale, 'requirements.ack', { requirements_version: requirement?.version ?? '?', journal_name: draft.journal?.localizations[0]?.name ?? draft.journal?.code ?? '?' })}`;
    return ctx.reply(text, {
      reply_markup: new InlineKeyboard()
        .text(translate(locale, 'common.confirm'), `draft:ack:${draft.id}:${draft.rowVersion}`)
        .row()
        .text(translate(locale, 'common.cancel'), 'draft:cancel'),
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
      .text(translate(locale, 'common.cancel'));
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
    return ctx.reply(preview(locale, draft), {
      parse_mode: 'HTML',
      reply_markup: keyboard,
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
        .resized(),
    });
  }
  return ctx.reply(statePrompt(locale, draft.machineState, draft), {
    reply_markup: new Keyboard()
      .text(translate(locale, 'common.save_draft'))
      .text(translate(locale, 'common.cancel'))
      .resized(),
  });
}

const textSteps: Readonly<Record<string, { field: string; next: string; expected: string }>> = {
  AUTHOR_LAST_NAME: { field: 'lastName', next: 'AUTHOR_FIRST_NAME', expected: 'TEXT' },
  AUTHOR_FIRST_NAME: { field: 'firstName', next: 'AUTHOR_MIDDLE_NAME', expected: 'TEXT' },
  AUTHOR_MIDDLE_NAME: { field: 'middleName', next: 'AUTHOR_PHONE', expected: 'TEXT' },
  AUTHOR_PHONE: { field: 'phone', next: 'AUTHOR_EMAIL', expected: 'TEXT' },
  AUTHOR_EMAIL: { field: 'email', next: 'AUTHOR_ORGANIZATION', expected: 'TEXT' },
  AUTHOR_ORGANIZATION: { field: 'organization', next: 'AUTHOR_POSITION', expected: 'TEXT' },
  AUTHOR_POSITION: { field: 'position', next: 'AUTHOR_DEGREE', expected: 'TEXT' },
  AUTHOR_DEGREE: { field: 'degree', next: 'AUTHOR_ACADEMIC_TITLE', expected: 'TEXT' },
  AUTHOR_ACADEMIC_TITLE: { field: 'academicTitle', next: 'AUTHOR_COUNTRY', expected: 'TEXT' },
  AUTHOR_COUNTRY: { field: 'country', next: 'AUTHOR_CITY', expected: 'TEXT' },
  AUTHOR_CITY: { field: 'city', next: 'AUTHOR_ORCID', expected: 'TEXT' },
  AUTHOR_ORCID: { field: 'orcid', next: 'AUTHOR_COAUTHORS', expected: 'TEXT' },
  AUTHOR_COAUTHORS: { field: 'coauthors', next: 'ARTICLE_TITLE', expected: 'TEXT' },
  ARTICLE_TITLE: { field: 'articleTitle', next: 'ARTICLE_TYPE', expected: 'TEXT' },
  ARTICLE_TYPE: { field: 'articleType', next: 'ARTICLE_LANGUAGE', expected: 'TEXT' },
  ARTICLE_LANGUAGE: { field: 'articleLanguage', next: 'ARTICLE_SECTION', expected: 'TEXT' },
  ARTICLE_SECTION: { field: 'articleSection', next: 'ARTICLE_ABSTRACT', expected: 'TEXT' },
  ARTICLE_ABSTRACT: { field: 'abstract', next: 'ARTICLE_KEYWORDS', expected: 'TEXT' },
  ARTICLE_KEYWORDS: { field: 'keywords', next: 'FILE_ARTICLE', expected: 'DOCUMENT' },
};

const profileTextFields: Readonly<Record<string, string>> = {
  PROFILE_LAST_NAME: 'lastName',
  PROFILE_FIRST_NAME: 'firstName',
  PROFILE_MIDDLE_NAME: 'middleName',
  PROFILE_PHONE: 'phone',
  PROFILE_EMAIL: 'email',
  PROFILE_ORGANIZATION: 'organization',
  PROFILE_POSITION: 'position',
  PROFILE_DEGREE: 'degree',
  PROFILE_ACADEMIC_TITLE: 'academicTitle',
  PROFILE_COUNTRY: 'country',
  PROFILE_CITY: 'city',
  PROFILE_ORCID: 'orcid',
};

function nextProfileState(draft: DraftState): string {
  const section = draft.context.profileSection;
  const all = section === 'all';
  const transitions: Readonly<Record<string, string>> = {
    PROFILE_LAST_NAME: 'PROFILE_FIRST_NAME',
    PROFILE_FIRST_NAME: 'PROFILE_MIDDLE_NAME',
    PROFILE_MIDDLE_NAME: all ? 'PROFILE_PHONE' : 'PROFILE_CONFIRM',
    PROFILE_PHONE: all ? 'PROFILE_EMAIL' : 'PROFILE_CONFIRM',
    PROFILE_EMAIL: all ? 'PROFILE_ORGANIZATION' : 'PROFILE_CONFIRM',
    PROFILE_ORGANIZATION: 'PROFILE_POSITION',
    PROFILE_POSITION: 'PROFILE_COUNTRY',
    PROFILE_COUNTRY: 'PROFILE_CITY',
    PROFILE_CITY: all ? 'PROFILE_DEGREE' : 'PROFILE_CONFIRM',
    PROFILE_DEGREE: 'PROFILE_ACADEMIC_TITLE',
    PROFILE_ACADEMIC_TITLE: 'PROFILE_ORCID',
    PROFILE_ORCID: 'PROFILE_CONFIRM',
  };
  return transitions[draft.machineState] ?? 'PROFILE_CONFIRM';
}

function profileKeyboard(locale: Locale, hasProfile: boolean): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (!hasProfile) keyboard.text(translate(locale, 'profile.create'), 'profile:edit:all').row();
  else
    keyboard
      .text(translate(locale, 'profile.edit_all'), 'profile:edit:all')
      .row()
      .text(translate(locale, 'profile.edit_name'), 'profile:edit:name')
      .row()
      .text(translate(locale, 'profile.edit_phone'), 'profile:edit:phone')
      .row()
      .text(translate(locale, 'profile.edit_email'), 'profile:edit:email')
      .row()
      .text(translate(locale, 'profile.edit_work'), 'profile:edit:work')
      .row()
      .text(translate(locale, 'profile.edit_academic'), 'profile:edit:academic')
      .row();
  return keyboard
    .text(translate(locale, 'profile.consent_history'), 'profile:consents')
    .row()
    .text(translate(locale, 'profile.data_export_request'), 'privacy:create:ACCESS')
    .row()
    .text(translate(locale, 'profile.erasure_request'), 'privacy:confirm:ERASURE')
    .row()
    .text(translate(locale, 'profile.privacy_requests'), 'privacy:list');
}

function privacyKeyboard(locale: Locale): InlineKeyboard {
  return new InlineKeyboard()
    .text(translate(locale, 'profile.consent_history'), 'profile:consents')
    .row()
    .text(translate(locale, 'profile.data_export_request'), 'privacy:create:ACCESS')
    .row()
    .text(translate(locale, 'profile.erasure_request'), 'privacy:confirm:ERASURE')
    .row()
    .text(translate(locale, 'profile.privacy_requests'), 'privacy:list');
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
  const optional = (value: string | null): string =>
    value ?? translate(locale, 'common.not_specified');
  return ctx.reply(
    profile
      ? [
          `${translate(locale, 'submission.preview.author')}: ${[profile.lastName, profile.firstName, profile.middleName].filter(Boolean).join(' ')}`,
          `${translate(locale, 'submission.preview.phone')}: ${profile.phone}`,
          `${translate(locale, 'submission.preview.email')}: ${profile.email}`,
          `${translate(locale, 'submission.preview.organization')}: ${profile.organization}`,
          `${translate(locale, 'submission.preview.position')}: ${profile.position}`,
          `${translate(locale, 'submission.preview.degree')}: ${optional(profile.degree)}`,
          `${translate(locale, 'submission.preview.academic_title')}: ${optional(profile.academicTitle)}`,
          `${translate(locale, 'submission.preview.country')}: ${optional(profile.country)}`,
          `${translate(locale, 'submission.preview.city')}: ${optional(profile.city)}`,
          `${translate(locale, 'submission.preview.orcid')}: ${optional(profile.orcid)}`,
          `${translate(locale, 'profile.interface_language')}: ${translate(locale, `language.${locale === 'uz-Latn' ? 'uz' : locale}` as TranslationKey)}`,
          `${translate(locale, 'profile.updated_at')}: ${profile.updatedAt.toLocaleString(locale)}`,
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
      await showMenu(ctx, user.locale);
      return continueDraft(ctx, api, user.locale, user.activeDraft);
    }
    return showMenu(ctx, user.locale);
  });

  bot.command('help', async (ctx) => {
    const user = await loadUser(ctx, api);
    const locale = user?.locale ?? normalizeLocale(ctx.from?.language_code);
    return ctx.reply(translate(locale, 'help.summary'));
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

  bot.command('profile', async (ctx) => {
    const user = await requireConsentedUser(ctx, api);
    if (user) return showProfile(ctx, user, user.locale!);
  });

  bot.command('privacy', async (ctx) => {
    const user = await requireConsentedUser(ctx, api);
    if (user)
      return ctx.reply(translate(user.locale!, 'privacy.menu'), {
        reply_markup: privacyKeyboard(user.locale!),
      });
  });

  bot.command('cancel', async (ctx) => {
    const user = await requireConsentedUser(ctx, api);
    if (!user || !ctx.from) return;
    if (!user.activeDraft) return ctx.reply(translate(user.locale!, 'submission.draft_empty'));
    await api.cancelDraft(String(ctx.from.id), user.activeDraft.id);
    await ctx.reply(translate(user.locale!, 'submission.draft_cancelled'));
    return showMenu(ctx, user.locale!);
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
    if (granted) return showMenu(ctx, locale);
    return ctx.reply(translate(locale, 'consent.short'));
  });

  bot.callbackQuery(/^profile:edit:(all|name|phone|email|work|academic)$/, async (ctx) => {
    const user = await loadUser(ctx, api);
    const locale = user?.locale ?? 'uz-Latn';
    await ctx.answerCallbackQuery();
    if (!user?.consentActive) return showConsent(ctx, locale);
    const section = ctx.match[1] as 'all' | 'name' | 'phone' | 'email' | 'work' | 'academic';
    const draft = await api.createProfileDraft(String(ctx.from.id), section);
    return continueDraft(ctx, api, locale, draft);
  });

  bot.callbackQuery(/^profile:save:([0-9a-f-]{36}):(\d+)$/, async (ctx) => {
    const user = await loadUser(ctx, api);
    const locale = user?.locale ?? 'uz-Latn';
    const draft = user?.activeDraft;
    await ctx.answerCallbackQuery();
    if (!draft || draft.id !== ctx.match[1] || draft.rowVersion !== Number(ctx.match[2]))
      return ctx.reply(translate(locale, 'error.stale_action'));
    await api.finalizeProfileDraft(String(ctx.from.id), draft);
    await ctx.reply(translate(locale, 'profile.saved'));
    return showMenu(ctx, locale);
  });

  bot.callbackQuery('profile:consents', async (ctx) => {
    const user = await loadUser(ctx, api);
    const locale = user?.locale ?? 'uz-Latn';
    await ctx.answerCallbackQuery();
    const result = await api.listConsents(String(ctx.from.id));
    if (result.items.length === 0) return ctx.reply(translate(locale, 'consent.history.empty'));
    return ctx.reply(
      result.items
        .map((item) =>
          translate(locale, 'consent.history.item', {
            policy_version: item.policyVersion,
            scope: item.scope,
            status: translate(
              locale,
              item.granted && !item.revokedAt ? 'consent.status.granted' : 'consent.status.revoked',
            ),
            date: item.grantedAt.toLocaleDateString(locale),
          }),
        )
        .join('\n'),
    );
  });

  bot.callbackQuery('privacy:confirm:ERASURE', async (ctx) => {
    const user = await loadUser(ctx, api);
    const locale = user?.locale ?? 'uz-Latn';
    await ctx.answerCallbackQuery();
    return ctx.reply(translate(locale, 'privacy.erasure_warning'), {
      reply_markup: new InlineKeyboard()
        .text(translate(locale, 'privacy.erasure_confirm'), 'privacy:create:ERASURE')
        .row()
        .text(translate(locale, 'common.cancel'), 'privacy:list'),
    });
  });

  bot.callbackQuery(/^privacy:create:(ACCESS|ERASURE)$/, async (ctx) => {
    const user = await loadUser(ctx, api);
    const locale = user?.locale ?? 'uz-Latn';
    await ctx.answerCallbackQuery();
    const item = await api.createPrivacyRequest(
      String(ctx.from.id),
      ctx.match[1] as 'ACCESS' | 'ERASURE',
    );
    return ctx.reply(
      translate(locale, item.created ? 'privacy.request.received' : 'privacy.request.existing', {
        public_id: item.publicId,
      }),
    );
  });

  bot.callbackQuery('privacy:list', async (ctx) => {
    const user = await loadUser(ctx, api);
    const locale = user?.locale ?? 'uz-Latn';
    await ctx.answerCallbackQuery();
    const result = await api.listPrivacyRequests(String(ctx.from.id));
    if (result.items.length === 0) return ctx.reply(translate(locale, 'privacy.request.empty'));
    return ctx.reply(
      result.items
        .map((item) =>
          translate(locale, 'privacy.request.item', {
            public_id: item.publicId,
            type: translate(locale, `privacy.type.${item.type.toLowerCase()}` as TranslationKey),
            status: translate(
              locale,
              `privacy.status.${item.status.toLowerCase()}` as TranslationKey,
            ),
            due_at: item.dueAt.toLocaleDateString(locale),
          }),
        )
        .join('\n'),
    );
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
        reply_markup: new InlineKeyboard().text(
          translate(locale, 'journal.submit_here'),
          `choose:${journal.id}`,
        ),
      },
    );
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
      hasProfile ? 'PROFILE_SNAPSHOT' : 'AUTHOR_LAST_NAME',
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
      edit ? 'AUTHOR_LAST_NAME' : 'AUTHOR_COAUTHORS',
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
    return showMenu(ctx, locale);
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
    if (!user?.activeDraft) return showMenu(ctx, user?.locale ?? 'uz-Latn');
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
    return showMenu(ctx, locale);
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
    if (text === translate(locale, 'menu.journals')) return showJournals(ctx, api, locale);
    if (text === translate(locale, 'menu.submit_article'))
      return showJournals(ctx, api, locale, true);
    if (text === translate(locale, 'menu.help'))
      return ctx.reply(translate(locale, 'help.summary'));
    if (text === translate(locale, 'menu.contact'))
      return ctx.reply(translate(locale, 'contact.summary'));
    if (text === translate(locale, 'menu.my_articles')) {
      return showSubmissions(ctx, api, locale, String(ctx.from.id));
    }
    if (text === translate(locale, 'menu.notifications')) {
      return showNotifications(ctx, api, locale, String(ctx.from.id));
    }
    if (text === translate(locale, 'menu.profile')) {
      return showProfile(ctx, user, locale);
    }
    if (text === translate(locale, 'common.cancel')) {
      if (user.activeDraft) await api.cancelDraft(String(ctx.from.id), user.activeDraft.id);
      await ctx.reply(translate(locale, 'submission.draft_cancelled'));
      return showMenu(ctx, locale);
    }
    if (text === translate(locale, 'common.save_draft')) {
      await ctx.reply(translate(locale, 'submission.draft_saved'));
      return showMenu(ctx, locale);
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
    const step =
      draft && profileField
        ? {
            field: profileField,
            next: nextProfileState(draft),
            expected: nextProfileState(draft) === 'PROFILE_CONFIRM' ? 'CALLBACK' : 'TEXT',
          }
        : draft && textSteps[draft.machineState];
    if (!draft || !step) return showMenu(ctx, locale);
    if (step.field === 'email' && !emailPattern.test(text))
      return ctx.reply(translate(locale, 'validation.email'));
    if (step.field === 'phone' && !phonePattern.test(text))
      return ctx.reply(translate(locale, 'validation.phone'));
    if (step.field === 'orcid' && text !== '-' && !orcidSchema.safeParse(text).success)
      return ctx.reply(translate(locale, 'validation.orcid'));
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
