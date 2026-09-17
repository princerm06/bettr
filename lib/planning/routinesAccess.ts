/**
 * Owner-scoped Routine persistence using the signed-in Supabase client.
 * Relies on existing RLS. Never uses the service role.
 *
 * Destructive deletion is intentionally omitted: occurrence rows reference
 * routines with ON DELETE RESTRICT, so archive/reactivate via is_active is
 * the safe Slice 3 lifecycle path.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ROUTINE_VALIDATION_MESSAGES,
  mapOwnedRoutineRows,
  prepareRoutineActiveTransition,
  prepareRoutineCreate,
  prepareRoutineUpdate,
  routineFromRow,
  type RoutineWriteInput,
} from './routines';
import type { Routine } from './types';

const ROUTINE_SELECT =
  'id, user_id, title, description, categories, goal_id, recurrence_type, weekdays, weekday_labels, scheduled_time, duration_minutes, timezone, is_active, created_at, updated_at';

type RoutineAccessResult<T> = { data: T; error: string | null };

function fail<T>(error: string, data: T): RoutineAccessResult<T> {
  return { data, error };
}

function requireClient(
  client: SupabaseClient | null | undefined
): client is SupabaseClient {
  return Boolean(client);
}

export async function listOwnedRoutines(
  client: SupabaseClient | null | undefined,
  ownerId: string
): Promise<RoutineAccessResult<Routine[]>> {
  if (!ownerId) return fail(ROUTINE_VALIDATION_MESSAGES.signedIn, []);
  if (!requireClient(client)) {
    return fail('Cloud sync is not available.', []);
  }

  const { data, error } = await client
    .from('routines')
    .select(ROUTINE_SELECT)
    .eq('user_id', ownerId)
    .order('updated_at', { ascending: false });

  if (error) return fail(error.message, []);
  return { data: mapOwnedRoutineRows(data, ownerId), error: null };
}

export async function createOwnedRoutine(
  client: SupabaseClient | null | undefined,
  ownerId: string,
  input: RoutineWriteInput
): Promise<RoutineAccessResult<Routine | null>> {
  const prepared = prepareRoutineCreate(ownerId, input);
  if (!prepared.ok) return fail(prepared.error, null);
  if (!requireClient(client)) return fail('Cloud sync is not available.', null);

  const { data, error } = await client
    .from('routines')
    .insert(prepared.value)
    .select(ROUTINE_SELECT)
    .single();

  if (error) return fail(error.message, null);
  const routine = routineFromRow(data, ownerId);
  if (!routine) return fail('Saved routine could not be read back.', null);
  return { data: routine, error: null };
}

export async function updateOwnedRoutine(
  client: SupabaseClient | null | undefined,
  ownerId: string,
  routineId: string,
  input: RoutineWriteInput
): Promise<RoutineAccessResult<Routine | null>> {
  if (!routineId) return fail('That routine could not be found.', null);
  const prepared = prepareRoutineUpdate(ownerId, input);
  if (!prepared.ok) return fail(prepared.error, null);
  if (!requireClient(client)) return fail('Cloud sync is not available.', null);

  const { data, error } = await client
    .from('routines')
    .update(prepared.value)
    .eq('id', routineId)
    .eq('user_id', ownerId)
    .select(ROUTINE_SELECT)
    .maybeSingle();

  if (error) return fail(error.message, null);
  if (!data) return fail('That routine could not be found.', null);
  const routine = routineFromRow(data, ownerId);
  if (!routine) return fail('Updated routine could not be read back.', null);
  return { data: routine, error: null };
}

export async function setOwnedRoutineActive(
  client: SupabaseClient | null | undefined,
  ownerId: string,
  routine: Pick<Routine, 'id' | 'userId' | 'isActive'>,
  nextActive: boolean
): Promise<RoutineAccessResult<Routine | null>> {
  if (routine.userId !== ownerId) {
    return fail(ROUTINE_VALIDATION_MESSAGES.owner, null);
  }
  const prepared = prepareRoutineActiveTransition(nextActive);
  if (!prepared.ok) return fail(prepared.error, null);
  if (!requireClient(client)) return fail('Cloud sync is not available.', null);

  const { data, error } = await client
    .from('routines')
    .update(prepared.value)
    .eq('id', routine.id)
    .eq('user_id', ownerId)
    .select(ROUTINE_SELECT)
    .maybeSingle();

  if (error) return fail(error.message, null);
  if (!data) return fail('That routine could not be found.', null);
  const mapped = routineFromRow(data, ownerId);
  if (!mapped) return fail('Updated routine could not be read back.', null);
  return { data: mapped, error: null };
}
