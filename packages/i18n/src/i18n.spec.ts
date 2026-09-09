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
      'admin.auth.sign_in',
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
