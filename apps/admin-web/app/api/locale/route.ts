import { NextResponse } from 'next/server';
import { normalizeLocale } from '@hmqa/i18n';

function isSecureRequest(request: Request): boolean {
  const forwardedProtocol = request.headers
    .get('x-forwarded-proto')
    ?.split(',', 1)[0]
    ?.trim()
    .toLowerCase();
  return (forwardedProtocol ?? new URL(request.url).protocol.replace(':', '')) === 'https';
}

export function GET(request: Request) {
  const url = new URL(request.url);
  const locale = normalizeLocale(url.searchParams.get('locale') ?? undefined);
  const destination = url.searchParams.get('return');
  const safeDestination =
    destination?.startsWith('/') && !destination.startsWith('//') && !destination.includes('\\')
      ? destination
      : '/dashboard';
  // request.url may contain a container listener such as 0.0.0.0:3000 behind a reverse proxy.
  // A relative Location keeps the browser on the public origin without trusting forwarded hosts.
  const response = new NextResponse(null, {
    status: 303,
    headers: { location: safeDestination },
  });
  response.cookies.set('hmqa_locale', locale, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isSecureRequest(request),
    maxAge: 365 * 24 * 60 * 60,
    path: '/',
  });
  return response;
}
