import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

describe('admin invitation acceptance BFF', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('forwards an empty upstream 204 without constructing an invalid response body', async () => {
    vi.stubEnv('API_INTERNAL_URL', 'http://api.test:3001');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
    );

    const response = await POST(
      new Request('https://admin.test/api/invitations/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'test-token', password: 'test-password', totp: '000000' }),
      }),
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(response.headers.has('content-type')).toBe(false);
  });

  it('preserves an upstream JSON problem response', async () => {
    vi.stubEnv('API_INTERNAL_URL', 'http://api.test:3001');
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ code: 'INVITATION_INVALID' }), {
            status: 404,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
    );

    const response = await POST(
      new Request('https://admin.test/api/invitations/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ code: 'INVITATION_INVALID' });
    expect(response.headers.get('content-type')).toBe('application/json');
  });
});
