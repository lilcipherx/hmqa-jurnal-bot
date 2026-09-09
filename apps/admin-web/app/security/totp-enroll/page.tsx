import { translate } from '@hmqa/i18n';
import { currentLocale } from '../../../lib/locale';
import { TotpEnrollmentForm } from './totp-enrollment-form';

export default async function TotpEnrollmentPage() {
  const locale = await currentLocale();
  return (
    <main className="login-shell">
      <section className="login-art">
        <div className="eyebrow">HMQA JURNAL BOT</div>
        <h1>{translate(locale, 'admin.security.enrollment_heading')}</h1>
      </section>
      <section className="login-panel">
        <TotpEnrollmentForm
          labels={{
            loading: translate(locale, 'admin.security.enrollment_loading'),
            account: translate(locale, 'admin.security.account'),
            secret: translate(locale, 'admin.security.new_totp_secret'),
            help: translate(locale, 'admin.security.enrollment_help'),
            totp: translate(locale, 'admin.auth.two_factor'),
            submit: translate(locale, 'admin.security.enrollment_submit'),
            expired: translate(locale, 'admin.security.enrollment_expired'),
            signIn: translate(locale, 'admin.auth.sign_in'),
          }}
        />
      </section>
    </main>
  );
}
