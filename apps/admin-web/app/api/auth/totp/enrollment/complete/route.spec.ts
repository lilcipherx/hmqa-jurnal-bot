import { cookies } from 'next/headers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

vi.mock('next/headers', () => ({ cookies: vi.fn() }));

describe('TOTP enrollment completion BFF', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('preserves session and enrollment Set-Cookie headers while adding CSRF', async () => {
    vi.stubEnv('API_INTERNAL_URL', 'http://api.test:3001');
    vi.stubEnv('ADMIN_BASE_URL', 'https://admin.test');
    vi.mocked(cookies).mockResolvedValue({
      get: (name: string) =>
        name === 'hmqa_totp_enrollment' ? { value: 'test-enrollment-token' } : undefined,
    } as never);
    const upstreamHeaders = new Headers({ 'content-type': 'application/json' });
    upstreamHeaders.append(
      'set-cookie',
      'hmqa_session=test-session; Max-Age=43200; Path=/; HttpOnly; Secure; SameSite=Strict',
    );
    upstreamHeaders.append(
      'set-cookie',
      'hmqa_totp_enrollment=; Max-Age=0; Path=/api/auth/totp; HttpOnly; Secure; SameSite=Strict',
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
      new Request('https://admin.test/api/auth/totp/enrollment/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https' },
        body: JSON.stringify({ totp: '000000' }),
      }),
    );

    expect(response.status).toBe(200);
    const setCookies = response.headers.getSetCookie();
    expect(setCookies).toHaveLength(3);
    expect(setCookies.filter((value) => value.startsWith('hmqa_session='))).toHaveLength(1);
    expect(setCookies.filter((value) => value.startsWith('hmqa_csrf='))).toHaveLength(1);
    expect(setCookies.filter((value) => value.startsWith('hmqa_totp_enrollment='))).toHaveLength(1);
    for (const cookie of setCookies) {
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Secure/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
    }
  });
});
