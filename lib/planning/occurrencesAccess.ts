/**
 * Owner-scoped planned_occurrences persistence.
 * Relies on RLS. Never uses the service role.
 *
 * Does not award XP. Log rows are created by the planner execution layer;
 * this module only links/unlinks occurrence.log_id.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  decideLightCompletion,
  decideLogLinkedCompletion,
  decideSkip,
  todoIdToCloseOnOccurrenceCompletion,
} from './completion';
import { archiveOwnedTodoIfOpen, setOwnedTodoArchived } from './todosAccess';
import {
  buildMissingTodayOccurrenceDrafts,
  draftTodoOccurrenceForDate,
  selectLogicalTodayOccurrences,
  todayScheduledDates,
  type OccurrenceInsertDraft,
} from './materialize';
import { localCalendarDateInTimeZone } from './localCalendar';
import { decideReschedule } from './reconciliation';
import {
  OCCURRENCE_VALIDATION_MESSAGES,
  mapOwnedOccurrenceRows,
  occurrenceFromRow,
  prepareOccurrenceCompletionUpdate,
  prepareOccurrenceInsert,
  type OccurrenceRow,
} from './occurrences';
import {
  prepareOccurrenceRoutineScheduleUpdate,
  routineScheduleTemplateFromRoutine,
  selectOccurrencesForRoutineScheduleSync,
} from './routineSchedulePropagation';
import type { PlannedOccurrence, Routine, Todo } from './types';

const OCCURRENCE_SELECT =
  'id, user_id, source_type, routine_id, todo_id, scheduled_date, scheduled_time, timezone, duration_minutes, status, completion_mode, log_id, resolved_at, rescheduled_to_id, created_at, updated_at';

type OccurrenceAccessResult<T> = { data: T; error: string | null };

/** Coalesce concurrent ensure-today calls per owner (React Strict Mode / remounts). */
const ensureTodayInFlight = new Map<
  string,
  Promise<OccurrenceAccessResult<PlannedOccurrence[]>>
>();

function fail<T>(error: string, data: T): OccurrenceAccessResult<T> {
  return { data, error };
}

function requireClient(
  client: SupabaseClient | null | undefined
): client is SupabaseClient {
  return Boolean(client);
}

export async function listOwnedOccurrencesForDates(
  client: SupabaseClient | null | undefined,
  ownerId: string,
  dates: readonly string[]
): Promise<OccurrenceAccessResult<PlannedOccurrence[]>> {
  if (!ownerId) return fail(OCCURRENCE_VALIDATION_MESSAGES.signedIn, []);
  if (!requireClient(client)) {
    return fail('Cloud sync is not available.', []);
  }
  if (dates.length === 0) return { data: [], error: null };

  const { data, error } = await client
    .from('planned_occurrences')
    .select(OCCURRENCE_SELECT)
    .eq('user_id', ownerId)
    .in('scheduled_date', [...dates])
    .order('scheduled_time', { ascending: true });

  if (error) return fail(error.message, []);
  return { data: mapOwnedOccurrenceRows(data, ownerId), error: null };
}

export async function listOwnedOccurrencesByIds(
  client: SupabaseClient | null | undefined,
  ownerId: string,
  ids: readonly string[]
): Promise<OccurrenceAccessResult<PlannedOccurrence[]>> {
  if (!ownerId) return fail(OCCURRENCE_VALIDATION_MESSAGES.signedIn, []);
  if (!requireClient(client)) {
    return fail('Cloud sync is not available.', []);
  }
  const unique = [...new Set(ids.filter((id) => typeof id === 'string' && id))];
  if (unique.length === 0) return { data: [], error: null };

  const { data, error } = await client
    .from('planned_occurrences')
    .select(OCCURRENCE_SELECT)
    .eq('user_id', ownerId)
    .in('id', unique);

  if (error) return fail(error.message, []);
  return { data: mapOwnedOccurrenceRows(data, ownerId), error: null };
}

