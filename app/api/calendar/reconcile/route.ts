import { NextRequest, NextResponse } from 'next/server';
import { reconcileUserCalendar } from '../../../../lib/calendar/reconcile';
import { createLiveReconcileStore } from '../../../../lib/calendar/projectionStore';
import { calendarUserFromBearer } from '../../../../lib/calendar/serverAuth';

export const runtime = 'nodejs';

/**
 * Canonical per-user Calendar reconcile. Does not enable sync.
 * Does not accept a browser-supplied user id as authority.
 */
export async function POST(request: NextRequest) {
  const user = await calendarUserFromBearer(request.headers.get('authorization'));
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  await request.json().catch(() => ({}));

  const store = createLiveReconcileStore();
  if (!store) {
    return NextResponse.json({
      result: 'not_connected',
      projected: 0,
      updated: 0,
      withdrawn: 0,
      noop: 0,
      errors: 0,
    });
  }

  const summary = await reconcileUserCalendar({
    actorUserId: user.id,
    store,
  });
  return NextResponse.json(summary);
}
