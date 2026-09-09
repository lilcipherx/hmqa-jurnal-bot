import pino, { type LoggerOptions } from 'pino';

const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body',
  'res.headers.set-cookie',
  'token',
  '*.token',
  'password',
  '*.password',
  'secret',
  '*.secret',
  'email',
  '*.email',
  'phone',
  '*.phone',
  'manuscript',
  '*.manuscript',
];

export function serializeHttpRequest(value: unknown) {
  if (!value || typeof value !== 'object') return {};
  const request = value as { id?: unknown; method?: unknown; url?: unknown };
  return {
    ...(typeof request.id === 'string' ? { id: request.id } : {}),
    ...(typeof request.method === 'string' ? { method: request.method } : {}),
    ...(typeof request.url === 'string' ? { path: request.url.split('?', 1)[0] } : {}),
  };
}

function serializeHttpResponse(value: unknown) {
  if (!value || typeof value !== 'object') return {};
  const response = value as { statusCode?: unknown };
  return typeof response.statusCode === 'number' ? { statusCode: response.statusCode } : {};
}

export function createLogger(
  service: string,
  environment: string,
  level = 'info',
  options: LoggerOptions = {},
) {
  return pino({
    ...options,
    name: service,
    level,
    base: { service, environment },
    redact: { paths: redactPaths, censor: '[REDACTED]' },
    serializers: {
      ...options.serializers,
      req: serializeHttpRequest,
      res: serializeHttpResponse,
      err: pino.stdSerializers.err,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
