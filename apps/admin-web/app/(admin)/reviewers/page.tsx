import { translate, type TranslationKey } from '@hmqa/i18n';
import { PageHeader } from '../../../components/page-header';
import { ResourceTable } from '../../../components/resource-table';
import { ReviewerManager } from '../../../components/reviewer-manager';
import { adminFetch } from '../../../lib/api';
import { currentLocale } from '../../../lib/locale';
interface Reviewer {
  id: string;
  active: boolean;
  affiliation: string;
  expertise: unknown;
  employee: { displayName: string; email: string; status: string };
  _count: { assignments: number };
}
export default async function ReviewersPage() {
  const locale = await currentLocale();
  const data = await adminFetch<{ items: Reviewer[] }>('/api/v1/admin/reviewers');
  return (
    <>
      <PageHeader title={translate(locale, 'admin.reviewers.heading')} />
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
          item.employee.displayName,
          item.employee.email,
          <span className="badge">
            {translate(
              locale,
              `employee_status.${item.employee.status.toLowerCase()}` as TranslationKey,
            )}
          </span>,
          item._count.assignments.toLocaleString(locale),
        ])}
      />
      <ReviewerManager
        reviewers={data.items}
        labels={{
          heading: translate(locale, 'admin.reviewers.edit'),
          affiliation: translate(locale, 'admin.invite.affiliation'),
          expertise: translate(locale, 'admin.invite.expertise'),
          active: translate(locale, 'admin.reviewers.active'),
          save: translate(locale, 'admin.action.save'),
        }}
      />
    </>
  );
}
