import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

describe('admin login BFF', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('preserves every upstream session cookie while adding the CSRF cookie', async () => {
    vi.stubEnv('API_INTERNAL_URL', 'http://api.test:3001');
    vi.stubEnv('NODE_ENV', 'production');
    const upstreamHeaders = new Headers({ 'content-type': 'application/json' });
    upstreamHeaders.append(
      'set-cookie',
      'hmqa_session=test-session; Max-Age=43200; Path=/; HttpOnly; Secure; SameSite=Strict',
    );
    upstreamHeaders.append(
      'set-cookie',
      'upstream_marker=test-marker; Max-Age=60; Path=/; HttpOnly; Secure; SameSite=Strict',
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              sessionId: '00000000-0000-4000-8000-000000000001',
              csrfToken: 'test-csrf',
              expiresAt: '2026-09-10T00:00:00.000Z',
            }),
            { status: 200, headers: upstreamHeaders },
          ),
        ),
      ),
    );

    const response = await POST(
      new Request('https://admin.test/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'admin@example.invalid',
          password: 'test-password',
          totp: '000000',
        }),
      }),
    );

    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(3);
    expect(cookies.filter((value) => value.startsWith('hmqa_session='))).toHaveLength(1);
    expect(cookies.filter((value) => value.startsWith('hmqa_csrf='))).toHaveLength(1);
    expect(cookies.filter((value) => value.startsWith('upstream_marker='))).toHaveLength(1);
    for (const cookie of cookies) {
      expect(cookie).toMatch(/Path=\//i);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Secure/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
    }
  });
});
