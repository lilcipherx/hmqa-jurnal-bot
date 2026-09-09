import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { internalApiUrl } from '../../../../../lib/api';

function setCookieHeaders(headers: Headers): string[] {
  const extendedHeaders = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof extendedHeaders.getSetCookie === 'function') return extendedHeaders.getSetCookie();
  const value = headers.get('set-cookie');
  return value ? [value] : [];
}

export async function GET() {
  const token = (await cookies()).get('hmqa_totp_enrollment')?.value;
  if (!token)
    return NextResponse.json(
      { code: 'TOTP_ENROLLMENT_INVALID', messageKey: 'admin.security.enrollment_expired' },
      { status: 401 },
    );
  const response = await fetch(internalApiUrl('/api/v1/auth/totp/enrollment'), {
    headers: { cookie: `hmqa_totp_enrollment=${encodeURIComponent(token)}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  });
  const result = new NextResponse(await response.text(), {
    status: response.status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
  for (const setCookie of setCookieHeaders(response.headers))
    result.headers.append('set-cookie', setCookie);
  return result;
}
