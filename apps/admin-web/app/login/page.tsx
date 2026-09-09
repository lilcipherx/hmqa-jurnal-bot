import { translate } from '@hmqa/i18n';
import { currentLocale } from '../../lib/locale';
import { LoginForm } from './login-form';

export default async function LoginPage() {
  const locale = await currentLocale();
  return (
    <main className="login-shell">
      <section className="login-art">
        <div className="eyebrow">HMQA JURNAL BOT</div>
        <h1>{translate(locale, 'admin.product_name')}</h1>
      </section>
      <section className="login-panel">
        <LoginForm
          labels={{
            email: translate(locale, 'admin.auth.email'),
            password: translate(locale, 'admin.auth.password'),
            totp: translate(locale, 'admin.auth.two_factor'),
            totpHint: translate(locale, 'admin.auth.two_factor_reenrollment_hint'),
            submit: translate(locale, 'admin.auth.sign_in'),
            invalid: translate(locale, 'admin.auth.invalid'),
          }}
        />
      </section>
    </main>
  );
}
