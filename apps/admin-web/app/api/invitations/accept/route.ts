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
  const body = await response.text();
  return new NextResponse(body || null, {
    status: response.status,
    ...(body ? { headers: { 'content-type': 'application/json' } } : {}),
  });
}
