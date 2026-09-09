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
}
export default async function SubmissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; journalId?: string; q?: string }>;
}) {
  const locale = await currentLocale();
  const query = await searchParams;
  const parameters = new URLSearchParams({ limit: '100' });
  if (query.status) parameters.set('status', query.status);
  if (query.journalId) parameters.set('journalId', query.journalId);
  if (query.q) parameters.set('q', query.q);
  const [data, journals] = await Promise.all([
    adminFetch<{ items: Submission[] }>(`/api/v1/admin/submissions?${parameters}`),
    adminFetch<{ items: { id: string; code: string }[] }>('/api/v1/admin/journals'),
  ]);
  return (
    <>
      <PageHeader
        title={translate(locale, 'admin.submissions.heading')}
        description={translate(locale, 'admin.submissions.description')}
      />
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