export async function listOwnedOccurrencesForSources(
  client: SupabaseClient | null | undefined,
  ownerId: string,
  options: {
    routineIds?: readonly string[];
    todoIds?: readonly string[];
  }
): Promise<OccurrenceAccessResult<PlannedOccurrence[]>> {
  if (!ownerId) return fail(OCCURRENCE_VALIDATION_MESSAGES.signedIn, []);
  if (!requireClient(client)) {
    return fail('Cloud sync is not available.', []);
  }

  const routineIds = options.routineIds ?? [];
  const todoIds = options.todoIds ?? [];
  if (routineIds.length === 0 && todoIds.length === 0) {
    return { data: [], error: null };
  }

  let query = client
    .from('planned_occurrences')
    .select(OCCURRENCE_SELECT)
    .eq('user_id', ownerId);

  if (routineIds.length > 0 && todoIds.length > 0) {
    query = query.or(
      `routine_id.in.(${routineIds.join(',')}),todo_id.in.(${todoIds.join(',')})`
    );
  } else if (routineIds.length > 0) {
    query = query.in('routine_id', [...routineIds]);
  } else {
    query = query.in('todo_id', [...todoIds]);
  }

  const { data, error } = await query;
  if (error) return fail(error.message, []);
  return { data: mapOwnedOccurrenceRows(data, ownerId), error: null };
}

async function insertOccurrenceDraft(
  client: SupabaseClient,
  ownerId: string,
  draft: OccurrenceInsertDraft
): Promise<OccurrenceAccessResult<PlannedOccurrence | null>> {
  const prepared = prepareOccurrenceInsert(draft);
  if (!prepared.ok) return fail(prepared.error, null);

  const { data, error } = await client
    .from('planned_occurrences')
    .insert(prepared.value)
    .select(OCCURRENCE_SELECT)
    .maybeSingle();

  if (error) {
    // Unique race: another client materialized first — treat as success path
    // by leaving the caller to re-list.
    if (error.code === '23505') return { data: null, error: null };
    return fail(error.message, null);
  }
  if (!data) return { data: null, error: null };
  const mapped = occurrenceFromRow(data as OccurrenceRow, ownerId);
  if (!mapped) return fail('Saved plan item could not be read back.', null);
  return { data: mapped, error: null };
}

/**
 * Ensure today's routine/to-do expectations exist as planned_occurrences.
 * Does not rewrite historical rows. Idempotent via existing-row checks,
 * in-flight coalescing, a pre-insert re-list, and unique indexes
 * from v10/v12. Returns at most one logical occurrence per intended expectation.
 */
export async function ensureTodayOccurrences(
  client: SupabaseClient | null | undefined,
  input: {
    ownerId: string;
    now: Date;
    viewerTimeZone: string;
    routines: readonly Routine[];
    todos: readonly Todo[];
  }
): Promise<OccurrenceAccessResult<PlannedOccurrence[]>> {
  const { ownerId } = input;
  if (!ownerId) return fail(OCCURRENCE_VALIDATION_MESSAGES.signedIn, []);
  if (!requireClient(client)) {
    return fail('Cloud sync is not available.', []);
  }

  const inFlight = ensureTodayInFlight.get(ownerId);
  if (inFlight) return inFlight;

  const run = ensureTodayOccurrencesUncoalesced(client, input).finally(() => {
    if (ensureTodayInFlight.get(ownerId) === run) {
      ensureTodayInFlight.delete(ownerId);
    }
  });
  ensureTodayInFlight.set(ownerId, run);
  return run;
}

