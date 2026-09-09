import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { internalApiUrl } from '../../../../../lib/api';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get('hmqa_session')?.value;
  if (!token) return NextResponse.json({ code: 'UNAUTHENTICATED' }, { status: 401 });
  const { id } = await params;
  const response = await fetch(
    internalApiUrl(`/api/v1/admin/files/${encodeURIComponent(id)}/download`),
    {
      headers: { cookie: `hmqa_session=${encodeURIComponent(token)}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (!response.ok)
    return new NextResponse(await response.text(), {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    });
  const result = (await response.json()) as { url: string };
  return NextResponse.redirect(result.url, 303);
}
