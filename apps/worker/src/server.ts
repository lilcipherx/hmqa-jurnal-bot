import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { loadConfig } from '@hmqa/config';
import { createPrismaClient } from '@hmqa/database';
import { createLogger } from '@hmqa/logger';
import { jobNames, queueDefaults, queueNames, redisConnectionFromUrl } from '@hmqa/shared';
import { Queue, Worker } from 'bullmq';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import { Counter, Gauge, Registry, collectDefaultMetrics } from 'prom-client';
import * as Sentry from '@sentry/node';
import { pingClamAv } from './clamav.js';
import { createFileProcessor } from './file-processor.js';
import { createNotificationProcessor } from './notification-processor.js';
import { createReceiptProcessor } from './receipt-processor.js';

const config = loadConfig();
if (config.SENTRY_DSN)
  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: config.NODE_ENV === 'production' ? 0.1 : 0,
  });
const database = createPrismaClient(config.DATABASE_URL);
const connection = redisConnectionFromUrl(config.REDIS_URL);
const s3 = new S3Client({
  endpoint: config.S3_ENDPOINT,
  region: config.S3_REGION,
  forcePathStyle: config.S3_FORCE_PATH_STYLE,
  credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
});
const logger: FastifyBaseLogger = createLogger('worker', config.NODE_ENV, config.LOG_LEVEL);
const fileQueue = new Queue(queueNames.fileIngest, {
  connection,
  defaultJobOptions: queueDefaults,
});
const notificationQueue = new Queue(queueNames.notifications, {
  connection,
  defaultJobOptions: queueDefaults,
});
const documentQueue = new Queue(queueNames.documents, {
  connection,
  defaultJobOptions: queueDefaults,
});
const maintenanceQueue = new Queue(queueNames.maintenance, {
  connection,
  defaultJobOptions: { ...queueDefaults, attempts: 3 },
});
const fileWorker = new Worker(queueNames.fileIngest, createFileProcessor(config, database, s3), {
  connection,
  concurrency: 2,
  lockDuration: config.FILE_SCAN_TIMEOUT_MS + 60_000,
});
const notificationWorker = new Worker(
  queueNames.notifications,
  createNotificationProcessor(config.TELEGRAM_BOT_TOKEN, config.BOT_API_BASE_URL, database),
  { connection, concurrency: 8 },
);
const documentWorker = new Worker(
  queueNames.documents,
  createReceiptProcessor(config, database, s3),
  { connection, concurrency: 2 },
);

