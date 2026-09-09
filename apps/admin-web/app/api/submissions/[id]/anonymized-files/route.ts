import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { internalApiUrl } from '../../../../../lib/api';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const store = await cookies();
  const token = store.get('hmqa_session')?.value;
  const csrf = store.get('hmqa_csrf')?.value;
  if (!token || !csrf) return NextResponse.json({ code: 'UNAUTHENTICATED' }, { status: 401 });
  const contentType = request.headers.get('content-type');
  if (!contentType?.toLowerCase().startsWith('multipart/form-data'))
    return NextResponse.json({ code: 'INVALID_CONTENT_TYPE' }, { status: 415 });
  const { id } = await params;
  const response = await fetch(
    internalApiUrl(`/api/v1/admin/submissions/${encodeURIComponent(id)}/anonymized-files`),
    {
      method: 'POST',
      headers: {
        'content-type': contentType,
        cookie: `hmqa_session=${encodeURIComponent(token)}`,
        'x-csrf-token': csrf,
        'x-anonymization-attested': request.headers.get('x-anonymization-attested') ?? '',
        origin: process.env.ADMIN_BASE_URL ?? 'http://localhost:3000',
      },
      body: request.body,
      duplex: 'half',
      signal: AbortSignal.timeout(60_000),
    } as RequestInit & { duplex: 'half' },
  );
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
  });
}
