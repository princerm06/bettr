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
} from './completion';
import {
  buildMissingTodayOccurrenceDrafts,
  selectLogicalTodayOccurrences,
  todayScheduledDates,
  type OccurrenceInsertDraft,
} from './materialize';
import {
  OCCURRENCE_VALIDATION_MESSAGES,
  mapOwnedOccurrenceRows,
  occurrenceFromRow,
  prepareOccurrenceCompletionUpdate,
  prepareOccurrenceInsert,
  type OccurrenceRow,
} from './occurrences';
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
 * in-flight coalescing, a pre-insert re-list, and optional unique indexes
 * from v10. Returns at most one logical occurrence per intended expectation.
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

  // Include active to-do occurrences whose scheduled_date may differ when
  // viewer timezone shifted, so Today still shows the open expectation.
  const openTodoIds = new Set(
    input.todos.filter((todo) => todo.archivedAt === null).map((todo) => todo.id)
  );
  const combined = [...refreshed.data];
  for (const row of existingById.values()) {
    if (
      row.sourceType === 'todo' &&
      row.todoId &&
      openTodoIds.has(row.todoId) &&
      !combined.some((item) => item.id === row.id)
    ) {
      combined.push(row);
    }
  }

  const logical = selectLogicalTodayOccurrences(combined);
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
  if (decision.kind === 'noop') return { data: occurrence, error: null };

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
  const mapped = occurrenceFromRow(data, ownerId);
  if (!mapped) return fail('Updated plan item could not be read back.', null);
  return { data: mapped, error: null };
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
  if (decision.kind === 'noop') return { data: occurrence, error: null };

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
  const mapped = occurrenceFromRow(data, ownerId);
  if (!mapped) return fail('Updated plan item could not be read back.', null);
  return { data: mapped, error: null };
}
