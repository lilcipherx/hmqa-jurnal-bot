import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, serializeHttpRequest } from './index.js';

describe('structured log minimization', () => {
  it('keeps correlation metadata but strips query strings, headers, bodies, and IPs', () => {
    expect(
      serializeHttpRequest({
        id: 'request-1',
        method: 'GET',
        url: '/api/v1/admin/submissions?search=author%40example.invalid',
        headers: { authorization: 'secret' },
        body: { email: 'author@example.invalid' },
        remoteAddress: '203.0.113.5',
      }),
    ).toEqual({
      id: 'request-1',
      method: 'GET',
      path: '/api/v1/admin/submissions',
    });
  });

  it('redacts password, TOTP, enrollment, session, and CSRF material', async () => {
    const output = new PassThrough();
    let serialized = '';
    output.on('data', (chunk: Buffer) => {
      serialized += chunk.toString('utf8');
    });
    const logger = createLogger('security-test', 'test', 'info', {}, output);
    const secrets = {
      currentPassword: 'current-password-sensitive',
      newPassword: 'new-password-sensitive',
      currentTotp: '123456',
      totp: '654321',
      totpSecret: 'BASE32SENSITIVE',
      totpSecretCipher: 'cipher-sensitive',
      csrfToken: 'csrf-sensitive',
      sessionToken: 'session-sensitive',
      enrollmentToken: 'enrollment-sensitive',
    };
    logger.info(secrets, 'security action');
    logger.flush();
    await new Promise<void>((resolve) => setImmediate(resolve));
    for (const secret of Object.values(secrets)) expect(serialized).not.toContain(secret);
    expect(serialized).toContain('[REDACTED]');
  });
});
