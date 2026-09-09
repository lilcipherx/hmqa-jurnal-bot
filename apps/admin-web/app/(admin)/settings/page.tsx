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
  const scalar = (value: unknown): string =>
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : '—';
  const rows = [
    ['admin.settings.timezone', scalar(data.timezone)],
    ['admin.settings.default_locale', scalar(data.defaultLocale)],
    [
      'admin.settings.supported_locales',
      Array.isArray(data.supportedLocales) ? data.supportedLocales.join(', ') : '—',
    ],
    [
      'admin.settings.file_limit',
      `${Math.round(Number(data.fileMaxBytes ?? 0) / 1024 / 1024)} MiB`,
    ],
    ['admin.settings.signed_url_ttl', `${scalar(data.signedUrlTtlSeconds)} s`],
    [
      'admin.settings.retention',
      data.retentionEnabled === true
        ? `${translate(locale, 'admin.settings.enabled')} · ${scalar(data.retentionDraftDays)} ${translate(locale, 'admin.settings.days')}`
        : translate(locale, 'admin.settings.disabled'),
    ],
  ] as const;
  return (
    <>
      <PageHeader
        title={translate(locale, 'admin.settings.heading')}
        description={translate(locale, 'admin.settings.description')}
      />
      <h2>{translate(locale, 'admin.settings.system')}</h2>
      <ResourceTable
        caption={translate(locale, 'admin.settings.system')}
        headers={[
          translate(locale, 'admin.settings.parameter'),
          translate(locale, 'common.details'),
        ]}
        empty={translate(locale, 'admin.table.empty')}
        rows={rows.map(([key, value]) => [translate(locale, key), value])}
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
