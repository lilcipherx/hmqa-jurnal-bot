import { NextResponse } from 'next/server';
import { internalApiUrl } from '../../../../lib/api';

export async function POST(request: Request) {
  const response = await fetch(internalApiUrl('/api/v1/auth/login'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: await request.text(),
    cache: 'no-store',
  });
  const body = await response.text();
  const result = new NextResponse(body, {
    status: response.status,
    headers: { 'content-type': 'application/json' },
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) result.headers.set('set-cookie', setCookie);
  if (response.ok) {
    const parsed = JSON.parse(body) as { csrfToken?: unknown };
    if (typeof parsed.csrfToken === 'string') {
      result.cookies.set('hmqa_csrf', parsed.csrfToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: 8 * 60 * 60,
      });
    }
  }
  return result;
}
