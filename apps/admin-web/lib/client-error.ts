'use client';

import { getBundle, normalizeLocale, translate, type TranslationKey } from '@hmqa/i18n';

export async function localizedResponseError(response: Response): Promise<string> {
  const locale = normalizeLocale(document.documentElement.lang);
  const problem = (await response.json().catch(() => null)) as {
    messageKey?: string;
    correlationId?: string;
  } | null;
  if (problem?.messageKey && problem.messageKey in getBundle(locale)) {
    try {
      return translate(locale, problem.messageKey as TranslationKey, {
        correlation_id: problem.correlationId ?? '—',
      });
    } catch {
      // Some validation templates need field-specific values which the BFF may not expose.
    }
  }
  return translate(locale, 'admin.error.unavailable');
}
