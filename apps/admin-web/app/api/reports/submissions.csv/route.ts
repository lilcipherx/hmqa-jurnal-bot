import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { internalApiUrl } from '../../../../lib/api';

export async function GET() {
  const token = (await cookies()).get('hmqa_session')?.value;
  if (!token) return NextResponse.json({ code: 'UNAUTHENTICATED' }, { status: 401 });
  const response = await fetch(internalApiUrl('/api/v1/admin/reports/submissions.csv'), {
    headers: { cookie: `hmqa_session=${encodeURIComponent(token)}` },
    cache: 'no-store',
  });
  return new NextResponse(await response.arrayBuffer(), {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') ?? 'text/csv',
      'content-disposition':
        response.headers.get('content-disposition') ?? 'attachment; filename="submissions.csv"',
    },
  });
}
