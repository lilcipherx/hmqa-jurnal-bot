import { NextResponse } from 'next/server';
import { internalApiUrl } from '../../../../lib/api';

function setCookieHeaders(headers: Headers): string[] {
  const extendedHeaders = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof extendedHeaders.getSetCookie === 'function') return extendedHeaders.getSetCookie();
  const value = headers.get('set-cookie');
  return value ? [value] : [];
}

function isSecureRequest(request: Request): boolean {
  const forwardedProtocol = request.headers
    .get('x-forwarded-proto')
    ?.split(',', 1)[0]
    ?.trim()
    .toLowerCase();
  return (forwardedProtocol ?? new URL(request.url).protocol.replace(':', '')) === 'https';
}

export async function POST(request: Request) {
  const response = await fetch(internalApiUrl('/api/v1/auth/login'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: await request.text(),
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  });
  const body = await response.text();
  const result = new NextResponse(body, {
    status: response.status,
    headers: { 'content-type': 'application/json' },
  });
  if (response.ok) {
    const parsed = JSON.parse(body) as { csrfToken?: unknown };
    if (typeof parsed.csrfToken === 'string') {
      result.cookies.set('hmqa_csrf', parsed.csrfToken, {
        httpOnly: true,
        secure: isSecureRequest(request),
        sameSite: 'strict',
        path: '/',
        maxAge: 8 * 60 * 60,
      });
    }
  }
  // NextResponse.cookies.set() rewrites its managed Set-Cookie header. Append upstream
  // cookies afterwards so the API session cookie cannot be replaced by the BFF CSRF cookie.
  for (const setCookie of setCookieHeaders(response.headers)) {
    result.headers.append('set-cookie', setCookie);
  }
  return result;
}
