import { loadConfig } from '@hmqa/config';
import { createLogger } from '@hmqa/logger';
import { constantTimeEqual } from '@hmqa/security';
import Fastify from 'fastify';
import * as Sentry from '@sentry/node';
import { z } from 'zod';
import { HmqaApiClient } from './api-client.js';
import { botCommands, createBot } from './bot.js';

const config = loadConfig();
if (config.SENTRY_DSN)
  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: config.NODE_ENV === 'production' ? 0.1 : 0,
  });
const logger = createLogger('bot', config.NODE_ENV, config.LOG_LEVEL);
const app = Fastify({ loggerInstance: logger, trustProxy: true, bodyLimit: 1_048_576 });
const apiBaseUrl = config.API_INTERNAL_URL ?? config.APP_BASE_URL;
const api = new HmqaApiClient(apiBaseUrl, config.SERVICE_AUTH_SECRET);
const bot = createBot(config.TELEGRAM_BOT_TOKEN, api, config.BOT_API_BASE_URL);
const telegramUpdateSchema = z.object({ update_id: z.number().int().nonnegative() }).passthrough();

app.get('/health/live', () => ({ status: 'ok', version: config.DEPLOYED_SHA }));
app.get('/health/ready', async (_request, reply) => {
  try {
    const [, apiResponse] = await Promise.all([
      bot.api.getMe(),
      fetch(new URL('/health/ready', apiBaseUrl), {
        signal: AbortSignal.timeout(5_000),
      }),
    ]);
    if (!apiResponse.ok) throw new Error('API_NOT_READY');
    return { status: 'ready', telegram: 'ok', api: 'ok' };
  } catch {
    return reply.code(503).send({ status: 'not_ready' });
  }
});

app.post('/telegram/webhook', async (request, reply) => {
  const supplied = request.headers['x-telegram-bot-api-secret-token'];
  if (typeof supplied !== 'string' || !constantTimeEqual(supplied, config.TELEGRAM_WEBHOOK_SECRET))
    return reply.code(401).send();
  const parsed = telegramUpdateSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ code: 'INVALID_TELEGRAM_UPDATE' });
  await bot.handleUpdate(parsed.data);
  return reply.code(204).send();
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'graceful shutdown');
  await app.close();
  await bot.stop();
  await Sentry.flush(2_000);
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await bot.init();
await Promise.all([
  bot.api.setMyCommands(botCommands('uz-Latn')),
  bot.api.setMyCommands(botCommands('uz-Latn'), { language_code: 'uz' }),
  bot.api.setMyCommands(botCommands('ru'), { language_code: 'ru' }),
  bot.api.setMyCommands(botCommands('en'), { language_code: 'en' }),
]);
if (config.NODE_ENV === 'production' || config.NODE_ENV === 'staging') {
  await bot.api.setWebhook(new URL('/telegram/webhook', config.BOT_BASE_URL).toString(), {
    secret_token: config.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false,
  });
}
await app.listen({ host: '0.0.0.0', port: config.PORT ?? 3002 });
