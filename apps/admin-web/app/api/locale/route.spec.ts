import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

describe('admin locale BFF', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('uses a same-origin relative redirect behind an internal reverse-proxy listener', () => {
    vi.stubEnv('NODE_ENV', 'production');

    const response = GET(
      new Request('http://0.0.0.0:3000/api/locale?locale=uz-Latn&return=/dashboard'),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/dashboard');
    expect(response.headers.get('location')).not.toContain('0.0.0.0');
    const localeCookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith('hmqa_locale='));
    expect(localeCookie).toMatch(/^hmqa_locale=uz-Latn;/);
    expect(localeCookie).toMatch(/Path=\//i);
    expect(localeCookie).toMatch(/HttpOnly/i);
    expect(localeCookie).toMatch(/Secure/i);
    expect(localeCookie).toMatch(/SameSite=strict/i);
  });

  it.each(['//evil.example/path', '/\\evil.example/path', 'https://evil.example/path'])(
    'rejects unsafe return target %s',
    (destination) => {
      const requestUrl = new URL('http://admin-web.test/api/locale');
      requestUrl.searchParams.set('locale', 'ru');
      requestUrl.searchParams.set('return', destination);

      const response = GET(new Request(requestUrl));

      expect(response.headers.get('location')).toBe('/dashboard');
    },
  );
});
