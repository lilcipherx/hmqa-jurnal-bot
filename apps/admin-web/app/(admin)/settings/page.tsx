import { translate } from '@hmqa/i18n';
import { PageHeader } from '../../../components/page-header';
import { ResourceTable } from '../../../components/resource-table';
import { SecuritySettings } from '../../../components/security-settings';
import { adminFetch, type CurrentEmployee } from '../../../lib/api';
import { currentLocale } from '../../../lib/locale';
export default async function SettingsPage() {
  const locale = await currentLocale();
  const [data, employee] = await Promise.all([
    adminFetch<Record<string, unknown>>('/api/v1/admin/settings/runtime'),
    adminFetch<CurrentEmployee>('/api/v1/auth/me'),
  ]);
  return (
    <>
      <PageHeader title={translate(locale, 'admin.settings.heading')} />
      <ResourceTable
        caption={translate(locale, 'admin.settings.heading')}
        headers={[translate(locale, 'admin.table.key'), translate(locale, 'common.details')]}
        empty={translate(locale, 'admin.table.empty')}
        rows={Object.entries(data).map(([key, value]) => [
          <span className="identifier">{key}</span>,
          Array.isArray(value) ? value.join(', ') : String(value),
        ])}
      />
      <SecuritySettings
        totpEnabled={employee.totpEnabled}
        labels={{
          heading: translate(locale, 'admin.security.heading'),
          status: translate(locale, 'admin.security.status'),
          enabled: translate(locale, 'admin.security.enabled'),
          pending: translate(locale, 'admin.security.reenrollment_pending'),
          passwordHeading: translate(locale, 'admin.security.password_heading'),
          currentPassword: translate(locale, 'admin.security.current_password'),
          currentTotp: translate(locale, 'admin.security.current_totp'),
          newPassword: translate(locale, 'admin.security.new_password'),
          confirmPassword: translate(locale, 'admin.security.confirm_password'),
          changePassword: translate(locale, 'admin.security.change_password'),
          passwordMismatch: translate(locale, 'admin.security.password_mismatch'),
          resetHeading: translate(locale, 'admin.security.reset_heading'),
          resetDescription: translate(locale, 'admin.security.reset_description'),
          resetWarning: translate(locale, 'admin.security.reset_warning'),
          continue: translate(locale, 'common.next'),
          confirmReset: translate(locale, 'admin.security.confirm_reset'),
          cancel: translate(locale, 'common.cancel'),
        }}
      />
    </>
  );
}
