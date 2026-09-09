import type { DatabaseClient, Notification } from '@hmqa/database';
import { formatMessage, translate, type Locale, type TranslationKey } from '@hmqa/i18n';
import { UnrecoverableError, type Job } from 'bullmq';
import { z } from 'zod';

const telegramResponse = z.object({
  ok: z.boolean(),
  result: z.object({ message_id: z.number().int() }).optional(),
  description: z.string().optional(),
});

function locale(value: 'uz_Latn' | 'ru' | 'en'): Locale {
  return value === 'uz_Latn' ? 'uz-Latn' : value;
}

async function render(notification: Notification, database: DatabaseClient): Promise<string> {
  const snapshot = notification.templateSnapshot;
  if (
    typeof snapshot !== 'object' ||
    !snapshot ||
    Array.isArray(snapshot) ||
    typeof snapshot.key !== 'string'
  )
    throw new UnrecoverableError('NOTIFICATION_TEMPLATE_INVALID');
  const variables = notification.variables;
  const escaped: Record<string, string> = {};
  if (typeof variables === 'object' && variables && !Array.isArray(variables)) {
    for (const [key, value] of Object.entries(variables)) {
      const rendered =
        typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : (JSON.stringify(value) ?? '');
      escaped[key] = rendered;
    }
  }
  if ('message' in snapshot && typeof snapshot.message === 'string') {
    return formatMessage(snapshot.message, escaped);
  }
  const custom = await database.translationKey.findUnique({
    where: { key: snapshot.key },
    select: {
      versions: {
        where: { locale: notification.locale, state: 'PUBLISHED' },
        orderBy: { version: 'desc' },
        take: 1,
        select: { version: true, message: true },
      },
    },
  });
  const version = custom?.versions[0];
  if (version) {
    await database.notification.update({
      where: { id: notification.id },
      data: {
        templateVersion: `db-v${version.version}`,
        templateSnapshot: { key: snapshot.key, message: version.message, version: version.version },
      },
    });
    return formatMessage(version.message, escaped);
  }
  return translate(locale(notification.locale), snapshot.key as TranslationKey, escaped);
}

export function createNotificationProcessor(
  token: string,
  apiBaseUrl: string,
  database: DatabaseClient,
) {
  return async (job: Job<{ notificationId: string }>) => {
    const notification = await database.notification.findUnique({
      where: { id: job.data.notificationId },
      include: { user: true },
    });
    if (!notification) throw new UnrecoverableError('NOTIFICATION_NOT_FOUND');
    if (notification.status === 'SENT')
      return { alreadySent: true, providerMessageId: notification.providerMessageId };
    if (!notification.user.telegramChatId)
      throw new UnrecoverableError('TELEGRAM_CHAT_NOT_AVAILABLE');
    const claimed = await database.notification.updateMany({
      where: { id: notification.id, status: { in: ['PENDING', 'RETRYING', 'FAILED'] } },
      data: { status: 'PROCESSING', attempts: { increment: 1 }, lastErrorCode: null },
    });
    if (claimed.count !== 1) {
      if (notification.status === 'PROCESSING') throw new Error('NOTIFICATION_ALREADY_PROCESSING');
      return { skipped: true };
    }
    try {
      const response = await fetch(`${apiBaseUrl}/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: notification.user.telegramChatId.toString(),
          text: await render(notification, database),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const result = telegramResponse.parse(await response.json());
      if (!response.ok || !result.ok || !result.result) {
        const permanent =
          response.status >= 400 && response.status < 500 && response.status !== 429;
        throw permanent
          ? new UnrecoverableError(`TELEGRAM_${response.status}`)
          : new Error(`TELEGRAM_${response.status}`);
      }
      await database.notification.update({
        where: { id: notification.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          providerMessageId: String(result.result.message_id),
          providerResult: { ok: true },
        },
      });
      return { providerMessageId: String(result.result.message_id) };
    } catch (error) {
      const exhausted = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      const terminal = error instanceof UnrecoverableError || exhausted;
      await database.notification.update({
        where: { id: notification.id },
        data: {
          status: terminal ? 'DEAD_LETTER' : 'RETRYING',
          lastErrorCode: error instanceof Error ? error.message.slice(0, 100) : 'UNKNOWN',
          nextAttemptAt: terminal
            ? null
            : new Date(Date.now() + Math.min(60 * 60_000, 2_000 * 2 ** job.attemptsMade)),
        },
      });
      throw error;
    }
  };
}
