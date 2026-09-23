import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CALENDAR_LIST_PAGE_SIZE,
  loadAllCalendarPages,
  type CalendarPageResult,
} from './listPages';

export type CalendarEventLinkRow = {
  id: string;
  user_id: string;
  occurrence_id: string;
  google_event_id: string;
  calendar_id: string;
  sync_status: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export async function selectEventLinkByOccurrence(
  admin: SupabaseClient,
  occurrenceId: string
): Promise<CalendarEventLinkRow | null> {
  const { data, error } = await admin
    .from('google_calendar_event_links')
    .select(
      'id, user_id, occurrence_id, google_event_id, calendar_id, sync_status, last_error, created_at, updated_at'
    )
    .eq('occurrence_id', occurrenceId)
    .maybeSingle();
  if (error || !data) return null;
  return data as CalendarEventLinkRow;
}

export async function upsertEventLink(
  admin: SupabaseClient,
  row: {
    userId: string;
    occurrenceId: string;
    googleEventId: string;
    calendarId: string;
    syncStatus: 'upserted' | 'deleted' | 'error';
    lastError: string | null;
  }
): Promise<string | null> {
  const now = new Date().toISOString();
  const { error } = await admin.from('google_calendar_event_links').upsert(
    {
      user_id: row.userId,
      occurrence_id: row.occurrenceId,
      google_event_id: row.googleEventId,
      calendar_id: row.calendarId,
      sync_status: row.syncStatus,
      last_error: row.lastError,
      updated_at: now,
    },
    { onConflict: 'occurrence_id' }
  );
  return error?.message ?? null;
}

export async function markEventLinkError(
  admin: SupabaseClient,
  occurrenceId: string,
  lastError: string
): Promise<void> {
  await admin
    .from('google_calendar_event_links')
    .update({
      sync_status: 'error',
      last_error: lastError,
      updated_at: new Date().toISOString(),
    })
    .eq('occurrence_id', occurrenceId);
}

const LINK_SELECT =
  'id, user_id, occurrence_id, google_event_id, calendar_id, sync_status, last_error, created_at, updated_at';

export async function listEventLinksForUser(
  admin: SupabaseClient,
  userId: string
): Promise<CalendarPageResult<CalendarEventLinkRow>> {
  return loadAllCalendarPages({
    pageSize: CALENDAR_LIST_PAGE_SIZE,
    fetchPage: async ({ from, to }) => {
      const { data, error } = await admin
        .from('google_calendar_event_links')
        .select(LINK_SELECT)
        .eq('user_id', userId)
        .order('occurrence_id', { ascending: true })
        .range(from, to);
      if (error || !Array.isArray(data)) return { ok: false };
      return { ok: true, rows: data as CalendarEventLinkRow[] };
    },
  });
}
