import { NextRequest, NextResponse } from 'next/server';
import { googleCalendarOAuthConfigured } from '../../../../lib/calendar/config';
import {
  selectCalendarConnection,
  toPublicConnectionStatus,
} from '../../../../lib/calendar/connections';
import {
  calendarUserFromBearer,
  createCalendarAdminClient,
} from '../../../../lib/calendar/serverAuth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const user = await calendarUserFromBearer(request.headers.get('authorization'));
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const configured = googleCalendarOAuthConfigured();
  const admin = createCalendarAdminClient();
  if (!configured || !admin) {
    return NextResponse.json({
      configured: false,
      ...toPublicConnectionStatus(null),
    });
  }

  const row = await selectCalendarConnection(admin, user.id);
  return NextResponse.json({
    configured: true,
    ...toPublicConnectionStatus(row),
  });
}
