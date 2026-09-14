/**
 * Owner-scoped Goal persistence using the signed-in Supabase client.
 * Relies on existing RLS. Never uses the service role.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  GOAL_VALIDATION_MESSAGES,
  goalFromRow,
  mapOwnedGoalRows,
  prepareGoalCreate,
  prepareGoalStatusTransition,
  prepareGoalUpdate,
  type GoalWriteInput,
} from './goals';
import type { Goal, PlanningGoalStatus } from './types';

const GOAL_SELECT =
  'id, user_id, title, description, categories, target_date, status, created_at, updated_at';

type GoalAccessResult<T> = { data: T; error: string | null };

function fail<T>(error: string, data: T): GoalAccessResult<T> {
  return { data, error };
}

function requireClient(
  client: SupabaseClient | null | undefined
): client is SupabaseClient {
  return Boolean(client);
}

export async function listOwnedGoals(
  client: SupabaseClient | null | undefined,
  ownerId: string
): Promise<GoalAccessResult<Goal[]>> {
  if (!ownerId) return fail(GOAL_VALIDATION_MESSAGES.signedIn, []);
  if (!requireClient(client)) {
    return fail('Cloud sync is not available.', []);
  }

  const { data, error } = await client
    .from('goals')
    .select(GOAL_SELECT)
    .eq('user_id', ownerId)
    .order('updated_at', { ascending: false });

  if (error) return fail(error.message, []);
  return { data: mapOwnedGoalRows(data, ownerId), error: null };
}

export async function createOwnedGoal(
  client: SupabaseClient | null | undefined,
  ownerId: string,
  input: GoalWriteInput
): Promise<GoalAccessResult<Goal | null>> {
  const prepared = prepareGoalCreate(ownerId, input);
  if (!prepared.ok) return fail(prepared.error, null);
  if (!requireClient(client)) return fail('Cloud sync is not available.', null);

  const { data, error } = await client
    .from('goals')
    .insert(prepared.value)
    .select(GOAL_SELECT)
    .single();

  if (error) return fail(error.message, null);
  const goal = goalFromRow(data, ownerId);
  if (!goal) return fail('Saved goal could not be read back.', null);
  return { data: goal, error: null };
}

export async function updateOwnedGoal(
  client: SupabaseClient | null | undefined,
  ownerId: string,
  goalId: string,
  input: GoalWriteInput
): Promise<GoalAccessResult<Goal | null>> {
  if (!goalId) return fail('That goal could not be found.', null);
  const prepared = prepareGoalUpdate(ownerId, input);
  if (!prepared.ok) return fail(prepared.error, null);
  if (!requireClient(client)) return fail('Cloud sync is not available.', null);

  const { data, error } = await client
    .from('goals')
    .update(prepared.value)
    .eq('id', goalId)
    .eq('user_id', ownerId)
    .select(GOAL_SELECT)
    .maybeSingle();

  if (error) return fail(error.message, null);
  if (!data) return fail('That goal could not be found.', null);
  const goal = goalFromRow(data, ownerId);
  if (!goal) return fail('Updated goal could not be read back.', null);
  return { data: goal, error: null };
}

export async function transitionOwnedGoalStatus(
  client: SupabaseClient | null | undefined,
  ownerId: string,
  goal: Pick<Goal, 'id' | 'userId' | 'status'>,
  nextStatus: PlanningGoalStatus
): Promise<GoalAccessResult<Goal | null>> {
  if (goal.userId !== ownerId) {
    return fail(GOAL_VALIDATION_MESSAGES.owner, null);
  }
  const prepared = prepareGoalStatusTransition(goal.status, nextStatus);
  if (!prepared.ok) return fail(prepared.error, null);
  if (!requireClient(client)) return fail('Cloud sync is not available.', null);

  const { data, error } = await client
    .from('goals')
    .update(prepared.value)
    .eq('id', goal.id)
    .eq('user_id', ownerId)
    .select(GOAL_SELECT)
    .maybeSingle();

  if (error) return fail(error.message, null);
  if (!data) return fail('That goal could not be found.', null);
  const mapped = goalFromRow(data, ownerId);
  if (!mapped) return fail('Updated goal could not be read back.', null);
  return { data: mapped, error: null };
}
