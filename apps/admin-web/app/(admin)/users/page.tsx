import { translate, type TranslationKey } from '@hmqa/i18n';
import { PageHeader } from '../../../components/page-header';
import { ResourceTable } from '../../../components/resource-table';
import { EmployeeInviteForm } from '../../../components/employee-invite-form';
import { EmployeeStatusButton } from '../../../components/employee-status-button';
import { EmployeeTotpResetButton } from '../../../components/employee-totp-reset-button';
import { adminFetch, type CurrentEmployee } from '../../../lib/api';
import { currentLocale } from '../../../lib/locale';
interface Employee {
  id: string;
  displayName: string;
  email: string;
  status: string;
  totpEnabled: boolean;
  roles: { role: { code: string } }[];
  createdAt: string;
  lastLoginAt: string | null;
}
export default async function UsersPage() {
  const locale = await currentLocale();
  const [data, currentEmployee] = await Promise.all([
    adminFetch<{ items: Employee[] }>('/api/v1/admin/employees'),
    adminFetch<CurrentEmployee>('/api/v1/auth/me'),
  ]);
  return (
    <>
      <PageHeader
        title={translate(locale, 'admin.users.heading')}
        description={translate(locale, 'admin.users.description')}
      />
      <ResourceTable
        caption={translate(locale, 'admin.users.heading')}
        headers={[
          translate(locale, 'admin.table.name'),
          translate(locale, 'admin.table.email'),
          translate(locale, 'admin.table.role'),
          translate(locale, 'admin.table.status'),
          translate(locale, 'admin.users.last_login'),
          translate(locale, 'admin.table.actions'),
        ]}
        empty={translate(locale, 'admin.table.empty')}
        rows={data.items.map((item) => [
          item.displayName,
          item.email,
          translate(locale, 'role.admin'),
          <span className="badge">
            {translate(locale, `employee_status.${item.status.toLowerCase()}` as TranslationKey)}
          </span>,
          item.lastLoginAt
            ? new Date(item.lastLoginAt).toLocaleString(locale)
            : translate(locale, 'common.not_specified'),
          <div className="table-actions">
            {item.status !== 'INVITED' ? (
              <EmployeeStatusButton
                id={item.id}
                status={item.status}
                labels={{
                  activate: translate(locale, 'admin.users.activate'),
                  suspend: translate(locale, 'admin.users.suspend'),
                  warning: translate(locale, 'admin.users.status_warning'),
                  currentPassword: translate(locale, 'admin.security.current_password'),
                  currentTotp: translate(locale, 'admin.security.current_totp'),
                  confirm: translate(locale, 'admin.users.confirm_status'),
                  continue: translate(locale, 'common.next'),
                  cancel: translate(locale, 'common.cancel'),
                }}
              />
            ) : null}
            {item.id !== currentEmployee.id ? (
              <EmployeeTotpResetButton
                id={item.id}
                totpEnabled={item.totpEnabled}
                labels={{
                  reset: translate(locale, 'admin.security.reset_totp'),
                  pending: translate(locale, 'admin.security.reenrollment_pending'),
                  currentPassword: translate(locale, 'admin.security.current_password'),
                  currentTotp: translate(locale, 'admin.security.current_totp'),
                  continue: translate(locale, 'common.next'),
                  warning: translate(locale, 'admin.security.admin_reset_warning'),
                  confirm: translate(locale, 'admin.security.confirm_reset'),
                  cancel: translate(locale, 'common.cancel'),
                }}
              />
            ) : null}
          </div>,
        ])}
      />
      <EmployeeInviteForm
        labels={{
          heading: translate(locale, 'admin.invite.employee_heading'),
          name: translate(locale, 'admin.table.name'),
          email: translate(locale, 'admin.table.email'),
          currentPassword: translate(locale, 'admin.security.current_password'),
          currentTotp: translate(locale, 'admin.security.current_totp'),
          confirm: translate(locale, 'admin.invite.confirm_admin'),
          invitation: translate(locale, 'admin.invite.link'),
          submit: translate(locale, 'admin.invite.send'),
        }}
      />
    </>
  );
}