async function ensureTodayOccurrencesUncoalesced(
  client: SupabaseClient,
  input: {
    ownerId: string;
    now: Date;
    viewerTimeZone: string;
    routines: readonly Routine[];
    todos: readonly Todo[];
  }
): Promise<OccurrenceAccessResult<PlannedOccurrence[]>> {
  const { ownerId } = input;

  const dates = todayScheduledDates(
    input.now,
    input.viewerTimeZone,
    input.routines
  );
  const todoIds = input.todos.map((todo) => todo.id);
  const routineIds = input.routines.map((routine) => routine.id);

  const [byDate, bySource] = await Promise.all([
    listOwnedOccurrencesForDates(client, ownerId, dates),
    listOwnedOccurrencesForSources(client, ownerId, { routineIds, todoIds }),
  ]);
  if (byDate.error || bySource.error) {
    return fail(byDate.error || bySource.error || 'Could not load plan.', []);
  }

  const existingById = new Map<string, PlannedOccurrence>();
  for (const row of [...byDate.data, ...bySource.data]) {
    existingById.set(row.id, row);
  }

  let drafts = buildMissingTodayOccurrenceDrafts({
    now: input.now,
    viewerTimeZone: input.viewerTimeZone,
    ownerId,
    routines: input.routines,
    todos: input.todos,
    existing: Array.from(existingById.values()),
  });

  // Narrow the concurrent-insert race when v10 unique indexes are not yet
  // applied: re-list before writing, then rebuild drafts from the freshest set.
  if (drafts.length > 0) {
    const [reDate, reSource] = await Promise.all([
      listOwnedOccurrencesForDates(client, ownerId, dates),
      listOwnedOccurrencesForSources(client, ownerId, { routineIds, todoIds }),
    ]);
    if (reDate.error || reSource.error) {
      return fail(reDate.error || reSource.error || 'Could not load plan.', []);
    }
    for (const row of [...reDate.data, ...reSource.data]) {
      existingById.set(row.id, row);
    }
    drafts = buildMissingTodayOccurrenceDrafts({
      now: input.now,
      viewerTimeZone: input.viewerTimeZone,
      ownerId,
      routines: input.routines,
      todos: input.todos,
      existing: Array.from(existingById.values()),
    });
  }

  for (const draft of drafts) {
    // Skip if another insert in this loop already covered the identity.
    const stillMissing = buildMissingTodayOccurrenceDrafts({
      now: input.now,
      viewerTimeZone: input.viewerTimeZone,
      ownerId,
      routines:
        draft.sourceType === 'routine'
          ? input.routines.filter((routine) => routine.id === draft.routineId)
          : [],
      todos:
        draft.sourceType === 'todo'
          ? input.todos.filter((todo) => todo.id === draft.todoId)
          : [],
      existing: Array.from(existingById.values()),
    });
    if (stillMissing.length === 0) continue;

    const inserted = await insertOccurrenceDraft(client, ownerId, draft);
    if (inserted.error) return fail(inserted.error, []);
    if (inserted.data) {
      existingById.set(inserted.data.id, inserted.data);
      continue;
    }

    // Unique race (23505) or empty read-back: refresh so later drafts skip.
    const raced = await listOwnedOccurrencesForSources(client, ownerId, {
      routineIds: draft.routineId ? [draft.routineId] : [],
      todoIds: draft.todoId ? [draft.todoId] : [],
    });
    if (raced.error) return fail(raced.error, []);
    for (const row of raced.data) existingById.set(row.id, row);
  }

  const refreshed = await listOwnedOccurrencesForDates(client, ownerId, dates);
  if (refreshed.error) return fail(refreshed.error, []);

  const logical = selectLogicalTodayOccurrences(refreshed.data);
  logical.sort((a, b) => {
    const timeA = a.scheduledTime || '99:99:99';
    const timeB = b.scheduledTime || '99:99:99';
    if (timeA !== timeB) return timeA.localeCompare(timeB);
    return a.id.localeCompare(b.id);
  });

  return { data: logical, error: null };
}

export async function completeOwnedOccurrenceLight(
  client: SupabaseClient | null | undefined,
  ownerId: string,
  occurrence: PlannedOccurrence,
  resolvedAt: string
): Promise<OccurrenceAccessResult<PlannedOccurrence | null>> {
  if (!ownerId) return fail(OCCURRENCE_VALIDATION_MESSAGES.signedIn, null);
  if (occurrence.userId !== ownerId) {
    return fail(OCCURRENCE_VALIDATION_MESSAGES.owner, null);
  }
  if (!requireClient(client)) {
    return fail('Cloud sync is not available.', null);
  }

  const decision = decideLightCompletion(occurrence, resolvedAt);
  if (decision.kind === 'reject') return fail(decision.error, null);

  let mapped: PlannedOccurrence = occurrence;
  if (decision.kind === 'apply') {
    const prepared = prepareOccurrenceCompletionUpdate(
      occurrence,
      decision.next,
      resolvedAt
    );
    if (!prepared.ok) return fail(prepared.error, null);

    const { data, error } = await client
      .from('planned_occurrences')
      .update(prepared.value)
      .eq('id', occurrence.id)
      .eq('user_id', ownerId)
      .select(OCCURRENCE_SELECT)
      .maybeSingle();

    if (error) return fail(error.message, null);
    if (!data) return fail(OCCURRENCE_VALIDATION_MESSAGES.notFound, null);
    const next = occurrenceFromRow(data, ownerId);
    if (!next) return fail('Updated plan item could not be read back.', null);
    mapped = next;
  }

  const todoError = await closeLinkedTodoIfNeeded(
    client,
    ownerId,
    mapped,
    resolvedAt
  );
  return { data: mapped, error: todoError };
}

