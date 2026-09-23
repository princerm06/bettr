import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptSecret } from './crypto';
import type { ProjectionOccurrence } from './eligibility';
import type { EventPayloadSource } from './eventPayload';
import { normalizeCivilTime } from './civilDate';
import {
  CALENDAR_LIST_PAGE_SIZE,
  loadAllCalendarPages,
  type CalendarPageResult,
} from './listPages';

export function mapCalendarOccurrenceRow(data: unknown): ProjectionOccurrence | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  if (row.source_type !== 'routine' && row.source_type !== 'todo') return null;
  if (typeof row.user_id !== 'string' || typeof row.id !== 'string') return null;
  if (typeof row.scheduled_date !== 'string' || typeof row.timezone !== 'string') {
    return null;
  }
  const scheduledTime =
    typeof row.scheduled_time === 'string'
      ? normalizeCivilTime(row.scheduled_time)
      : null;
  return {
    id: row.id,
    userId: row.user_id,
    sourceType: row.source_type,
    routineId: typeof row.routine_id === 'string' ? row.routine_id : null,
    todoId: typeof row.todo_id === 'string' ? row.todo_id : null,
    scheduledDate: row.scheduled_date.slice(0, 10),
    scheduledTime,
    timezone: row.timezone,
    durationMinutes:
      typeof row.duration_minutes === 'number' ? row.duration_minutes : null,
    status: typeof row.status === 'string' ? row.status : '',
  };
}

export async function loadOwnedOccurrence(
  admin: SupabaseClient,
  occurrenceId: string
): Promise<ProjectionOccurrence | null> {
  const { data, error } = await admin
    .from('planned_occurrences')
    .select(
      'id, user_id, source_type, routine_id, todo_id, scheduled_date, scheduled_time, timezone, duration_minutes, status'
    )
    .eq('id', occurrenceId)
    .maybeSingle();
  if (error || !data) return null;
  return mapCalendarOccurrenceRow(data);
}

export async function listOccurrencesForUser(
  admin: SupabaseClient,
  userId: string
): Promise<CalendarPageResult<ProjectionOccurrence>> {
  return loadAllCalendarPages({
    pageSize: CALENDAR_LIST_PAGE_SIZE,
    fetchPage: async ({ from, to }) => {
      const { data, error } = await admin
        .from('planned_occurrences')
        .select(
          'id, user_id, source_type, routine_id, todo_id, scheduled_date, scheduled_time, timezone, duration_minutes, status'
        )
        .eq('user_id', userId)
        .order('id', { ascending: true })
        .range(from, to);
      if (error || !Array.isArray(data)) return { ok: false };
      const rows: ProjectionOccurrence[] = [];
      for (const row of data) {
        const occurrence = mapCalendarOccurrenceRow(row);
        if (occurrence) rows.push(occurrence);
      }
      return { ok: true, rows };
    },
  });
}

export async function loadOccurrenceSource(
  admin: SupabaseClient,
  occurrence: ProjectionOccurrence
): Promise<EventPayloadSource | null> {
  if (occurrence.sourceType === 'todo' && occurrence.todoId) {
    const { data, error } = await admin
      .from('todos')
      .select('title, user_id')
      .eq('id', occurrence.todoId)
      .eq('user_id', occurrence.userId)
      .maybeSingle();
    if (error || !data || typeof data.title !== 'string') return null;
    return { title: data.title };
  }
  if (occurrence.sourceType === 'routine' && occurrence.routineId) {
    const { data, error } = await admin
      .from('routines')
      .select(
        'title, user_id, recurrence_type, weekday_labels, is_active, external_calendar_enabled, deleted_at'
      )
      .eq('id', occurrence.routineId)
      .eq('user_id', occurrence.userId)
      .maybeSingle();
    if (error || !data || typeof data.title !== 'string') return null;
    const isActive = data.is_active === true;
    const deleted = data.deleted_at != null;
    const flag =
      data.external_calendar_enabled === undefined
        ? true
        : data.external_calendar_enabled === true;
    return {
      title: data.title,
      recurrenceType:
        typeof data.recurrence_type === 'string' ? data.recurrence_type : null,
      weekdayLabels: mapWeekdayLabels(data.weekday_labels),
      allowsExternalCalendar: isActive && !deleted && flag,
    };
  }
  return null;
}

function mapWeekdayLabels(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const mapped: Record<string, string> = {};
  for (const [key, label] of Object.entries(value as Record<string, unknown>)) {
    if (typeof label === 'string' && label.trim()) mapped[key] = label.trim();
  }
  return Object.keys(mapped).length ? mapped : null;
}

export async function persistRotatedRefreshToken(
  admin: SupabaseClient,
  userId: string,
  refreshToken: string
): Promise<void> {
  const { error } = await admin
    .from('google_calendar_connections')
    .update({
      refresh_token_ciphertext: encryptSecret(refreshToken),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
  if (error) {
    throw new Error('Could not persist rotated Google credentials.');
  }
}
