import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((value) => value === 'true');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    DEPLOYED_SHA: z
      .string()
      .regex(/^(?:development|[a-f0-9]{40})$/)
      .default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    APP_TIMEZONE: z.string().default('Asia/Tashkent'),
    DEFAULT_LOCALE: z.enum(['uz-Latn', 'ru', 'en']).default('uz-Latn'),
    SUPPORTED_LOCALES: z.literal('uz-Latn,ru,en').default('uz-Latn,ru,en'),
    APP_BASE_URL: z.url(),
    ADMIN_BASE_URL: z.url(),
    BOT_BASE_URL: z.url(),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.url(),
    TELEGRAM_BOT_TOKEN: z.string().min(1),
    TELEGRAM_WEBHOOK_SECRET: z.string().min(1),
    PUBLIC_BOT_USERNAME: z.string().regex(/^[A-Za-z0-9_]{5,}$/),
    BOT_API_BASE_URL: z.url().default('https://api.telegram.org'),
    S3_ENDPOINT: z.url(),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
    S3_QUARANTINE_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/)
      .default('hmqa-quarantine'),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: bool.default(true),
    SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),
    SERVICE_AUTH_SECRET: z.string().min(1),
    CLAMAV_HOST: z.string().min(1).default('clamav'),
    CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
    SESSION_SECRET: z.string().min(1),
    ENCRYPTION_KEY: z.string().min(1),
    FILE_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .max(19 * 1024 * 1024)
      .default(19 * 1024 * 1024),
    FILE_QUARANTINE_DIR: z.string().min(1).default('/var/lib/hmqa/quarantine'),
    FILE_SCAN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(120_000),
    RECEIPT_FONT_PATH: z.string().min(1).default('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'),
    LIBREOFFICE_PATH: z.string().min(1).default('soffice'),
    PREFLIGHT_RENDER_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(300_000).default(60_000),
    LOCAL_AUTH_PRODUCTION_ENABLED: bool.default(false),
    SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(240).default(30),
    SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(48).default(12),
    METRICS_TOKEN: z.string().min(1).default('development-only'),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
    SENTRY_DSN: z.union([z.literal(''), z.url()]).optional(),
    RETENTION_DRAFT_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
    RETENTION_ENABLED: bool.default(false),
    PRIVACY_REQUEST_DUE_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    PORT: z.coerce.number().int().min(1).max(65535).optional(),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === 'production' || value.NODE_ENV === 'staging') {
      if (!/^[a-f0-9]{40}$/.test(value.DEPLOYED_SHA)) {
        context.addIssue({
          code: 'custom',
          path: ['DEPLOYED_SHA'],
          message: 'must be the exact 40-character Git SHA outside development/test',
        });
      }
      const placeholderPattern = /replace-with|changeme|test-only|example\.invalid/i;
      for (const [name, secret] of [
        ['TELEGRAM_WEBHOOK_SECRET', value.TELEGRAM_WEBHOOK_SECRET],
        ['SESSION_SECRET', value.SESSION_SECRET],
        ['ENCRYPTION_KEY', value.ENCRYPTION_KEY],
        ['S3_SECRET_KEY', value.S3_SECRET_KEY],
        ['SERVICE_AUTH_SECRET', value.SERVICE_AUTH_SECRET],
        ['METRICS_TOKEN', value.METRICS_TOKEN],
      ] as const) {
        if (secret.length < 32 || placeholderPattern.test(secret)) {
          context.addIssue({
            code: 'custom',
            path: [name],
            message: 'must be at least 32 non-placeholder characters outside development/test',
          });
        }
      }
      for (const [name, credential] of [
        ['TELEGRAM_BOT_TOKEN', value.TELEGRAM_BOT_TOKEN],
        ['DATABASE_URL', value.DATABASE_URL],
        ['REDIS_URL', value.REDIS_URL],
        ['S3_ENDPOINT', value.S3_ENDPOINT],
        ['S3_ACCESS_KEY', value.S3_ACCESS_KEY],
      ] as const) {
        if (placeholderPattern.test(credential) || credential === 'hmqa-local') {
          context.addIssue({
            code: 'custom',
            path: [name],
            message: 'must not contain a development/test placeholder outside development/test',
          });
        }
      }
      if (!/^\d{6,12}:[A-Za-z0-9_-]{20,}$/.test(value.TELEGRAM_BOT_TOKEN)) {
        context.addIssue({
          code: 'custom',
          path: ['TELEGRAM_BOT_TOKEN'],
          message: 'must have Telegram Bot API token format',
        });
      }
      for (const [name, url] of [
        ['APP_BASE_URL', value.APP_BASE_URL],
        ['ADMIN_BASE_URL', value.ADMIN_BASE_URL],
        ['BOT_BASE_URL', value.BOT_BASE_URL],
      ] as const) {
        if (!url.startsWith('https://')) {
          context.addIssue({ code: 'custom', path: [name], message: 'must use HTTPS' });
        }
      }
      if (value.S3_BUCKET === value.S3_QUARANTINE_BUCKET) {
        context.addIssue({
          code: 'custom',
          path: ['S3_QUARANTINE_BUCKET'],
          message: 'must be separate from the clean-file bucket',
        });
      }
      let redisPassword = '';
      try {
        redisPassword = new URL(value.REDIS_URL).password;
      } catch {
        // The base URL validator reports malformed values; keep refinement fail-safe.
      }
      if (!redisPassword) {
        context.addIssue({
          code: 'custom',
          path: ['REDIS_URL'],
          message: 'must include a Redis password outside development/test',
        });
      }
    }
  });

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = schema.safeParse(environment);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n${fields.join('\n')}`);
  }
  return Object.freeze(result.data);
}
