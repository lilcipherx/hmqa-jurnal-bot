import { translate } from '@hmqa/i18n';
import { PageHeader } from '../../../components/page-header';
import { ResourceTable } from '../../../components/resource-table';
import { ReviewerManager } from '../../../components/reviewer-manager';
import { adminFetch } from '../../../lib/api';
import { currentLocale } from '../../../lib/locale';
interface Reviewer {
  id: string;
  active: boolean;
  displayName: string;
  email: string | null;
  phone: string | null;
  affiliation: string;
  expertise: unknown;
  _count: { assignments: number };
}
export default async function ReviewersPage() {
  const locale = await currentLocale();
  const data = await adminFetch<{ items: Reviewer[] }>('/api/v1/admin/reviewers');
  return (
    <>
      <PageHeader
        title={translate(locale, 'admin.reviewers.heading')}
        description={translate(locale, 'admin.reviewers.description')}
      />
      <ResourceTable
        caption={translate(locale, 'admin.reviewers.heading')}
        headers={[
          translate(locale, 'admin.table.name'),
          translate(locale, 'admin.table.email'),
          translate(locale, 'admin.table.status'),
          translate(locale, 'admin.table.count'),
        ]}
        empty={translate(locale, 'admin.table.empty')}
        rows={data.items.map((item) => [
          item.displayName,
          item.email ?? item.phone ?? translate(locale, 'common.not_specified'),
          <span className="badge">
            {item.active
              ? translate(locale, 'admin.reviewers.active')
              : translate(locale, 'employee_status.disabled')}
          </span>,
          item._count.assignments.toLocaleString(locale),
        ])}
      />
      <ReviewerManager
        reviewers={data.items}
        labels={{
          heading: translate(locale, 'admin.reviewers.edit'),
          create: translate(locale, 'admin.reviewers.create'),
          add: translate(locale, 'admin.reviewers.add'),
          name: translate(locale, 'admin.table.name'),
          email: translate(locale, 'admin.table.email'),
          phone: translate(locale, 'contact.phone'),
          affiliation: translate(locale, 'admin.invite.affiliation'),
          expertise: translate(locale, 'admin.invite.expertise'),
          active: translate(locale, 'admin.reviewers.active'),
          save: translate(locale, 'admin.action.save'),
        }}
      />
    </>
  );
}
