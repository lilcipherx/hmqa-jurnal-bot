import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import { URL, URLSearchParams } from 'node:url';

const port = Number(process.env.PORT ?? 8081);
let messageId = 1000;
const methodCounts = {};

function send(response, statusCode, body) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_048_576) throw new Error('REQUEST_TOO_LARGE');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return Object.fromEntries(new URLSearchParams(raw));
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (request.method === 'GET' && url.pathname === '/health/live') {
    return send(response, 200, { status: 'ok', fixture: 'DEV_TEST_ONLY' });
  }
  if (request.method === 'GET' && url.pathname === '/__test/stats') {
    return send(response, 200, { fixture: 'DEV_TEST_ONLY', methodCounts });
  }
  const method = /^\/bot[^/]+\/([A-Za-z][A-Za-z0-9_]*)$/.exec(url.pathname)?.[1];
  if (!method) return send(response, 404, { ok: false, error_code: 404 });
  methodCounts[method] = (methodCounts[method] ?? 0) + 1;

  let body;
  try {
    body = await readBody(request);
  } catch {
    return send(response, 413, { ok: false, error_code: 413 });
  }

  if (method === 'getMe') {
    return send(response, 200, {
      ok: true,
      result: {
        id: 123456,
        is_bot: true,
        first_name: 'HMQA Test Bot',
        username: 'hmqa_test_only_bot',
        can_join_groups: false,
        can_read_all_group_messages: false,
        supports_inline_queries: false,
      },
    });
  }
  if (method === 'sendMessage') {
    messageId += 1;
    return send(response, 200, {
      ok: true,
      result: {
        message_id: messageId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: Number(body.chat_id ?? 1), type: 'private' },
        text: String(body.text ?? ''),
      },
    });
  }
  if (method === 'getFile') {
    return send(response, 200, {
      ok: true,
      result: {
        file_id: String(body.file_id ?? 'fixture'),
        file_unique_id: 'fixture',
        file_path: 'fixture.bin',
      },
    });
  }
  if (['setMyCommands', 'setWebhook', 'deleteWebhook', 'answerCallbackQuery'].includes(method)) {
    return send(response, 200, { ok: true, result: true });
  }
  return send(response, 501, {
    ok: false,
    error_code: 501,
    description: 'TEST_METHOD_NOT_IMPLEMENTED',
  });
});

server.listen(port, '0.0.0.0', () => {
  process.stdout.write(`DEV/TEST ONLY Telegram API fixture listening on ${port}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
