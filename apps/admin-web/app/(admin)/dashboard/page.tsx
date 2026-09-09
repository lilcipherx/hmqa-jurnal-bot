import { translate } from '@hmqa/i18n';
import { PageHeader } from '../../../components/page-header';
import { adminFetch } from '../../../lib/api';
import { currentLocale } from '../../../lib/locale';

interface Dashboard {
  total: number;
  pendingTechnical: number;
  underReview: number;
  revisions: number;
  published: number;
  failedNotifications: number;
}
export default async function DashboardPage() {
  const locale = await currentLocale();
  const data = await adminFetch<Dashboard>('/api/v1/admin/dashboard');
  const metrics = [
    ['admin.metric.total', data.total],
    ['admin.metric.technical', data.pendingTechnical],
    ['admin.metric.review', data.underReview],
    ['admin.metric.revisions', data.revisions],
    ['admin.metric.published', data.published],
    ['admin.metric.failed_notifications', data.failedNotifications],
  ] as const;
  return (
    <>
      <PageHeader
        title={translate(locale, 'admin.dashboard.heading')}
        description={translate(locale, 'admin.dashboard.description')}
      />
      <section className="metrics" aria-label={translate(locale, 'admin.dashboard.heading')}>
        {metrics.map(([key, value]) => (
          <article className="metric" key={key}>
            <span>{translate(locale, key)}</span>
            <strong>{value.toLocaleString(locale)}</strong>
          </article>
        ))}
      </section>
    </>
  );
}
