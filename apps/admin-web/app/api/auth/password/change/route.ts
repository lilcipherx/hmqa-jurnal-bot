import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { internalApiUrl } from '../../../../../lib/api';

export async function POST(request: Request) {
  const store = await cookies();
  const session = store.get('hmqa_session')?.value;
  const csrf = store.get('hmqa_csrf')?.value;
  if (!session || !csrf) return NextResponse.json({ code: 'UNAUTHENTICATED' }, { status: 401 });
  const response = await fetch(internalApiUrl('/api/v1/auth/password/change'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `hmqa_session=${encodeURIComponent(session)}`,
      'x-csrf-token': csrf,
      origin: process.env.ADMIN_BASE_URL ?? 'http://localhost:3000',
    },
    body: await request.text(),
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  });
  const body = await response.text();
  const result = new NextResponse(body || null, {
    status: response.status,
    ...(body ? { headers: { 'content-type': 'application/json' } } : {}),
  });
  if (response.ok) {
    result.cookies.delete('hmqa_session');
    result.cookies.delete('hmqa_csrf');
  }
  return result;
}
