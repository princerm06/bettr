import { NextRequest, NextResponse } from 'next/server';
import { createLiveSyncLifecycleStore } from '../../../../lib/calendar/projectionStore';
import { calendarUserFromBearer } from '../../../../lib/calendar/serverAuth';
import { disconnectCalendarSync } from '../../../../lib/calendar/syncLifecycle';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const user = await calendarUserFromBearer(request.headers.get('authorization'));
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const store = createLiveSyncLifecycleStore();
  if (!store) {
    return NextResponse.json(
      { error: 'Google Calendar is not configured.' },
      { status: 503 }
    );
  }

  const outcome = await disconnectCalendarSync({
    actorUserId: user.id,
    store,
  });
  if (outcome.result !== 'disconnected') {
    return NextResponse.json(
      { error: outcome.reason || 'Could not disconnect Google Calendar.' },
      { status: 500 }
    );
  }
  return NextResponse.json({
    ok: true,
    connected: false,
    withdrawn: outcome.withdrawn,
    cleanupErrors: outcome.cleanupErrors,
  });
}
