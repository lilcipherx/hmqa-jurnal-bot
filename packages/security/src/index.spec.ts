import { describe, expect, it } from 'vitest';
import {
  attachmentContentDisposition,
  constantTimeEqual,
  decryptSecret,
  encryptSecret,
  hashOpaqueToken,
  maskEmail,
  maskPhone,
  sanitizeFileName,
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
