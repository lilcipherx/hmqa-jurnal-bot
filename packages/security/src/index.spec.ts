import { describe, expect, it } from 'vitest';
import { authenticator } from 'otplib';
import {
  attachmentContentDisposition,
  constantTimeEqual,
  decryptSecret,
  encryptSecret,
  generateTotpSecret,
  hashOpaqueToken,
  maskEmail,
  maskPhone,
  sanitizeFileName,
  verifyTotp,
} from './index.js';

describe('security helpers', () => {
  it('hashes opaque tokens deterministically without retaining the token', () => {
    const hash = hashOpaqueToken('secret-token');
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain('secret-token');
    expect(constantTimeEqual(hash, hashOpaqueToken('secret-token'))).toBe(true);
  });

  it('masks contact data', () => {
    expect(maskEmail('person@example.com')).toBe('pe****@example.com');
    expect(maskPhone('+998901234567')).toBe('+99********67');
  });

  it('encrypts authenticated secret material', () => {
    const encrypted = encryptSecret('TOTP-SECRET', 'test-encryption-key-material');
    expect(encrypted).not.toContain('TOTP-SECRET');
    expect(decryptSecret(encrypted, 'test-encryption-key-material')).toBe('TOTP-SECRET');
    expect(() => decryptSecret(encrypted, 'wrong-encryption-key-material')).toThrow();
  });

  it('accepts only the current or immediately previous TOTP time window', () => {
    const secret = generateTotpSecret();
    const currentWindowStart = Math.floor(Date.now() / 30_000) * 30_000;
    const previousCode = authenticator.clone({ epoch: currentWindowStart - 1 }).generate(secret);
    const expiredCode = authenticator
      .clone({ epoch: currentWindowStart - 30_001 })
      .generate(secret);

    expect(verifyTotp(secret, previousCode)).toBe(true);
    expect(verifyTotp(secret, expiredCode)).toBe(false);
  });

  it('neutralizes traversal and header injection in untrusted filenames', () => {
    expect(sanitizeFileName('../private/article.pdf')).toBe('article.pdf');
    expect(sanitizeFileName('..\\private\\article.pdf')).toBe('article.pdf');
    expect(sanitizeFileName('../../\r\nX-Evil: yes".pdf')).toBe('X-Evil: yes.pdf');
    const header = attachmentContentDisposition('../статья"\r\nX-Evil: yes.pdf');
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).not.toContain('../');
    expect(header).toContain("filename*=UTF-8''");
  });
});
