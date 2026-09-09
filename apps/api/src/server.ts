import { loadConfig } from '@hmqa/config';
import { createPrismaClient } from '@hmqa/database';
import { Redis } from 'ioredis';
import * as Sentry from '@sentry/node';
import { createApp } from './app.js';

const config = loadConfig();
if (config.SENTRY_DSN)
  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: config.NODE_ENV === 'production' ? 0.1 : 0,
  });
const database = createPrismaClient(config.DATABASE_URL);
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2, enableReadyCheck: true });
const app = await createApp({ config, database, redis });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'graceful shutdown');
  await app.close();
  await redis.quit();
  await database.$disconnect();
  await Sentry.flush(2_000);
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: '0.0.0.0', port: config.PORT ?? 3001 });
