import { normalizeLocale, type Locale } from '@hmqa/i18n';
import { cookies } from 'next/headers';

export async function currentLocale(): Promise<Locale> {
  return normalizeLocale((await cookies()).get('hmqa_locale')?.value);
}
