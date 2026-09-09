'use client';

import { usePathname } from 'next/navigation';

export function LanguageSwitcher({
  currentLocale,
  label,
}: {
  currentLocale: 'uz-Latn' | 'ru' | 'en';
  label: string;
}) {
  const pathname = usePathname();
  return (
    <div className="language-switcher" aria-label={label}>
      {(
        [
          ['uz-Latn', 'UZ'],
          ['ru', 'RU'],
          ['en', 'EN'],
        ] as const
      ).map(([locale, shortLabel]) => (
        <a
          key={locale}
          href={`/api/locale?locale=${encodeURIComponent(locale)}&return=${encodeURIComponent(pathname)}`}
          hrefLang={locale}
          aria-current={locale === currentLocale ? 'page' : undefined}
        >
          {shortLabel}
        </a>
      ))}
    </div>
  );
}
