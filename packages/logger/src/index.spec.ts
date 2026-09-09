import { describe, expect, it } from 'vitest';
import { serializeHttpRequest } from './index.js';

describe('structured log minimization', () => {
  it('keeps correlation metadata but strips query strings, headers, bodies, and IPs', () => {
    expect(
      serializeHttpRequest({
        id: 'request-1',
        method: 'GET',
        url: '/api/v1/admin/submissions?search=author%40example.invalid',
        headers: { authorization: 'secret' },
        body: { email: 'author@example.invalid' },
        remoteAddress: '203.0.113.5',
      }),
    ).toEqual({
      id: 'request-1',
      method: 'GET',
      path: '/api/v1/admin/submissions',
    });
  });
});
