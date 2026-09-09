import { translate, type TranslationKey } from '@hmqa/i18n';
import { PageHeader } from '../../../components/page-header';
import { ResourceTable } from '../../../components/resource-table';
import { adminFetch } from '../../../lib/api';
import { currentLocale } from '../../../lib/locale';
interface Overview {
  generatedAt: string;
  byStatus: { status: string; _count: { _all: number } }[];
}
export default async function ReportsPage() {
  const locale = await currentLocale();
  const data = await adminFetch<Overview>('/api/v1/admin/reports/overview');
  return (
    <>
      <PageHeader
        title={translate(locale, 'admin.reports.heading')}
        description={new Date(data.generatedAt).toLocaleString(locale)}
      />
      <ResourceTable
        caption={translate(locale, 'admin.reports.heading')}
        headers={[translate(locale, 'admin.table.status'), translate(locale, 'admin.table.count')]}
        empty={translate(locale, 'admin.table.empty')}
        rows={data.byStatus.map((item) => [
          translate(locale, `status.${item.status.toLowerCase()}` as TranslationKey),
          item._count._all.toLocaleString(locale),
        ])}
      />
      <a className="button" href="/api/reports/submissions.csv">
        {translate(locale, 'admin.reports.export_csv')}
      </a>
    </>
  );
}
