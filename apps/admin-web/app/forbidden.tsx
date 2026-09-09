import { translate } from '@hmqa/i18n';
import Link from 'next/link';
import { currentLocale } from '../lib/locale';

export default async function ForbiddenPage() {
  const locale = await currentLocale();
  return (
    <main className="login-shell">
      <section className="login-art">
        <div className="eyebrow">HMQA JURNAL BOT</div>
        <h1>{translate(locale, 'admin.error.forbidden_heading')}</h1>
      </section>
      <section className="login-panel form-stack">
        <p>{translate(locale, 'error.forbidden')}</p>
        <Link className="button" href="/dashboard">
          {translate(locale, 'admin.nav.dashboard')}
        </Link>
      </section>
    </main>
  );
}
