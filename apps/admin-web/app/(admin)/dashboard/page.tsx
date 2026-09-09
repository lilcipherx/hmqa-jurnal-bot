import { translate, type TranslationKey } from '@hmqa/i18n';
import Link from 'next/link';
import { PageHeader } from '../../../components/page-header';
import { ResourceTable } from '../../../components/resource-table';
import { adminFetch } from '../../../lib/api';
import { currentLocale } from '../../../lib/locale';

interface Dashboard {
  total: number;
  newArticles: number;
  pendingTechnical: number;
  underReview: number;
  revisions: number;
  accepted: number;
  rejected: number;
  published: number;
  failedNotifications: number;
  recentSubmissions: {
    id: string;
    publicId: string;
    status: string;
    submittedAt: string;
    journal: { code: string };
    owner: {
      authorProfile: { fullName: string | null; firstName: string; lastName: string } | null;
    };
    versions: { metadata: { titles: unknown } | null }[];
  }[];
  requiringAction: { id: string; publicId: string; status: string; submittedAt: string }[];
}
export default async function DashboardPage() {
  const locale = await currentLocale();
  const data = await adminFetch<Dashboard>('/api/v1/admin/dashboard');
  const localizedTitle = (titles: unknown) => {
    if (!titles || typeof titles !== 'object' || Array.isArray(titles)) return '—';
    const values = titles as Record<string, unknown>;
    for (const key of [locale, 'ru', 'en', 'uz-Latn']) {
      const value = values[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
    return (
      Object.values(values).find(
        (value): value is string => typeof value === 'string' && Boolean(value.trim()),
      ) ?? '—'
    );
  };
  const metrics = [
    ['admin.metric.new', data.newArticles],
    ['admin.metric.technical', data.pendingTechnical],
    ['admin.metric.review', data.underReview],
    ['admin.metric.revisions', data.revisions],
    ['admin.metric.accepted', data.accepted],
    ['admin.metric.rejected', data.rejected],
    ['admin.metric.published', data.published],
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
      <div className="button-row section-block">
        <Link className="button" href="/submissions?group=new">
          {translate(locale, 'admin.dashboard.open_new')}
        </Link>
      </div>
      <ResourceTable
        caption={translate(locale, 'admin.dashboard.requires_action')}
        headers={[
          translate(locale, 'admin.table.id'),
          translate(locale, 'admin.table.status'),
          translate(locale, 'admin.table.submitted'),
        ]}
        empty={translate(locale, 'admin.table.empty')}
        rows={data.requiringAction.map((item) => [
          <Link className="link-button" href={`/submissions/${item.id}`}>
            {item.publicId}
          </Link>,
          translate(locale, `status.${item.status.toLowerCase()}` as TranslationKey),
          new Date(item.submittedAt).toLocaleDateString(locale),
        ])}
      />
      <ResourceTable
        caption={translate(locale, 'admin.dashboard.recent')}
        headers={[
          translate(locale, 'admin.table.id'),
          translate(locale, 'submission.preview.title'),
          translate(locale, 'submission.preview.author'),
          translate(locale, 'admin.table.journal'),
          translate(locale, 'admin.table.status'),
        ]}
        empty={translate(locale, 'admin.table.empty')}
        rows={data.recentSubmissions.map((item) => [
          <Link className="link-button" href={`/submissions/${item.id}`}>
            {item.publicId}
          </Link>,
          localizedTitle(item.versions[0]?.metadata?.titles),
          item.owner.authorProfile?.fullName ||
            [item.owner.authorProfile?.lastName, item.owner.authorProfile?.firstName]
              .filter(Boolean)
              .join(' ') ||
            translate(locale, 'common.not_specified'),
          item.journal.code,
          translate(locale, `status.${item.status.toLowerCase()}` as TranslationKey),
        ])}
      />
    </>
  );
}
