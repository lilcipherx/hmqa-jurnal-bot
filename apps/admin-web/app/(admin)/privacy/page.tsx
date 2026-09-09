import { translate, type TranslationKey } from '@hmqa/i18n';
import { PageHeader } from '../../../components/page-header';
import { PrivacyCaseManager } from '../../../components/privacy-case-manager';
import { adminFetch, type CurrentEmployee } from '../../../lib/api';
import { currentLocale } from '../../../lib/locale';

const requestTypes = ['ACCESS', 'RECTIFICATION', 'ERASURE', 'RESTRICTION'] as const;
const requestStatuses = [
  'RECEIVED',
  'IDENTITY_VERIFICATION',
  'IN_REVIEW',
  'APPROVED',
  'DENIED',
  'EXECUTING',
  'COMPLETED',
  'CANCELLED',
] as const;

interface PrivacyCase {
  id: string;
  publicId: string;
  type: string;
  status: string;
  dueAt: string;
  rowVersion: number;
  identityVerifiedAt: string | null;
  decisionReason: string | null;
  activeLegalHoldCount: number;
  subject: { id: string; displayName: string; email: string; phone: string } | null;
}

interface LegalHold {
  id: string;
  status: string;
  reason: string;
  placedAt: string;
  submission: { publicId: string } | null;
  dataSubjectRequest: { publicId: string } | null;
}

export default async function PrivacyPage() {
  const locale = await currentLocale();
  const [employee, cases, holds] = await Promise.all([
    adminFetch<CurrentEmployee>('/api/v1/auth/me'),
    adminFetch<{ items: PrivacyCase[] }>('/api/v1/admin/privacy/requests?limit=100'),
    adminFetch<{ items: LegalHold[] }>('/api/v1/admin/privacy/legal-holds'),
  ]);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <>
      <PageHeader
        title={translate(locale, 'admin.privacy.heading')}
        description={translate(locale, 'admin.privacy.description')}
      />
      <PrivacyCaseManager
        cases={cases.items.map((item) => ({ ...item, dueAt: date.format(new Date(item.dueAt)) }))}
        holds={holds.items.map((item) => ({
          ...item,
          placedAt: date.format(new Date(item.placedAt)),
        }))}
        typeLabels={Object.fromEntries(
          requestTypes.map((type) => [
            type,
            translate(locale, `privacy.type.${type.toLowerCase()}` as TranslationKey),
          ]),
        )}
        statusLabels={Object.fromEntries(
          requestStatuses.map((status) => [
            status,
            translate(locale, `privacy.status.${status.toLowerCase()}` as TranslationKey),
          ]),
        )}
        holdStatusLabels={Object.fromEntries(
          ['ACTIVE', 'RELEASED'].map((status) => [
            status,
            translate(locale, `legal_hold_status.${status.toLowerCase()}` as TranslationKey),
          ]),
        )}
        labels={{
          dueAt: translate(locale, 'admin.privacy.due_at'),
          activeHolds: translate(locale, 'admin.privacy.active_holds'),
          targetStatus: translate(locale, 'admin.privacy.target_status'),
          decisionReason: translate(locale, 'admin.privacy.decision_reason'),
          executionReport: translate(locale, 'admin.privacy.execution_report'),
          update: translate(locale, 'admin.privacy.update'),
          legalHolds: translate(locale, 'admin.privacy.legal_holds'),
          holdReason: translate(locale, 'admin.privacy.hold_reason'),
          placeHold: translate(locale, 'admin.privacy.place_hold'),
          releaseReason: translate(locale, 'admin.privacy.release_reason'),
          releaseHold: translate(locale, 'admin.privacy.release_hold'),
        }}
        canManage={employee.permissions.includes('privacy:case:manage')}
        canManageHolds={employee.permissions.includes('retention:hold:manage')}
      />
    </>
  );
}
