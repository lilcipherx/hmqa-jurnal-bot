import { describe, expect, it } from 'vitest';
import { redisConnectionFromUrl } from './index.js';

describe('Redis connection parsing', () => {
  it('parses credentials, database and TLS without leaking the URL', () => {
    expect(redisConnectionFromUrl('rediss://worker:p%40ss@example.test:6380/7')).toEqual({
      host: 'example.test',
      port: 6380,
      username: 'worker',
      password: 'p@ss',
      db: 7,
      tls: {},
    });
  });
  it('rejects non-Redis protocols', () => {
    expect(() => redisConnectionFromUrl('https://example.test')).toThrow(
      'REDIS_URL_PROTOCOL_UNSUPPORTED',
    );
  });
});
