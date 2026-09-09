import { translate, type TranslationKey } from '@hmqa/i18n';
import { NotificationOperations } from '../../../components/notification-operations';
import { PageHeader } from '../../../components/page-header';
import { adminFetch } from '../../../lib/api';
import { currentLocale } from '../../../lib/locale';

interface NotificationItem {
  id: string;
  eventCode: string;
  status: string;
  attempts: number;
  lastErrorCode: string | null;
  submission: { publicId: string } | null;
}

export default async function NotificationsPage() {
  const locale = await currentLocale();
  const data = await adminFetch<{ items: NotificationItem[] }>(
    '/api/v1/admin/notifications?limit=100',
  );
  return (
    <>
      <PageHeader
        title={translate(locale, 'admin.notifications.heading')}
        description={translate(locale, 'admin.notifications.description')}
      />
      <NotificationOperations
        items={data.items}
        statusLabels={Object.fromEntries(
          ['PENDING', 'PROCESSING', 'SENT', 'RETRYING', 'FAILED', 'DEAD_LETTER', 'CANCELLED'].map(
            (status) => [
              status,
              translate(locale, `notification_status.${status.toLowerCase()}` as TranslationKey),
            ],
          ),
        )}
        labels={{
          attempts: translate(locale, 'admin.notifications.attempts'),
          replay: translate(locale, 'admin.notifications.replay'),
        }}
      />
    </>
  );
}
