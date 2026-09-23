import { NextRequest, NextResponse } from 'next/server';
import { googleCalendarOAuthSettings } from '../../../../../lib/calendar/config';
import {
  selectCalendarConnection,
  upsertCalendarConnection,
} from '../../../../../lib/calendar/connections';
import { encryptSecret } from '../../../../../lib/calendar/crypto';
import {
  exchangeGoogleAuthorizationCode,
  googleIdentityFromIdToken,
} from '../../../../../lib/calendar/googleOAuth';
import {
  OAUTH_COOKIE_NAME,
  bindOAuthCallback,
  parseOAuthHandshake,
} from '../../../../../lib/calendar/oauth';
import { createCalendarAdminClient } from '../../../../../lib/calendar/serverAuth';

export const runtime = 'nodejs';

function appOrigin(redirectUri: string): string {
  try {
    return new URL(redirectUri).origin;
  } catch {
    return '';
  }
}

function redirectHome(origin: string, result: 'connected' | 'error') {
  const url = `${origin || '/'}?gcal=${result}`;
  const response = NextResponse.redirect(url);
  response.cookies.set({
    name: OAUTH_COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}

export async function GET(request: NextRequest) {
  const settings = googleCalendarOAuthSettings();
  const origin = settings ? appOrigin(settings.redirectUri) : '';
  const fail = () => redirectHome(origin, 'error');

  if (!settings) return fail();

  const googleError = request.nextUrl.searchParams.get('error');
  if (googleError) return fail();

  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const handshake = parseOAuthHandshake(
    request.cookies.get(OAUTH_COOKIE_NAME)?.value
  );
  const bound = bindOAuthCallback({
    handshake,
    returnedState: state,
  });
  if (!bound.ok || !code) return fail();

  const admin = createCalendarAdminClient();
  if (!admin) return fail();

  try {
    const tokens = await exchangeGoogleAuthorizationCode({
      code,
      codeVerifier: bound.handshake.codeVerifier,
      clientId: settings.clientId,
      clientSecret: settings.clientSecret,
      redirectUri: settings.redirectUri,
    });

    const existing = await selectCalendarConnection(admin, bound.handshake.userId);
    let ciphertext = existing?.refresh_token_ciphertext ?? null;
    if (tokens.refresh_token) {
      ciphertext = encryptSecret(tokens.refresh_token);
    }
    if (!ciphertext) return fail();

    const identity = googleIdentityFromIdToken(tokens.id_token);
    const error = await upsertCalendarConnection(admin, {
      userId: bound.handshake.userId,
      googleSub: identity.sub,
      googleEmail: identity.email,
      refreshTokenCiphertext: ciphertext,
      grantedScopes: tokens.scope || '',
    });
    if (error) return fail();
    return redirectHome(origin, 'connected');
  } catch {
    return fail();
  }
}
