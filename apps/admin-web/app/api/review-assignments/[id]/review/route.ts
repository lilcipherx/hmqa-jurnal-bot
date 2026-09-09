import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { internalApiUrl } from '../../../../../lib/api';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  const token = cookieStore.get('hmqa_session')?.value;
  const csrf = cookieStore.get('hmqa_csrf')?.value;
  if (!token || !csrf) return NextResponse.json({ code: 'UNAUTHENTICATED' }, { status: 401 });
  const { id } = await params;
  const response = await fetch(
    internalApiUrl(`/api/v1/admin/review-assignments/${encodeURIComponent(id)}/review`),
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `hmqa_session=${encodeURIComponent(token)}`,
        'x-csrf-token': csrf,
        origin: process.env.ADMIN_BASE_URL ?? 'http://localhost:3000',
      },
      body: await request.text(),
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000),
    },
  );
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { 'content-type': 'application/json' },
  });
}
