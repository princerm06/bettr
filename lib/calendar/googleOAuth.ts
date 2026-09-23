/**
 * Google OAuth token HTTP. No Calendar event APIs.
 */
export type GoogleTokenResponse = {
  refresh_token?: string;
  access_token?: string;
  id_token?: string;
  scope?: string;
  expires_in?: number;
  token_type?: string;
};

function formBody(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

export async function exchangeGoogleAuthorizationCode(options: {
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<GoogleTokenResponse> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody({
      grant_type: 'authorization_code',
      code: options.code,
      code_verifier: options.codeVerifier,
      client_id: options.clientId,
      client_secret: options.clientSecret,
      redirect_uri: options.redirectUri,
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as GoogleTokenResponse & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error('Google Calendar could not be connected.');
  }
  return payload;
}

export function googleIdentityFromIdToken(idToken: string | undefined): {
  sub: string | null;
  email: string | null;
} {
  if (!idToken) return { sub: null, email: null };
  const parts = idToken.split('.');
  if (parts.length < 2) return { sub: null, email: null };
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(json) as { sub?: unknown; email?: unknown };
    return {
      sub: typeof payload.sub === 'string' ? payload.sub : null,
      email: typeof payload.email === 'string' ? payload.email : null,
    };
  } catch {
    return { sub: null, email: null };
  }
}

export async function revokeGoogleToken(token: string): Promise<boolean> {
  if (!token) return false;
  try {
    const response = await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody({ token }),
    });
    return response.ok || response.status === 400;
  } catch {
    return false;
  }
}
