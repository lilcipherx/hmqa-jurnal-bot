import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { internalApiUrl } from '../../../../../../lib/api';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const store = await cookies();
  const session = store.get('hmqa_session')?.value;
  const csrf = store.get('hmqa_csrf')?.value;
  if (!session || !csrf) return NextResponse.json({ code: 'UNAUTHENTICATED' }, { status: 401 });
  const { id } = await params;
  const response = await fetch(
    internalApiUrl(`/api/v1/admin/employees/${encodeURIComponent(id)}/totp/reset`),
    {
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
    },
  );
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { 'content-type': 'application/json' },
  });
}
