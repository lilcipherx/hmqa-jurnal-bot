import { translate, type TranslationKey } from '@hmqa/i18n';
import { PageHeader } from '../../../components/page-header';
import { ResourceTable } from '../../../components/resource-table';
import { EmployeeInviteForm } from '../../../components/employee-invite-form';
import { EmployeeStatusButton } from '../../../components/employee-status-button';
import { EmployeeAccessForms } from '../../../components/employee-access-form';
import { adminFetch } from '../../../lib/api';
import { currentLocale } from '../../../lib/locale';
interface Employee {
  id: string;
  displayName: string;
  email: string;
  status: string;
  roles: { role: { code: string } }[];
  journalScopes: { journalId: string }[];
  createdAt: string;
}
export default async function UsersPage() {
  const locale = await currentLocale();
  const [data, journals] = await Promise.all([
    adminFetch<{ items: Employee[] }>('/api/v1/admin/employees'),
    adminFetch<{ items: { id: string; code: string }[] }>('/api/v1/admin/journals'),
  ]);
  const managedRoles = [
    'OPERATOR',
    'EDITOR',
    'REVIEWER',
    'CHIEF_EDITOR',
    'CONTENT_ADMIN',
    'ADMIN',
    'AUDITOR',
  ] as const;
  const roleLabels = Object.fromEntries(
    managedRoles.map((role) => [
      role,
      translate(locale, `role.${role.toLowerCase()}` as TranslationKey),
    ]),
  );
  return (
    <>
      <PageHeader title={translate(locale, 'admin.users.heading')} />
      <ResourceTable
        caption={translate(locale, 'admin.users.heading')}
        headers={[
          translate(locale, 'admin.table.name'),
          translate(locale, 'admin.table.email'),
          translate(locale, 'admin.table.role'),
          translate(locale, 'admin.table.status'),
          translate(locale, 'admin.table.actions'),
        ]}
        empty={translate(locale, 'admin.table.empty')}
        rows={data.items.map((item) => [
          item.displayName,
          item.email,
          item.roles
            .map((entry) =>
              translate(locale, `role.${entry.role.code.toLowerCase()}` as TranslationKey),
            )
            .join(', '),
          <span className="badge">
            {translate(locale, `employee_status.${item.status.toLowerCase()}` as TranslationKey)}
          </span>,
          <EmployeeStatusButton
            id={item.id}
            status={item.status}
            labels={{
              activate: translate(locale, 'admin.users.activate'),
              suspend: translate(locale, 'admin.users.suspend'),
            }}
          />,
        ])}
      />
      <EmployeeInviteForm
        journals={journals.items}
        roleLabels={roleLabels}
        labels={{
          heading: translate(locale, 'admin.invite.employee_heading'),
          name: translate(locale, 'admin.table.name'),
          email: translate(locale, 'admin.table.email'),
          role: translate(locale, 'admin.table.role'),
          journals: translate(locale, 'admin.table.journal'),
          affiliation: translate(locale, 'admin.invite.affiliation'),
          expertise: translate(locale, 'admin.invite.expertise'),
          invitation: translate(locale, 'admin.invite.link'),
          submit: translate(locale, 'admin.invite.send'),
        }}
      />
      <EmployeeAccessForms
        employees={data.items}
        journals={journals.items}
        roles={managedRoles}
        roleLabels={roleLabels}
        labels={{
          heading: translate(locale, 'admin.users.access'),
          roles: translate(locale, 'admin.table.role'),
          journals: translate(locale, 'admin.table.journal'),
          save: translate(locale, 'admin.action.save'),
        }}
      />
    </>
  );
}