export async function linkOwnedOccurrenceLog(
  client: SupabaseClient | null | undefined,
  ownerId: string,
  occurrence: PlannedOccurrence,
  logId: string,
  resolvedAt: string
): Promise<OccurrenceAccessResult<PlannedOccurrence | null>> {
  if (!ownerId) return fail(OCCURRENCE_VALIDATION_MESSAGES.signedIn, null);
  if (occurrence.userId !== ownerId) {
    return fail(OCCURRENCE_VALIDATION_MESSAGES.owner, null);
  }
  if (!requireClient(client)) {
    return fail('Cloud sync is not available.', null);
  }

  const decision = decideLogLinkedCompletion(occurrence, logId, resolvedAt);
  if (decision.kind === 'reject') return fail(decision.error, null);

  let mapped: PlannedOccurrence = occurrence;
  if (decision.kind === 'apply') {
    const prepared = prepareOccurrenceCompletionUpdate(
      occurrence,
      decision.next,
      resolvedAt
    );
    if (!prepared.ok) return fail(prepared.error, null);

    const { data, error } = await client
      .from('planned_occurrences')
      .update(prepared.value)
      .eq('id', occurrence.id)
      .eq('user_id', ownerId)
      .select(OCCURRENCE_SELECT)
      .maybeSingle();

    if (error) return fail(error.message, null);
    if (!data) return fail(OCCURRENCE_VALIDATION_MESSAGES.notFound, null);
    const next = occurrenceFromRow(data, ownerId);
    if (!next) return fail('Updated plan item could not be read back.', null);
    mapped = next;
  }

  const todoError = await closeLinkedTodoIfNeeded(
    client,
    ownerId,
    mapped,
    resolvedAt
  );
  return { data: mapped, error: todoError };
}

async function closeLinkedTodoIfNeeded(
  client: SupabaseClient,
  ownerId: string,
  occurrence: PlannedOccurrence,
  resolvedAt: string
): Promise<string | null> {
  const todoId = todoIdToCloseOnOccurrenceCompletion(occurrence);
  if (!todoId) return null;
  const closed = await archiveOwnedTodoIfOpen(
    client,
    ownerId,
    todoId,
    resolvedAt
  );
  return closed.error;
}

export async function listOwnedPastPlannedOccurrences(
  client: SupabaseClient | null | undefined,
  ownerId: string,
  beforeDate: string
): Promise<OccurrenceAccessResult<PlannedOccurrence[]>> {
  if (!ownerId) return fail(OCCURRENCE_VALIDATION_MESSAGES.signedIn, []);
  if (!requireClient(client)) {
    return fail('Cloud sync is not available.', []);
  }

  const { data, error } = await client
    .from('planned_occurrences')
    .select(OCCURRENCE_SELECT)
    .eq('user_id', ownerId)
    .eq('status', 'planned')
    .lt('scheduled_date', beforeDate)
    .order('scheduled_date', { ascending: true });

  if (error) return fail(error.message, []);
  return { data: mapOwnedOccurrenceRows(data, ownerId), error: null };
}

