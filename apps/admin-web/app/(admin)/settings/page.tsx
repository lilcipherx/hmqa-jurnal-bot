import { translate } from '@hmqa/i18n';
import { PageHeader } from '../../../components/page-header';
import { ResourceTable } from '../../../components/resource-table';
import { adminFetch } from '../../../lib/api';
import { currentLocale } from '../../../lib/locale';
export default async function SettingsPage() {
  const locale = await currentLocale();
  const data = await adminFetch<Record<string, unknown>>('/api/v1/admin/settings/runtime');
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
    </>
  );
}
