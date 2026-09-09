import process from 'node:process';
import { URL } from 'node:url';

const webhook = new URL(
  '/telegram/webhook',
  process.env.BOT_BASE_URL ?? 'http://bot:3002',
).toString();
const statsUrl = `${process.env.BOT_API_BASE_URL}/__test/stats`;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
if (!secret) throw new Error('TELEGRAM_WEBHOOK_SECRET is required');

async function status(responsePromise, expected, label) {
  const response = await responsePromise;
  if (response.status !== expected)
    throw new Error(`${label}: expected ${expected}, received ${response.status}`);
  return response;
}

async function stats() {
  return (await (await status(globalThis.fetch(statsUrl), 200, 'fixture stats')).json())
    .methodCounts;
}

const headers = {
  'content-type': 'application/json',
  'x-telegram-bot-api-secret-token': secret,
};
const body = {
  update_id: 910_000_001,
  message: {
    message_id: 1,
    date: Math.floor(Date.now() / 1000),
    chat: { id: 9_100_000_001, type: 'private' },
    from: { id: 9_100_000_001, is_bot: false, first_name: 'Runtime' },
    text: '/start',
    entities: [{ offset: 0, length: 6, type: 'bot_command' }],
  },
};

const before = await stats();
await status(
  globalThis.fetch(webhook, { method: 'POST', headers, body: JSON.stringify(body) }),
  204,
  'first /start update',
);
const afterFirst = await stats();
if ((afterFirst.sendMessage ?? 0) <= (before.sendMessage ?? 0))
  throw new Error('First Telegram update produced no user response');
await status(
  globalThis.fetch(webhook, { method: 'POST', headers, body: JSON.stringify(body) }),
  204,
  'duplicate /start update',
);
const afterDuplicate = await stats();
if ((afterDuplicate.sendMessage ?? 0) !== (afterFirst.sendMessage ?? 0))
  throw new Error('Duplicate Telegram update produced a duplicate user response');
await status(
  globalThis.fetch(webhook, { method: 'POST', headers, body: '{}' }),
  400,
  'invalid Telegram update',
);
await status(
  globalThis.fetch(webhook, {
    method: 'POST',
    headers: { ...headers, 'x-telegram-bot-api-secret-token': 'invalid' },
    body: JSON.stringify(body),
  }),
  401,
  'invalid Telegram webhook secret',
);

process.stdout.write('telegram runtime probe: webhook security and idempotency passed\n');