export async function skipOwnedOccurrence(
  client: SupabaseClient | null | undefined,
  ownerId: string,
  occurrence: PlannedOccurrence,
  resolvedAt: string
): Promise<OccurrenceAccessResult<PlannedOccurrence | null>> {
  if (!ownerId) return fail(OCCURRENCE_VALIDATION_MESSAGES.signedIn, null);
  if (occurrence.userId !== ownerId) {
    return fail(OCCURRENCE_VALIDATION_MESSAGES.owner, null);
  }
  if (!requireClient(client)) {
    return fail('Cloud sync is not available.', null);
  }

  const decision = decideSkip(occurrence, resolvedAt);
  if (decision.kind === 'reject') return fail(decision.error, null);

  let mapped: PlannedOccurrence = occurrence;
  if (decision.kind === 'apply') {
    const prepared = prepareOccurrenceCompletionUpdate(
      occurrence,
      decision.next,
      resolvedAt
    );
    if (!prepared.ok) return fail(prepared.error, null);

    const { data, error } = await client
      .from('planned_occurrences')
      .update(prepared.value)
      .eq('id', occurrence.id)
      .eq('user_id', ownerId)
      .select(OCCURRENCE_SELECT)
      .maybeSingle();

    if (error) return fail(error.message, null);
    if (!data) return fail(OCCURRENCE_VALIDATION_MESSAGES.notFound, null);
    const next = occurrenceFromRow(data, ownerId);
    if (!next) return fail('Updated plan item could not be read back.', null);
    mapped = next;
  }

  const todoError = await closeLinkedTodoIfNeeded(
    client,
    ownerId,
    mapped,
    resolvedAt
  );
  return { data: mapped, error: todoError };
}

export async function rescheduleOwnedOccurrence(
  client: SupabaseClient | null | undefined,
  ownerId: string,
  occurrence: PlannedOccurrence,
  targetDate: string,
  resolvedAt: string
): Promise<
  OccurrenceAccessResult<{
    source: PlannedOccurrence;
    replacement: PlannedOccurrence | null;
  } | null>
> {
  if (!ownerId) return fail(OCCURRENCE_VALIDATION_MESSAGES.signedIn, null);
  if (occurrence.userId !== ownerId) {
    return fail(OCCURRENCE_VALIDATION_MESSAGES.owner, null);
  }
  if (!requireClient(client)) {
    return fail('Cloud sync is not available.', null);
  }

  const related = await listOwnedOccurrencesForSources(client, ownerId, {
    routineIds: occurrence.routineId ? [occurrence.routineId] : [],
    todoIds: occurrence.todoId ? [occurrence.todoId] : [],
  });
  if (related.error) return fail(related.error, null);

  const replacementId =
    occurrence.status === 'rescheduled' && occurrence.rescheduledToId
      ? occurrence.rescheduledToId
      : crypto.randomUUID();

  const decision = decideReschedule({
    source: occurrence,
    targetDate,
    replacementId,
    resolvedAt,
    existing: related.data,
  });
  if (decision.kind === 'reject') return fail(decision.error, null);

  if (decision.kind === 'noop') {
    const replacement = related.data.find(
      (row) => row.id === decision.replacementId
    );
    return {
      data: { source: occurrence, replacement: replacement ?? null },
      error: null,
    };
  }

  const { data, error } = await client.rpc('planning_reschedule_occurrence', {
    p_occurrence_id: occurrence.id,
    p_replacement_id: decision.replacementId,
    p_target_date: targetDate,
    p_target_time: occurrence.scheduledTime,
    p_resolved_at: resolvedAt,
  });

  if (error) return fail(error.message, null);
  const parsed = parseRescheduleRpc(data, ownerId);
  if (!parsed) return fail('Moved item could not be read back.', null);
  return { data: parsed, error: null };
}

