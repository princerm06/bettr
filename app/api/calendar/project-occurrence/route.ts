import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '../../../../lib/calendar/oauth';
import { projectOccurrence } from '../../../../lib/calendar/projection';
import { createLiveProjectionStore } from '../../../../lib/calendar/projectionStore';
import { calendarUserFromBearer } from '../../../../lib/calendar/serverAuth';

export const runtime = 'nodejs';

/**
 * Manual Slice 2 test surface. Not a planning hook.
 * Does not require sync_enabled.
 */
export async function POST(request: NextRequest) {
  const user = await calendarUserFromBearer(request.headers.get('authorization'));
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    occurrenceId?: unknown;
  };

  if (!isUuid(body.occurrenceId)) {
    return NextResponse.json(
      { result: 'error', reason: 'Provide a valid occurrenceId.' },
      { status: 400 }
    );
  }

  const store = createLiveProjectionStore();
  if (!store) {
    return NextResponse.json({ result: 'not_connected' });
  }

  const outcome = await projectOccurrence({
    actorUserId: user.id,
    occurrenceId: body.occurrenceId,
    store,
    mode: 'manual',
  });

  const status = outcome.result === 'denied' ? 403 : 200;
  return NextResponse.json(
    {
      result: outcome.result,
      googleEventId: outcome.googleEventId ?? null,
      reason: outcome.reason ?? null,
    },
    { status }
  );
}
