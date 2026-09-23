import { NextRequest, NextResponse } from 'next/server';
import {
  deleteCalendarConnection,
  selectCalendarConnection,
} from '../../../../lib/calendar/connections';
import { decryptSecret } from '../../../../lib/calendar/crypto';
import { revokeGoogleToken } from '../../../../lib/calendar/googleOAuth';
import {
  calendarUserFromBearer,
  createCalendarAdminClient,
} from '../../../../lib/calendar/serverAuth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const user = await calendarUserFromBearer(request.headers.get('authorization'));
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const admin = createCalendarAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: 'Google Calendar is not configured.' },
      { status: 503 }
    );
  }

  const row = await selectCalendarConnection(admin, user.id);
  if (row) {
    try {
      const refresh = decryptSecret(row.refresh_token_ciphertext);
      await revokeGoogleToken(refresh);
    } catch {
      // Local disconnect still proceeds.
    }
  }

  const error = await deleteCalendarConnection(admin, user.id);
  if (error) {
    return NextResponse.json({ error: 'Could not disconnect Google Calendar.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, connected: false });
}