export async function reopenOwnedTodoForAnotherAttempt(
  client: SupabaseClient | null | undefined,
  ownerId: string,
  todo: Pick<Todo, 'id' | 'userId' | 'archivedAt'>,
  now: Date,
  viewerTimeZone: string
): Promise<OccurrenceAccessResult<PlannedOccurrence | null>> {
  if (!ownerId) return fail(OCCURRENCE_VALIDATION_MESSAGES.signedIn, null);
  if (todo.userId !== ownerId) {
    return fail(OCCURRENCE_VALIDATION_MESSAGES.owner, null);
  }
  if (!requireClient(client)) {
    return fail('Cloud sync is not available.', null);
  }

  const opened = await setOwnedTodoArchived(client, ownerId, todo, false);
  if (opened.error || !opened.data) {
    return fail(opened.error || 'Could not reopen this to-do.', null);
  }

  const listed = await listOwnedOccurrencesForSources(client, ownerId, {
    todoIds: [todo.id],
  });
  if (listed.error) return fail(listed.error, null);

  const existingPlanned = listed.data.find((row) => row.status === 'planned');
  if (existingPlanned) return { data: existingPlanned, error: null };

  const localDate = localCalendarDateInTimeZone(now, viewerTimeZone);
  if (!localDate) return fail('Could not determine today\'s date.', null);

  const draft = draftTodoOccurrenceForDate(
    opened.data,
    localDate,
    viewerTimeZone
  );
  if (!draft) return { data: null, error: null };

  const inserted = await insertOccurrenceDraft(client, ownerId, draft);
  if (inserted.error) return fail(inserted.error, null);
  if (inserted.data) return { data: inserted.data, error: null };

  const retry = await listOwnedOccurrencesForSources(client, ownerId, {
    todoIds: [todo.id],
  });
  if (retry.error) return fail(retry.error, null);
  const planned = retry.data.find((row) => row.status === 'planned');
  return { data: planned ?? null, error: null };
}

/**
 * Copy the Routine schedule template onto owned planned occurrences.
 * Does not change dates, status, Move history, Logs, or XP.
 */
export async function propagateOwnedRoutineScheduleToPlannedOccurrences(
  client: SupabaseClient,
  ownerId: string,
  routine: Routine
): Promise<string | null> {
  const listed = await listOwnedOccurrencesForSources(client, ownerId, {
    routineIds: [routine.id],
  });
  if (listed.error) return listed.error;

  const template = routineScheduleTemplateFromRoutine(routine);
  const pending = selectOccurrencesForRoutineScheduleSync(listed.data, {
    ownerId,
    routineId: routine.id,
    template,
  });
  if (pending.length === 0) return null;

  const updatedAt = new Date().toISOString();
  const ids: string[] = [];
  for (const occurrence of pending) {
    const prepared = prepareOccurrenceRoutineScheduleUpdate(
      occurrence,
      template,
      updatedAt
    );
    if (!prepared.ok) return prepared.error;
    ids.push(occurrence.id);
  }

  const { error } = await client
    .from('planned_occurrences')
    .update({
      scheduled_time: template.scheduledTime,
      duration_minutes: template.durationMinutes,
      timezone: template.timezone,
      updated_at: updatedAt,
    })
    .eq('user_id', ownerId)
    .eq('routine_id', routine.id)
    .eq('status', 'planned')
    .in('id', ids);

  return error?.message ?? null;
}

/**
 * Skip remaining owned planned occurrences for a Routine after archive or
 * tombstone. Does not touch completed, skipped, or rescheduled history.
 * Idempotent. Does not mutate Logs, XP, or other users.
 */
export async function skipOwnedPlannedOccurrencesForRoutine(
  client: SupabaseClient | null | undefined,
  ownerId: string,
  routineId: string
): Promise<string | null> {
  if (!ownerId || !routineId) return OCCURRENCE_VALIDATION_MESSAGES.signedIn;
  const listed = await listOwnedOccurrencesForSources(client, ownerId, {
    routineIds: [routineId],
    todoIds: [],
  });
  if (listed.error) return listed.error;
  const resolvedAt = new Date().toISOString();
  for (const occurrence of listed.data) {
    if (occurrence.userId !== ownerId) continue;
    if (occurrence.routineId !== routineId) continue;
    if (occurrence.sourceType !== 'routine') continue;
    if (occurrence.status !== 'planned') continue;
    const skipped = await skipOwnedOccurrence(
      client,
      ownerId,
      occurrence,
      resolvedAt
    );
    if (skipped.error) return skipped.error;
  }
  return null;
}

function parseRescheduleRpc(
  payload: unknown,
  ownerId: string
): { source: PlannedOccurrence; replacement: PlannedOccurrence | null } | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const record = payload as { source?: unknown; replacement?: unknown };
  const source = occurrenceFromRow(record.source, ownerId);
  if (!source) return null;
  const replacement = record.replacement
    ? occurrenceFromRow(record.replacement, ownerId)
    : null;
  return { source, replacement };
}
