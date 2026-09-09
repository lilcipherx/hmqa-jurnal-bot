import { describe, expect, it, vi } from 'vitest';
import { HmqaApiClient } from './api-client.js';

describe('HMQA internal API client', () => {
  it('authenticates service calls and validates responses', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ claimed: true, correlationId: '64d4ef2c-418a-4d9c-a519-33c0abca8d9b' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    const client = new HmqaApiClient('http://api.test/', 'service-secret', fetcher);
    await expect(client.claimUpdate(42)).resolves.toEqual({
      claimed: true,
      correlationId: '64d4ef2c-418a-4d9c-a519-33c0abca8d9b',
    });
    const [, init] = fetcher.mock.calls[0]!;
    expect(new Headers(init?.headers).get('x-hmqa-service-secret')).toBe('service-secret');
    expect(init?.body).toBe(JSON.stringify({ updateId: '42' }));
  });
});
