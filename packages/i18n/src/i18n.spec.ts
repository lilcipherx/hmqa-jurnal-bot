import { describe, expect, it } from 'vitest';
import {
  escapeTelegramHtml,
  getBundle,
  normalizeLocale,
  placeholders,
  supportedLocales,
  translate,
  type TranslationKey,
} from './translator.js';

describe('i18n production gates', () => {
  it('has identical non-empty keys in all required locales', () => {
    const baseline = Object.keys(getBundle('uz-Latn')).sort();
    for (const locale of supportedLocales) {
      const bundle = getBundle(locale);
      expect(Object.keys(bundle).sort()).toEqual(baseline);
      for (const key of baseline) expect(bundle[key as TranslationKey].trim()).not.toBe('');
    }
  });

  it('has placeholder parity for every key', () => {
    for (const key of Object.keys(getBundle('uz-Latn')) as TranslationKey[]) {
      const expected = placeholders(getBundle('uz-Latn')[key]);
      expect(placeholders(getBundle('ru')[key]), key).toEqual(expected);
      expect(placeholders(getBundle('en')[key]), key).toEqual(expected);
    }
  });

  it('distinguishes submitted from accepted in every locale', () => {
    for (const locale of supportedLocales) {
      expect(translate(locale, 'status.submitted')).not.toBe(translate(locale, 'status.accepted'));
      expect(
        translate(locale, 'notification.submitted', { public_id: 'HMQA-AXB-2026-000001' }),
      ).not.toBe(translate(locale, 'notification.accepted', { public_id: 'HMQA-AXB-2026-000001' }));
    }
  });

  it('normalizes only supported locale codes', () => {
    expect(normalizeLocale('uz_UZ')).toBe('uz-Latn');
    expect(normalizeLocale('ru-RU')).toBe('ru');
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('de')).toBe('uz-Latn');
  });

  it('keeps the owner-approved welcome and first-start language selector exact', () => {
    expect(translate('ru', 'start.choose_language')).toBe(
      'Tilni tanlang / Выберите язык / Choose your language',
    );
    expect(translate('ru', 'start.welcome')).toBe(
      '👋 Здравствуйте! Добро пожаловать в HMQA JURNAL BOT.\n\nЧерез бот вы можете подавать научные статьи в журналы Академии HMQA в электронном виде, знакомиться с журналами и требованиями к публикации, отвечать на запросы редакции и отслеживать ход рассмотрения своей статьи.\n\n📌 Основные возможности:\n📚 Журналы и требования к публикации\n📝 Подача новой статьи\n📂 Отслеживание отправленных статей\n🔄 Отправка доработанной версии\n🔔 Уведомления от редакции\n👤 Управление профилем автора\n\nВыберите нужный раздел 👇',
    );
    expect(translate('uz-Latn', 'start.welcome')).toBe(
      "👋 Assalomu alaykum! HMQA JURNAL BOT'ga xush kelibsiz.\n\nUshbu bot orqali HMQA Akademiyasi jurnallariga ilmiy maqolalaringizni elektron tarzda yuborishingiz, jurnal va nashr talablari bilan tanishishingiz, tahririyat so‘rovlariga javob berishingiz hamda maqolangizning ko‘rib chiqilish holatini kuzatishingiz mumkin.\n\n📌 Asosiy imkoniyatlar:\n📚 Jurnallar va nashr talablari\n📝 Yangi maqola yuborish\n📂 Yuborilgan maqolalarni kuzatish\n🔄 Qayta ishlangan versiyani yuborish\n🔔 Tahririyat bildirishnomalarini olish\n👤 Muallif profilini boshqarish\n\nKerakli bo‘limni tanlang 👇",
    );
    expect(translate('en', 'start.welcome')).toBe(
      '👋 Welcome to HMQA JURNAL BOT.\n\nThis bot allows you to submit research articles to HMQA Academy journals electronically, review journal and publication requirements, respond to editorial requests, and track the review status of your submissions.\n\n📌 Main features:\n📚 Journals and publication requirements\n📝 Submit a new article\n📂 Track submitted articles\n🔄 Submit a revised version\n🔔 Receive editorial notifications\n👤 Manage your author profile\n\nChoose an option below 👇',
    );
  });

  it('fails closed when required placeholders are missing', () => {
    expect(() => translate('en', 'error.system')).toThrow('correlation_id');
  });

  it('renders every mandatory runtime surface in all locales without leaking raw keys', () => {
    const surfaces = [
      'start.welcome',
      'menu.title',
      'menu.submit_article',
      'common.confirm',
      'validation.email',
      'error.file_format',
      'status.submitted',
      'status.registered',
      'status.revision_requested',
      'status.accepted',
      'status.rejected',
      'notification.submitted',
      'notification.accepted',
      'journal.requirements',
      'requirements.ack',
      'submission.new_version',
      'help.summary',
      'help.submit.label',
      'help.submit.text',
      'help.files.label',
      'help.statuses.label',
      'help.revision.label',
      'help.contact.label',
      'menu.contact',
      'contact.heading',
      'author.full_name',
      'author.degree_select',
      'author.title_select',
      'degree.phd',
      'degree.other',
      'title.professor',
      'title.other',
      'admin.auth.sign_in',
      'admin.nav.telegram',
      'admin.nav.administrators',
      'admin.metric.new',
      'admin.submissions.group.action',
      'admin.action.transition',
    ] as const satisfies readonly TranslationKey[];
    for (const locale of supportedLocales) {
      for (const key of surfaces) {
        const values = Object.fromEntries(
          placeholders(getBundle(locale)[key]).map((placeholder) => [placeholder, 'runtime-value']),
        );
        const rendered = translate(locale, key, values);
        expect(rendered, `${locale}:${key}`).not.toBe(key);
        expect(rendered, `${locale}:${key}`).not.toContain('{');
        expect(rendered.trim(), `${locale}:${key}`).not.toBe('');
      }
    }
  });

  it('escapes untrusted metadata before Telegram HTML rendering', () => {
    expect(escapeTelegramHtml('<script>alert("x")</script>&')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;',
    );
  });
});
