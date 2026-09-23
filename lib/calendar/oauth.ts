/**
 * Google Calendar OAuth helpers (PKCE + encrypted cookie binding).
 * Does not talk to Google by itself.
 */
import { createHash, randomBytes } from 'crypto';
import { decryptSecret, encryptSecret } from './crypto';

export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'openid',
  'email',
] as const;

export const OAUTH_COOKIE_NAME = 'bettr_gcal_oauth';
export const OAUTH_COOKIE_MAX_AGE_SECONDS = 10 * 60;
export const OAUTH_STATE_TTL_MS = OAUTH_COOKIE_MAX_AGE_SECONDS * 1000;

export type OAuthHandshake = {
  userId: string;
  nonce: string;
  codeVerifier: string;
  expiresAt: number;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function generatePkceVerifier(): string {
  return randomBytes(32).toString('base64url');
}

export function pkceChallengeS256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function generateOAuthNonce(): string {
  return randomBytes(24).toString('base64url');
}

export function createOAuthHandshake(userId: string, now = Date.now()): OAuthHandshake {
  if (!isUuid(userId)) {
    throw new Error('Sign in to connect Google Calendar.');
  }
  return {
    userId,
    nonce: generateOAuthNonce(),
    codeVerifier: generatePkceVerifier(),
    expiresAt: now + OAUTH_STATE_TTL_MS,
  };
}

export function serializeOAuthHandshake(handshake: OAuthHandshake): string {
  return encryptSecret(JSON.stringify(handshake));
}

export function parseOAuthHandshake(
  ciphertext: string | undefined,
  now = Date.now()
): OAuthHandshake | null {
  if (!ciphertext) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decryptSecret(ciphertext));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (!isUuid(record.userId)) return null;
  if (typeof record.nonce !== 'string' || record.nonce.length < 16) return null;
  if (typeof record.codeVerifier !== 'string' || record.codeVerifier.length < 32) {
    return null;
  }
  if (typeof record.expiresAt !== 'number' || record.expiresAt <= now) return null;
  return {
    userId: record.userId,
    nonce: record.nonce,
    codeVerifier: record.codeVerifier,
    expiresAt: record.expiresAt,
  };
}

/**
 * Bind the Google callback to the Bettr user who started OAuth.
 * Ignores any user id from query strings.
 */
export function bindOAuthCallback(options: {
  handshake: OAuthHandshake | null;
  returnedState: string | null;
}): { ok: true; handshake: OAuthHandshake } | { ok: false; error: string } {
  if (!options.handshake) {
    return { ok: false, error: 'Calendar connect expired. Try again from Bettr.' };
  }
  if (!options.returnedState || options.returnedState !== options.handshake.nonce) {
    return { ok: false, error: 'Calendar connect could not be verified.' };
  }
  if (!isUuid(options.handshake.userId)) {
    return { ok: false, error: 'Calendar connect could not be verified.' };
  }
  return { ok: true, handshake: options.handshake };
}

export function buildGoogleAuthorizeUrl(options: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes?: readonly string[];
}): string {
  const params = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    response_type: 'code',
    scope: (options.scopes ?? GOOGLE_CALENDAR_SCOPES).join(' '),
    access_type: 'offline',
    include_granted_scopes: 'false',
    prompt: 'consent',
    code_challenge: options.codeChallenge,
    code_challenge_method: 'S256',
    state: options.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}
