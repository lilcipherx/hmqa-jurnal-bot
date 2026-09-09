import en from './locales/en.json' with { type: 'json' };
import ru from './locales/ru.json' with { type: 'json' };
import uzLatn from './locales/uz-Latn.json' with { type: 'json' };

export const supportedLocales = ['uz-Latn', 'ru', 'en'] as const;
export type Locale = (typeof supportedLocales)[number];
export type TranslationKey = keyof typeof uzLatn;
export type TranslationValues = Readonly<Record<string, string | number | Date>>;

const bundles: Readonly<Record<Locale, Readonly<Record<TranslationKey, string>>>> = {
  'uz-Latn': uzLatn,
  ru,
  en,
};

export function normalizeLocale(value: string | undefined): Locale {
  if (!value) return 'uz-Latn';
  const normalized = value.trim().replace('_', '-').toLowerCase();
  if (normalized === 'ru' || normalized.startsWith('ru-')) return 'ru';
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
  if (normalized === 'uz' || normalized.startsWith('uz-')) return 'uz-Latn';
  return 'uz-Latn';
}

export function placeholders(message: string): readonly string[] {
  return [
    ...new Set([...message.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map((match) => match[1]!)),
  ].sort();
}

export function translate(
  locale: Locale,
  key: TranslationKey,
  values: TranslationValues = {},
): string {
  const safeMessage = bundles['uz-Latn']['system.safe_fallback'];
  const message = bundles[locale][key] ?? bundles['uz-Latn'][key] ?? safeMessage;
  return formatMessage(message, values);
}

export function formatMessage(message: string, values: TranslationValues = {}): string {
  const required = placeholders(message);
  const missing = required.filter((name) => !(name in values));
  if (missing.length > 0) {
    throw new Error(`Missing translation values: ${missing.join(',')}`);
  }
  return message.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (_match, name: string) => {
    const value = values[name];
    return value instanceof Date ? value.toISOString() : String(value);
  });
}

export function getBundle(locale: Locale): Readonly<Record<TranslationKey, string>> {
  return bundles[locale];
}

export function escapeTelegramHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
