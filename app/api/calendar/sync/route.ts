import { NextRequest, NextResponse } from 'next/server';
import {
  disableCalendarSync,
  enableCalendarSync,
} from '../../../../lib/calendar/syncLifecycle';
import { createLiveSyncLifecycleStore } from '../../../../lib/calendar/projectionStore';
import { calendarUserFromBearer } from '../../../../lib/calendar/serverAuth';

export const runtime = 'nodejs';

function publicEnable(result: Awaited<ReturnType<typeof enableCalendarSync>>) {
  return {
    result: result.result,
    syncEnabled: result.syncEnabled,
    createdDestination: result.createdDestination,
    reconcile: result.reconcile
      ? {
          result: result.reconcile.result,
          projected: result.reconcile.projected,
          updated: result.reconcile.updated,
          withdrawn: result.reconcile.withdrawn,
          noop: result.reconcile.noop,
          errors: result.reconcile.errors,
        }
      : null,
    reason: result.reason ?? null,
  };
}

function publicDisable(result: Awaited<ReturnType<typeof disableCalendarSync>>) {
  return {
    result: result.result,
    syncEnabled: result.syncEnabled,
    withdrawn: result.withdrawn,
    cleanupErrors: result.cleanupErrors,
    reason: result.reason ?? null,
  };
}

export async function POST(request: NextRequest) {
  const user = await calendarUserFromBearer(request.headers.get('authorization'));
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    enabled?: unknown;
    userId?: unknown;
  };
  void body.userId;

  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'Sync setting is required.' }, { status: 400 });
  }

  const store = createLiveSyncLifecycleStore();
  if (!store) {
    return NextResponse.json(
      { error: 'Google Calendar is not configured.' },
      { status: 503 }
    );
  }

  if (body.enabled) {
    const outcome = await enableCalendarSync({
      actorUserId: user.id,
      store,
    });
    const status =
      outcome.result === 'not_connected'
        ? 409
        : outcome.result === 'destination_failed' || outcome.result === 'error'
          ? 502
          : 200;
    return NextResponse.json(publicEnable(outcome), { status });
  }

  const outcome = await disableCalendarSync({
    actorUserId: user.id,
    store,
  });
  return NextResponse.json(publicDisable(outcome));
}
