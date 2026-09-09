import { translate, type TranslationKey } from '@hmqa/i18n';
import type { Route } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { LogoutButton } from '../../components/logout-button';
import { AdminApiError, adminFetch, type CurrentEmployee } from '../../lib/api';
import { currentLocale } from '../../lib/locale';

const navigation = [
  ['/dashboard', 'admin.nav.dashboard', null],
  ['/submissions', 'admin.nav.submissions', 'submission:read:journal'],
  ['/reviews', 'admin.nav.my_reviews', 'review:read:assigned'],
  ['/journals', 'admin.nav.journals', 'journal:read'],
  ['/reviewers', 'admin.nav.reviewers', 'review:assign'],
  ['/users', 'admin.nav.users', 'user:manage'],
  ['/translations', 'admin.nav.translations', 'translation:configure'],
  ['/reports', 'admin.nav.reports', 'export:create'],
  ['/audit', 'admin.nav.audit', 'audit:read:journal|audit:read:all'],
  ['/notifications', 'admin.nav.notification_ops', 'notification:replay|operations:read'],
  ['/privacy', 'admin.nav.privacy', 'privacy:case:read'],
  ['/settings', 'admin.nav.settings', 'operations:read'],
] as const;

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const locale = await currentLocale();
  let employee: CurrentEmployee;
  try {
    employee = await adminFetch<CurrentEmployee>('/api/v1/auth/me');
  } catch (error) {
    if (error instanceof AdminApiError && error.status === 401) redirect('/login');
    throw error;
  }
  const allowed = (permission: string | null) =>
    !permission || permission.split('|').some((value) => employee.permissions.includes(value));
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        {translate(locale, 'admin.skip_content')}
      </a>
      <aside className="sidebar">
        <div className="brand">
          <strong translate="no">HMQA JURNAL BOT</strong>
          <span>{translate(locale, 'admin.product_name')}</span>
        </div>
        <nav className="nav" aria-label={translate(locale, 'admin.product_name')}>
          {navigation
            .filter(([, , permission]) => allowed(permission))
            .map(([href, key]) => (
              <Link href={href as Route} key={href}>
                <span className="mark" aria-hidden="true" />
                {translate(locale, key as TranslationKey)}
              </Link>
            ))}
        </nav>
        <div className="session">
          <strong>{employee.displayName}</strong>
          <span>
            {translate(locale, 'admin.session.role')}:{' '}
            {translate(locale, `role.${employee.role.toLowerCase()}` as TranslationKey)}
          </span>
          <span>{employee.email}</span>
        </div>
      </aside>
      <div className="content">
        <header className="topbar">
          <a href="/api/locale?locale=uz-Latn&return=/dashboard" hrefLang="uz-Latn">
            UZ
          </a>
          <a href="/api/locale?locale=ru&return=/dashboard" hrefLang="ru">
            RU
          </a>
          <a href="/api/locale?locale=en&return=/dashboard" hrefLang="en">
            EN
          </a>
          <LogoutButton label={translate(locale, 'admin.auth.sign_out')} />
        </header>
        <main id="main" className="page">
          {children}
        </main>
      </div>
    </div>
  );
}
