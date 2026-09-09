import { translate } from '@hmqa/i18n';
import { currentLocale } from '../../lib/locale';
import { InviteForm } from './invite-form';

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const locale = await currentLocale();
  const { token = '' } = await searchParams;
  return (
    <main className="login-panel full-page-form">
      <InviteForm
        token={token}
        labels={{
          heading: translate(locale, 'admin.invite.heading'),
          totpSecret: translate(locale, 'admin.invite.totp_secret'),
          totpHelp: translate(locale, 'admin.invite.totp_help'),
          password: translate(locale, 'admin.auth.password'),
          totp: translate(locale, 'admin.auth.two_factor'),
          submit: translate(locale, 'admin.invite.activate'),
          done: translate(locale, 'admin.invite.done'),
          login: translate(locale, 'admin.auth.sign_in'),
          invalid: translate(locale, 'admin.error.unavailable'),
        }}
      />
    </main>
  );
}
