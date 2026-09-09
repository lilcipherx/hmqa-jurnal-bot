export const queueNames = {
  fileIngest: 'hmqa-file-ingest',
  documents: 'hmqa-documents',
  notifications: 'hmqa-notifications',
  maintenance: 'hmqa-maintenance',
} as const;

export const jobNames = {
  ingestTelegramFile: 'ingest-telegram-file',
  generateSubmissionReceipt: 'generate-submission-receipt',
  deliverTelegramNotification: 'deliver-telegram-notification',
  relayOutbox: 'relay-notification-outbox',
  expireDrafts: 'expire-drafts',
} as const;

export const queueDefaults = {
  attempts: 7,
  backoff: { type: 'exponential' as const, delay: 2_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 5_000 },
  removeOnFail: false,
} as const;

export function redisConnectionFromUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:')
    throw new Error('REDIS_URL_PROTOCOL_UNSUPPORTED');
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(url.pathname.length > 1 ? { db: Number(url.pathname.slice(1)) } : {}),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}
