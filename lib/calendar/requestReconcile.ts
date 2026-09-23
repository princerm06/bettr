/**
 * Client orchestration after a successful Bettr planning mutation.
 * Does not import reconcile/Google transport — keeps the planning UI bundle
 * free of Calendar server modules.
 * Never imported from lib/planning. Failure is swallowed.
 */
import { supabase } from '../supabase';

async function postCalendarReconcileBestEffort(): Promise<void> {
  try {
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    await fetch('/api/calendar/reconcile', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
  } catch {
    // Planning already succeeded. Connection errors stay in Calendar settings.
  }
}

/** Fire-and-forget. Does not accept a browser-supplied user id. */
export function requestCalendarReconcileAfterPlanning(): void {
  void postCalendarReconcileBestEffort();
}
