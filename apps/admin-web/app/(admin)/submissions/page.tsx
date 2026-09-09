import { translate, type TranslationKey } from '@hmqa/i18n';
import Link from 'next/link';
import { PageHeader } from '../../../components/page-header';
import { ResourceTable } from '../../../components/resource-table';
import { adminFetch } from '../../../lib/api';
import { currentLocale } from '../../../lib/locale';

interface Submission {
  id: string;
  publicId: string;
  status: string;
  submittedAt: string;
  journal: { code: string };
  owner: {
    authorProfile: { fullName: string | null; firstName: string; lastName: string } | null;
  };
  versions: { metadata: { titles: unknown } | null }[];
}
export default async function SubmissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; group?: string; journalId?: string; q?: string }>;
}) {
  const locale = await currentLocale();
  const query = await searchParams;
  const selectedGroup = query.group ?? (query.status ? 'all' : 'new');
  const parameters = new URLSearchParams({ limit: '100' });
  if (query.status) parameters.set('status', query.status);
  else parameters.set('group', selectedGroup);
  if (query.journalId) parameters.set('journalId', query.journalId);
  if (query.q) parameters.set('q', query.q);
  const [data, journals] = await Promise.all([
    adminFetch<{ items: Submission[] }>(`/api/v1/admin/submissions?${parameters}`),
    adminFetch<{ items: { id: string; code: string }[] }>('/api/v1/admin/journals'),
  ]);
  const localizedTitle = (titles: unknown) => {
    if (!titles || typeof titles !== 'object' || Array.isArray(titles)) return '—';
    const values = titles as Record<string, unknown>;
    for (const key of [locale, 'ru', 'en', 'uz-Latn']) {
      const title = values[key];
      if (typeof title === 'string' && title.trim()) return title;
    }
    return '—';
  };
  return (
    <>
      <PageHeader
        title={translate(locale, 'admin.submissions.heading')}
        description={translate(locale, 'admin.submissions.description')}
      />
      <nav className="filter-tabs" aria-label={translate(locale, 'admin.filter.status')}>
        {[
          ['new', 'admin.submissions.group.new'],
          ['action', 'admin.submissions.group.action'],
          ['review', 'admin.submissions.group.review'],
          ['revision', 'admin.submissions.group.revision'],
          ['accepted', 'admin.submissions.group.accepted'],
          ['rejected', 'admin.submissions.group.rejected'],
          ['published', 'admin.submissions.group.published'],
          ['all', 'admin.filter.all'],
        ].map(([group, key]) => (
          <Link
            className={selectedGroup === group ? 'active' : ''}
            href={`/submissions?group=${group}`}
            key={group}
          >
            {translate(locale, key as TranslationKey)}
          </Link>
        ))}
      </nav>
      <form className="panel form-stack" method="get">
        <label className="field" htmlFor="q">
          {translate(locale, 'admin.filter.search')}
          <input id="q" name="q" type="search" defaultValue={query.q ?? ''} maxLength={200} />
        </label>
        <label className="field" htmlFor="journalId">
          {translate(locale, 'admin.filter.journal')}
          <select id="journalId" name="journalId" defaultValue={query.journalId ?? ''}>
            <option value="">{translate(locale, 'admin.filter.all')}</option>
            {journals.items.map((journal) => (
              <option key={journal.id} value={journal.id}>
                {journal.code}
              </option>
            ))}
          </select>
        </label>
        <label className="field" htmlFor="status">
          {translate(locale, 'admin.filter.status')}
          <select id="status" name="status" defaultValue={query.status ?? ''}>
            <option value="">{translate(locale, 'admin.filter.all')}</option>
            {[
              'SUBMITTED',
              'TECHNICAL_REVIEW',
              'NEEDS_CORRECTION',
              'REGISTERED',
              'EDITORIAL_REVIEW',
              'UNDER_REVIEW',
              'REVISION_REQUESTED',
              'REVISION_SUBMITTED',
              'ACCEPTED',
              'REJECTED',
              'COPYEDITING',
              'LAYOUT',
              'PUBLISHED',
              'WITHDRAWN',
              'ARCHIVED',
            ].map((status) => (
              <option key={status} value={status}>
                {translate(locale, `status.${status.toLowerCase()}` as TranslationKey)}
              </option>
            ))}
          </select>
        </label>
        <button className="button" type="submit">
          {translate(locale, 'admin.action.filter')}
        </button>
      </form>
      <ResourceTable
        caption={translate(locale, 'admin.submissions.heading')}
        headers={[
          translate(locale, 'admin.table.id'),
          translate(locale, 'submission.preview.title'),
          translate(locale, 'submission.preview.author'),
          translate(locale, 'admin.table.journal'),
          translate(locale, 'admin.table.status'),
          translate(locale, 'admin.table.submitted'),
          translate(locale, 'admin.table.actions'),
        ]}
        empty={translate(locale, 'admin.table.empty')}
        rows={data.items.map((item) => [
          <span className="identifier" translate="no">
            {item.publicId}
          </span>,
          localizedTitle(item.versions[0]?.metadata?.titles),
          item.owner.authorProfile?.fullName ||
            [item.owner.authorProfile?.lastName, item.owner.authorProfile?.firstName]
              .filter(Boolean)
              .join(' ') ||
            translate(locale, 'common.not_specified'),
          item.journal.code,
          <span className="badge">
            {translate(locale, `status.${item.status.toLowerCase()}` as TranslationKey)}
          </span>,
          new Date(item.submittedAt).toLocaleString(locale),
          <Link className="link-button" href={`/submissions/${item.id}`}>
            {translate(locale, 'admin.action.open')}
          </Link>,
        ])}
      />
    </>
  );
}