async function relayOutbox() {
  // Recover a worker that died between the database claim and provider response.
  // Telegram delivery remains at-least-once; the event id is the durable idempotency key.
  await database.notification.updateMany({
    where: {
      status: 'PROCESSING',
      updatedAt: { lte: new Date(Date.now() - 5 * 60_000) },
    },
    data: {
      status: 'RETRYING',
      nextAttemptAt: new Date(),
      lastErrorCode: 'STALE_PROCESSING_LEASE',
    },
  });
  await database.submissionReceipt.updateMany({
    where: {
      status: 'PROCESSING',
      updatedAt: { lte: new Date(Date.now() - 10 * 60_000) },
    },
    data: { status: 'PENDING', failureCode: 'STALE_PROCESSING_LEASE' },
  });
  const [notifications, files, receipts] = await Promise.all([
    database.notification.findMany({
      where: {
        status: { in: ['PENDING', 'RETRYING'] },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      select: { id: true, eventId: true, generation: true },
      take: 500,
      orderBy: { createdAt: 'asc' },
    }),
    database.fileAsset.findMany({
      where: {
        storageStatus: { in: ['PENDING', 'QUARANTINED'] },
        scanStatus: { in: ['PENDING', 'ERROR', 'TIMEOUT'] },
      },
      select: { id: true },
      take: 100,
      orderBy: { createdAt: 'asc' },
    }),
    database.submissionReceipt.findMany({
      where: { status: 'PENDING' },
      select: { id: true },
      take: 100,
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  await Promise.all(
    notifications.map((item) =>
      notificationQueue.add(
        jobNames.deliverTelegramNotification,
        { notificationId: item.id },
        { jobId: `notification-${item.eventId}-${item.generation}` },
      ),
    ),
  );
  await Promise.all(
    files.map((item) =>
      fileQueue.add(
        jobNames.ingestTelegramFile,
        { fileAssetId: item.id },
        { jobId: `file-${item.id}` },
      ),
    ),
  );
  await Promise.all(
    receipts.map((item) =>
      documentQueue.add(
        jobNames.generateSubmissionReceipt,
        { receiptId: item.id },
        { jobId: `receipt-${item.id}` },
      ),
    ),
  );
  return {
    notifications: notifications.length,
    files: files.length,
    receipts: receipts.length,
  };
}

const maintenanceWorker = new Worker(
  queueNames.maintenance,
  async (job) => {
    if (job.name === jobNames.relayOutbox) return relayOutbox();
    if (job.name === jobNames.expireDrafts)
      return database.draft.updateMany({
        where: { expiresAt: { lt: new Date() }, deletedAt: null },
        data: { deletedAt: new Date() },
      });
    return { ignored: true };
  },
  { connection, concurrency: 1 },
);

await maintenanceQueue.upsertJobScheduler(
  'outbox-relay',
  { every: 5_000 },
  { name: jobNames.relayOutbox, data: {} },
);
await maintenanceQueue.upsertJobScheduler(
  'draft-expiry',
  { every: 60 * 60_000 },
  { name: jobNames.expireDrafts, data: {} },
);
await relayOutbox();

const metrics = new Registry();
collectDefaultMetrics({ register: metrics, prefix: 'hmqa_worker_' });
const failedJobs = new Counter({
  name: 'hmqa_worker_failed_jobs_total',
  help: 'Failed jobs by queue',
  labelNames: ['queue'],
  registers: [metrics],
});
const queueDepth = new Gauge({
  name: 'hmqa_worker_queue_depth',
  help: 'Waiting jobs by queue',
  labelNames: ['queue'],
  registers: [metrics],
});
for (const [worker, queue] of [
  [fileWorker, fileQueue],
  [notificationWorker, notificationQueue],
  [documentWorker, documentQueue],
  [maintenanceWorker, maintenanceQueue],
] as const)
  worker.on('failed', (job, error) => {
    failedJobs.inc({ queue: queue.name });
    Sentry.captureException(error, {
      tags: { service: 'worker', queue: queue.name, job: job?.name ?? 'unknown' },
    });
  });

const app = Fastify({ loggerInstance: logger });
app.get('/health/live', () => ({ status: 'ok' }));
app.get('/health/ready', async (_request, reply) => {
  try {
    await Promise.all([
      database.$queryRaw`SELECT 1`,
      fileQueue.getJobCounts(),
      documentQueue.getJobCounts(),
      s3.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET })),
      s3.send(new HeadBucketCommand({ Bucket: config.S3_QUARANTINE_BUCKET })),
    ]);
    const clamav = await pingClamAv(config.CLAMAV_HOST, config.CLAMAV_PORT);
    if (!clamav) throw new Error('CLAMAV_NOT_READY');
    return { status: 'ready', database: 'ok', redis: 'ok', storage: 'ok', antivirus: 'ok' };
  } catch {
    return reply.code(503).send({ status: 'not_ready' });
  }
});
app.get('/metrics', async (_request, reply) => {
  const [fileCounts, notificationCounts, documentCounts] = await Promise.all([
    fileQueue.getJobCounts('waiting', 'delayed'),
    notificationQueue.getJobCounts('waiting', 'delayed'),
    documentQueue.getJobCounts('waiting', 'delayed'),
  ]);
  queueDepth.set({ queue: fileQueue.name }, (fileCounts.waiting ?? 0) + (fileCounts.delayed ?? 0));
  queueDepth.set(
    { queue: notificationQueue.name },
    (notificationCounts.waiting ?? 0) + (notificationCounts.delayed ?? 0),
  );
  queueDepth.set(
    { queue: documentQueue.name },
    (documentCounts.waiting ?? 0) + (documentCounts.delayed ?? 0),
  );
  reply.header('content-type', metrics.contentType);
  return metrics.metrics();
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'graceful shutdown');
  await app.close();
  await Promise.all([
    fileWorker.close(),
    notificationWorker.close(),
    documentWorker.close(),
    maintenanceWorker.close(),
  ]);
  await Promise.all([
    fileQueue.close(),
    notificationQueue.close(),
    documentQueue.close(),
    maintenanceQueue.close(),
  ]);
  s3.destroy();
  await database.$disconnect();
  await Sentry.flush(2_000);
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
await app.listen({ host: '0.0.0.0', port: config.PORT ?? 3003 });
