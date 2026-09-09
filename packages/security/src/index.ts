import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import argon2 from 'argon2';
import { authenticator } from 'otplib';

const totpVerifier = authenticator.clone({ window: [1, 0] });

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 14) throw new Error('PASSWORD_TOO_SHORT');
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 1,
  });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function generateTotpSecret(): string {
  return authenticator.generateSecret(32);
}

export function verifyTotp(secret: string, token: string): boolean {
  return totpVerifier.check(token.replaceAll(' ', ''), secret);
}

export function generateTotpCode(secret: string): string {
  return authenticator.generate(secret);
}

export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function encryptionKey(secret: string): Buffer {
  if (secret.length < 16) throw new Error('ENCRYPTION_KEY_TOO_SHORT');
  return createHash('sha256').update(secret).digest();
}

export function encryptSecret(value: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

export function decryptSecret(value: string, secret: string): string {
  const [version, iv, tag, encrypted] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !encrypted) throw new Error('INVALID_ENCRYPTED_SECRET');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(secret),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  const prefix = local.slice(0, Math.min(2, local.length));
  return `${prefix}${'*'.repeat(Math.max(3, local.length - prefix.length))}@${domain}`;
}

export function maskPhone(phone: string): string {
  if (phone.length <= 4) return '*'.repeat(phone.length);
  return `${phone.slice(0, 3)}${'*'.repeat(phone.length - 5)}${phone.slice(-2)}`;
}

export function sanitizeFileName(value: string, fallback = 'download'): string {
  const leaf = value.replaceAll('\\', '/').split('/').at(-1)?.normalize('NFKC') ?? '';
  const cleaned = [...leaf]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 32 && codePoint !== 127 && character !== '"';
    })
    .join('')
    .trim()
    .slice(0, 255);
  return cleaned || fallback;
}

export function attachmentContentDisposition(value: string): string {
  const safe = sanitizeFileName(value);
  const asciiFallback = safe.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
