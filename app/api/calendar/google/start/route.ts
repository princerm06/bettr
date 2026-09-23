import { NextRequest, NextResponse } from 'next/server';
import { googleCalendarOAuthSettings } from '../../../../../lib/calendar/config';
import {
  OAUTH_COOKIE_MAX_AGE_SECONDS,
  OAUTH_COOKIE_NAME,
  buildGoogleAuthorizeUrl,
  createOAuthHandshake,
  pkceChallengeS256,
  serializeOAuthHandshake,
} from '../../../../../lib/calendar/oauth';
import { calendarUserFromBearer } from '../../../../../lib/calendar/serverAuth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const settings = googleCalendarOAuthSettings();
  if (!settings) {
    return NextResponse.json(
      { error: 'Google Calendar is not configured.' },
      { status: 503 }
    );
  }

  const user = await calendarUserFromBearer(request.headers.get('authorization'));
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  let handshake;
  try {
    handshake = createOAuthHandshake(user.id);
  } catch {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const authorizeUrl = buildGoogleAuthorizeUrl({
    clientId: settings.clientId,
    redirectUri: settings.redirectUri,
    state: handshake.nonce,
    codeChallenge: pkceChallengeS256(handshake.codeVerifier),
  });

  const response = NextResponse.json({ url: authorizeUrl });
  response.cookies.set({
    name: OAUTH_COOKIE_NAME,
    value: serializeOAuthHandshake(handshake),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: OAUTH_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}
