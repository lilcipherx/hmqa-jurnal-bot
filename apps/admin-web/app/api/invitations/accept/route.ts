import { NextResponse } from 'next/server';
import { internalApiUrl } from '../../../../lib/api';

export async function POST(request: Request) {
  const response = await fetch(internalApiUrl('/api/v1/auth/invitations/accept'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: await request.text(),
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  });
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { 'content-type': 'application/json' },
  });
}
