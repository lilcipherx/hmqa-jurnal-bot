import { NextResponse } from 'next/server';
import { normalizeLocale } from '@hmqa/i18n';

export function GET(request: Request) {
  const url = new URL(request.url);
  const locale = normalizeLocale(url.searchParams.get('locale') ?? undefined);
  const destination = url.searchParams.get('return');
  const safeDestination =
    destination?.startsWith('/') && !destination.startsWith('//') ? destination : '/dashboard';
  const response = NextResponse.redirect(new URL(safeDestination, url));
  response.cookies.set('hmqa_locale', locale, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 365 * 24 * 60 * 60,
    path: '/',
  });
  return response;
}
