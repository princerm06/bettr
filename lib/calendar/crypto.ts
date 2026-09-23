/**
 * Authenticated encryption for Calendar OAuth secrets.
 * Server-only. Never import from client components or lib/planning.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

export const GOOGLE_TOKEN_CIPHER_VERSION = 'v1';

const IV_LENGTH = 12;
const KEY_LENGTH = 32;

export class CalendarCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalendarCryptoError';
  }
}

export function parseGoogleTokenEncryptionKey(
  raw: string | undefined
): Buffer | null {
  if (!raw || !raw.trim()) return null;
  const value = raw.trim();

  const hex = Buffer.from(value, 'hex');
  if (value.length === KEY_LENGTH * 2 && hex.length === KEY_LENGTH) return hex;

  const b64 = Buffer.from(value, 'base64');
  if (b64.length === KEY_LENGTH) return b64;

  const utf8 = Buffer.from(value, 'utf8');
  if (utf8.length === KEY_LENGTH) return utf8;

  return null;
}

export function loadGoogleTokenEncryptionKey(
  raw: string | undefined = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY
): Buffer {
  const key = parseGoogleTokenEncryptionKey(raw);
  if (!key) {
    throw new CalendarCryptoError(
      'Calendar encryption is not configured.'
    );
  }
  return key;
}

export function encryptSecret(
  plaintext: string,
  key = loadGoogleTokenEncryptionKey()
): string {
  if (!plaintext) {
    throw new CalendarCryptoError('Nothing to encrypt.');
  }
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    GOOGLE_TOKEN_CIPHER_VERSION,
    iv.toString('base64url'),
    encrypted.toString('base64url'),
    tag.toString('base64url'),
  ].join('.');
}

export function decryptSecret(
  ciphertext: string,
  key = loadGoogleTokenEncryptionKey()
): string {
  if (!ciphertext || typeof ciphertext !== 'string') {
    throw new CalendarCryptoError('Invalid ciphertext.');
  }
  const parts = ciphertext.split('.');
  if (parts.length !== 4 || parts[0] !== GOOGLE_TOKEN_CIPHER_VERSION) {
    throw new CalendarCryptoError('Unsupported ciphertext.');
  }
  try {
    const iv = Buffer.from(parts[1], 'base64url');
    const encrypted = Buffer.from(parts[2], 'base64url');
    const tag = Buffer.from(parts[3], 'base64url');
    if (iv.length !== IV_LENGTH || tag.length !== 16 || encrypted.length < 1) {
      throw new Error('bad lengths');
    }
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new CalendarCryptoError('Ciphertext could not be decrypted.');
  }
}
