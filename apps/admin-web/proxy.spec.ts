import { afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  Object.defineProperty(process.env, 'NODE_ENV', {
    configurable: true,
    enumerable: true,
    value: originalNodeEnv,
    writable: true,
  });
});

function contentSecurityPolicy(nodeEnv: string) {
  Object.defineProperty(process.env, 'NODE_ENV', {
    configurable: true,
    enumerable: true,
    value: nodeEnv,
    writable: true,
  });
  const response = proxy(new NextRequest('http://admin-web.test/login'));
  return response.headers.get('content-security-policy') ?? '';
}

describe('admin content security policy', () => {
  it('does not upgrade the HTTP requests used by the isolated browser test stack', () => {
    expect(contentSecurityPolicy('test')).not.toContain('upgrade-insecure-requests');
  });

  it('enforces HTTPS request upgrades in production', () => {
    expect(contentSecurityPolicy('production')).toContain('upgrade-insecure-requests');
  });
});
