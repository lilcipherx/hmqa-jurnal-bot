import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';

function contentSecurityPolicy(forwardedProtocol: 'http' | 'https') {
  const response = proxy(
    new NextRequest('http://admin-web.test/login', {
      headers: { 'x-forwarded-proto': forwardedProtocol },
    }),
  );
  return response.headers.get('content-security-policy') ?? '';
}

describe('admin content security policy', () => {
  it('does not upgrade the HTTP requests used by the isolated browser test stack', () => {
    expect(contentSecurityPolicy('http')).not.toContain('upgrade-insecure-requests');
  });

  it('keeps request upgrades enabled for the external HTTPS deployment', () => {
    expect(contentSecurityPolicy('https')).toContain('upgrade-insecure-requests');
  });
});
