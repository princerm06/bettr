import type { SupabaseClient } from '@supabase/supabase-js';
import { isPersistedDedicatedCalendarId } from './destination';

export type CalendarConnectionRow = {
  user_id: string;
  sync_enabled: boolean;
  google_sub: string | null;
  google_email: string | null;
  calendar_id: string;
  refresh_token_ciphertext: string;
  granted_scopes: string;
  connected_at: string;
  updated_at: string;
  last_reconcile_at: string | null;
  last_error: string | null;
};

export type CalendarConnectionStatus = {
  connected: boolean;
  googleEmail: string | null;
  syncEnabled: boolean;
  hasDedicatedCalendar: boolean;
  connectedAt: string | null;
  lastError: string | null;
};

export function toPublicConnectionStatus(
  row: CalendarConnectionRow | null
): CalendarConnectionStatus {
  if (!row) {
    return {
      connected: false,
      googleEmail: null,
      syncEnabled: false,
      hasDedicatedCalendar: false,
      connectedAt: null,
      lastError: null,
    };
  }
  return {
    connected: true,
    googleEmail: row.google_email,
    syncEnabled: row.sync_enabled,
    hasDedicatedCalendar: isPersistedDedicatedCalendarId(row.calendar_id),
    connectedAt: row.connected_at,
    lastError: row.last_error,
  };
}

export async function selectCalendarConnection(
  admin: SupabaseClient,
  userId: string
): Promise<CalendarConnectionRow | null> {
  const { data, error } = await admin
    .from('google_calendar_connections')
    .select(
      'user_id, sync_enabled, google_sub, google_email, calendar_id, refresh_token_ciphertext, granted_scopes, connected_at, updated_at, last_reconcile_at, last_error'
    )
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return data as CalendarConnectionRow;
}

export async function upsertCalendarConnection(
  admin: SupabaseClient,
  row: {
    userId: string;
    googleSub: string | null;
    googleEmail: string | null;
    refreshTokenCiphertext: string;
    grantedScopes: string;
  }
): Promise<string | null> {
  const now = new Date().toISOString();
  const existing = await selectCalendarConnection(admin, row.userId);
  if (existing) {
    const { error } = await admin
      .from('google_calendar_connections')
      .update({
        google_sub: row.googleSub,
        google_email: row.googleEmail,
        refresh_token_ciphertext: row.refreshTokenCiphertext,
        granted_scopes: row.grantedScopes,
        updated_at: now,
      })
      .eq('user_id', row.userId);
    return error?.message ?? null;
  }
  const { error } = await admin.from('google_calendar_connections').insert({
    user_id: row.userId,
    sync_enabled: false,
    google_sub: row.googleSub,
    google_email: row.googleEmail,
    calendar_id: 'primary',
    refresh_token_ciphertext: row.refreshTokenCiphertext,
    granted_scopes: row.grantedScopes,
    connected_at: now,
    updated_at: now,
    last_error: null,
  });
  return error?.message ?? null;
}

export async function updateCalendarDestination(
  admin: SupabaseClient,
  userId: string,
  calendarId: string
): Promise<string | null> {
  const { error } = await admin
    .from('google_calendar_connections')
    .update({
      calendar_id: calendarId,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
  return error?.message ?? null;
}

export async function updateCalendarSyncEnabled(
  admin: SupabaseClient,
  userId: string,
  options: { syncEnabled: boolean; lastError?: string | null }
): Promise<string | null> {
  const patch: {
    sync_enabled: boolean;
    updated_at: string;
    last_error?: string | null;
  } = {
    sync_enabled: options.syncEnabled,
    updated_at: new Date().toISOString(),
  };
  if (options.lastError !== undefined) {
    patch.last_error = options.lastError;
  }
  const { error } = await admin
    .from('google_calendar_connections')
    .update(patch)
    .eq('user_id', userId);
  return error?.message ?? null;
}

export async function deleteCalendarConnection(
  admin: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { error } = await admin
    .from('google_calendar_connections')
    .delete()
    .eq('user_id', userId);
  return error?.message ?? null;
}

export async function updateCalendarReconcileMeta(
  admin: SupabaseClient,
  userId: string,
  meta: { lastReconcileAt: string; lastError: string | null }
): Promise<string | null> {
  const { error } = await admin
    .from('google_calendar_connections')
    .update({
      last_reconcile_at: meta.lastReconcileAt,
      last_error: meta.lastError,
      updated_at: meta.lastReconcileAt,
    })
    .eq('user_id', userId);
  return error?.message ?? null;
}
