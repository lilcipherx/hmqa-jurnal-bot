import { translate } from '@hmqa/i18n';
import { PageHeader } from '../../../components/page-header';
import { ResourceTable } from '../../../components/resource-table';
import { adminFetch } from '../../../lib/api';
import { currentLocale } from '../../../lib/locale';
interface Audit {
  id: string;
  action: string;
  actorRole: string | null;
  entity: string;
  entityId: string | null;
  createdAt: string;
  eventHash: string;
}
export default async function AuditPage() {
  const locale = await currentLocale();
  const data = await adminFetch<{ items: Audit[] }>('/api/v1/admin/audit?limit=100');
  return (
    <>
      <PageHeader title={translate(locale, 'admin.audit.heading')} />
      <ResourceTable
        caption={translate(locale, 'admin.audit.heading')}
        headers={[
          translate(locale, 'admin.table.created'),
          translate(locale, 'admin.table.action'),
          translate(locale, 'admin.table.actor'),
          translate(locale, 'admin.table.entity'),
        ]}
        empty={translate(locale, 'admin.table.empty')}
        rows={data.items.map((item) => [
          new Date(item.createdAt).toLocaleString(locale),
          <span className="identifier">{item.action}</span>,
          item.actorRole ?? translate(locale, 'admin.actor.system'),
          `${item.entity}${item.entityId ? ` · ${item.entityId}` : ''}`,
        ])}
      />
    </>
  );
}
