import { describe, expect, it } from 'vitest';
import { loadConfig } from './index.js';

const base = {
  NODE_ENV: 'test',
  APP_BASE_URL: 'http://localhost:3001',
  ADMIN_BASE_URL: 'http://localhost:3000',
  BOT_BASE_URL: 'http://localhost:3002',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/hmqa',
  REDIS_URL: 'redis://localhost:6379/0',
  TELEGRAM_BOT_TOKEN: 'test-token',
  TELEGRAM_WEBHOOK_SECRET: 'test-secret',
  PUBLIC_BOT_USERNAME: 'hmqa_test_bot',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'hmqa-private',
  S3_ACCESS_KEY: 'test-key',
  S3_SECRET_KEY: 'test-secret',
  SERVICE_AUTH_SECRET: 'test-service',
  SESSION_SECRET: 'test-session',
  ENCRYPTION_KEY: 'test-encryption',
} satisfies NodeJS.ProcessEnv;

describe('environment validation', () => {
  it('loads a complete test configuration', () => {
    expect(loadConfig(base).DEFAULT_LOCALE).toBe('uz-Latn');
  });

  it('normalizes blank optional URL variables to absent values', () => {
    const config = loadConfig({
      ...base,
      API_INTERNAL_URL: '',
      OTEL_EXPORTER_OTLP_ENDPOINT: '   ',
    });
    expect(config.API_INTERNAL_URL).toBeUndefined();
    expect(config.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
  });

  it('accepts a private service URL independently from the public HTTPS URL', () => {
    expect(loadConfig({ ...base, API_INTERNAL_URL: 'http://api:3001' }).API_INTERNAL_URL).toBe(
      'http://api:3001',
    );
  });

  it('fails production with placeholder secrets or HTTP public URLs', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(
      'Invalid environment configuration',
    );
  });

  it('accepts complete non-placeholder production configuration', () => {
    expect(
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        DEPLOYED_SHA: 'a'.repeat(40),
        APP_BASE_URL: 'https://api.hmqa.uz',
        ADMIN_BASE_URL: 'https://jurnal.hmqa.uz',
        BOT_BASE_URL: 'https://bot.hmqa.uz',
        DATABASE_URL: 'postgresql://hmqa:strong-password@db.internal:5432/hmqa',
        REDIS_URL: 'rediss://hmqa:strong-password@redis.internal:6379/0',
        TELEGRAM_BOT_TOKEN: `123456:${'A'.repeat(32)}`,
        TELEGRAM_WEBHOOK_SECRET: 'w'.repeat(32),
        S3_ENDPOINT: 'https://objects.internal',
        S3_ACCESS_KEY: 'hmqa-production-access',
        S3_SECRET_KEY: 's'.repeat(32),
        SERVICE_AUTH_SECRET: 'a'.repeat(32),
        SESSION_SECRET: 'b'.repeat(32),
        ENCRYPTION_KEY: 'c'.repeat(32),
        METRICS_TOKEN: 'm'.repeat(32),
      }).NODE_ENV,
    ).toBe('production');
  });

  it.each(['TELEGRAM_BOT_TOKEN', 'DATABASE_URL', 'REDIS_URL', 'S3_ENDPOINT', 'S3_ACCESS_KEY'])(
    'rejects a production placeholder in %s',
    (name) => {
      const production = {
        ...base,
        NODE_ENV: 'production',
        APP_BASE_URL: 'https://api.hmqa.uz',
        ADMIN_BASE_URL: 'https://jurnal.hmqa.uz',
        BOT_BASE_URL: 'https://bot.hmqa.uz',
        DATABASE_URL: 'postgresql://hmqa:strong-password@db.internal:5432/hmqa',
        REDIS_URL: 'rediss://hmqa:strong-password@redis.internal:6379/0',
        TELEGRAM_BOT_TOKEN: `123456:${'A'.repeat(32)}`,
        TELEGRAM_WEBHOOK_SECRET: 'w'.repeat(32),
        S3_ENDPOINT: 'https://objects.internal',
        S3_ACCESS_KEY: 'hmqa-production-access',
        S3_SECRET_KEY: 's'.repeat(32),
        SERVICE_AUTH_SECRET: 'a'.repeat(32),
        SESSION_SECRET: 'b'.repeat(32),
        ENCRYPTION_KEY: 'c'.repeat(32),
        METRICS_TOKEN: 'm'.repeat(32),
        [name]: 'replace-with-production-value',
      };
      expect(() => loadConfig(production)).toThrow(name);
    },
  );

  it('requires an exact deployed Git SHA outside development and test', () => {
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: 'staging',
        DEPLOYED_SHA: 'development',
        APP_BASE_URL: 'https://api.hmqa.uz',
        ADMIN_BASE_URL: 'https://jurnal.hmqa.uz',
        BOT_BASE_URL: 'https://bot.hmqa.uz',
        DATABASE_URL: 'postgresql://hmqa:strong-password@db.internal:5432/hmqa',
        REDIS_URL: 'rediss://hmqa:strong-password@redis.internal:6379/0',
        TELEGRAM_BOT_TOKEN: `123456:${'A'.repeat(32)}`,
        TELEGRAM_WEBHOOK_SECRET: 'w'.repeat(32),
        S3_ENDPOINT: 'https://objects.internal',
        S3_ACCESS_KEY: 'hmqa-production-access',
        S3_SECRET_KEY: 's'.repeat(32),
        SERVICE_AUTH_SECRET: 'a'.repeat(32),
        SESSION_SECRET: 'b'.repeat(32),
        ENCRYPTION_KEY: 'c'.repeat(32),
        METRICS_TOKEN: 'm'.repeat(32),
      }),
    ).toThrow('DEPLOYED_SHA');
  });

  it('requires Redis authentication outside development and test', () => {
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: 'staging',
        DEPLOYED_SHA: 'a'.repeat(40),
        APP_BASE_URL: 'https://api.hmqa.uz',
        ADMIN_BASE_URL: 'https://jurnal.hmqa.uz',
        BOT_BASE_URL: 'https://bot.hmqa.uz',
        DATABASE_URL: 'postgresql://hmqa:strong-password@db.internal:5432/hmqa',
        REDIS_URL: 'redis://redis.internal:6379/0',
        TELEGRAM_BOT_TOKEN: `123456:${'A'.repeat(32)}`,
        TELEGRAM_WEBHOOK_SECRET: 'w'.repeat(32),
        S3_ENDPOINT: 'https://objects.internal',
        S3_ACCESS_KEY: 'hmqa-production-access',
        S3_SECRET_KEY: 's'.repeat(32),
        SERVICE_AUTH_SECRET: 'a'.repeat(32),
        SESSION_SECRET: 'b'.repeat(32),
        ENCRYPTION_KEY: 'c'.repeat(32),
        METRICS_TOKEN: 'm'.repeat(32),
      }),
    ).toThrow('REDIS_URL');
  });

  it('enforces the Telegram cloud download ceiling', () => {
    expect(() => loadConfig({ ...base, FILE_MAX_BYTES: String(20 * 1024 * 1024) })).toThrow(
      'FILE_MAX_BYTES',
    );
  });
});
