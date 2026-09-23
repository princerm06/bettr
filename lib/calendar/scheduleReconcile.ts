/**
 * Test/server helper: run per-user reconcile and never throw.
 * Planning mutations must already be committed before this is called.
 */
import { reconcileUserCalendar, type ReconcileStore, type ReconcileSummary } from './reconcile';

export async function scheduleCalendarReconcile(options: {
  actorUserId: string;
  store: ReconcileStore | null;
  now?: Date;
}): Promise<ReconcileSummary | null> {
  if (!options.store) return null;
  try {
    return await reconcileUserCalendar({
      actorUserId: options.actorUserId,
      store: options.store,
      now: options.now,
    });
  } catch {
    return null;
  }
}
