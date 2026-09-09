import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { internalApiUrl } from '../../../../lib/api';

export async function POST() {
  const token = (await cookies()).get('hmqa_session')?.value;
  const csrf = (await cookies()).get('hmqa_csrf')?.value;
  if (token && csrf)
    await fetch(internalApiUrl('/api/v1/auth/logout'), {
      method: 'POST',
      headers: {
        cookie: `hmqa_session=${encodeURIComponent(token)}`,
        'x-csrf-token': csrf,
        origin: process.env.ADMIN_BASE_URL ?? 'http://localhost:3000',
      },
      signal: AbortSignal.timeout(12_000),
    });
  const response = NextResponse.json({ ok: true });
  response.cookies.delete('hmqa_session');
  response.cookies.delete('hmqa_csrf');
  return response;
}
