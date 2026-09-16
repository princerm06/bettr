/**
 * Owner-scoped To-Do persistence using the signed-in Supabase client.
 * Relies on existing RLS. Never uses the service role.
 *
 * Destructive deletion is intentionally omitted: occurrence rows reference
 * todos with ON DELETE RESTRICT, so complete/reopen via archived_at is
 * the safe Slice 4 lifecycle path.
 *
 * Does not touch logs, scoring, or XP.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  TODO_VALIDATION_MESSAGES,
  mapOwnedTodoRows,
  prepareTodoArchiveTransition,
  prepareTodoCreate,
  prepareTodoUpdate,
  todoFromRow,
  type TodoWriteInput,
} from './todos';
import type { Todo } from './types';

const TODO_SELECT =
  'id, user_id, title, description, categories, goal_id, created_at, updated_at, archived_at';

type TodoAccessResult<T> = { data: T; error: string | null };

function fail<T>(error: string, data: T): TodoAccessResult<T> {
  return { data, error };
}

function requireClient(
  client: SupabaseClient | null | undefined
): client is SupabaseClient {
  return Boolean(client);
}

export async function listOwnedTodos(
  client: SupabaseClient | null | undefined,
  ownerId: string
): Promise<TodoAccessResult<Todo[]>> {
  if (!ownerId) return fail(TODO_VALIDATION_MESSAGES.signedIn, []);
  if (!requireClient(client)) {
    return fail('Cloud sync is not available.', []);
  }

  const { data, error } = await client
    .from('todos')
    .select(TODO_SELECT)
    .eq('user_id', ownerId)
    .order('updated_at', { ascending: false });

  if (error) return fail(error.message, []);
  return { data: mapOwnedTodoRows(data, ownerId), error: null };
}

export async function createOwnedTodo(
  client: SupabaseClient | null | undefined,
  ownerId: string,
  input: TodoWriteInput
): Promise<TodoAccessResult<Todo | null>> {
  const prepared = prepareTodoCreate(ownerId, input);
  if (!prepared.ok) return fail(prepared.error, null);
  if (!requireClient(client)) return fail('Cloud sync is not available.', null);

  const { data, error } = await client
    .from('todos')
    .insert(prepared.value)
    .select(TODO_SELECT)
    .single();

  if (error) return fail(error.message, null);
  const todo = todoFromRow(data, ownerId);
  if (!todo) return fail('Saved to-do could not be read back.', null);
  return { data: todo, error: null };
}

export async function updateOwnedTodo(
  client: SupabaseClient | null | undefined,
  ownerId: string,
  todoId: string,
  input: TodoWriteInput
): Promise<TodoAccessResult<Todo | null>> {
  if (!todoId) return fail('That to-do could not be found.', null);
  const prepared = prepareTodoUpdate(ownerId, input);
  if (!prepared.ok) return fail(prepared.error, null);
  if (!requireClient(client)) return fail('Cloud sync is not available.', null);

  const { data, error } = await client
    .from('todos')
    .update(prepared.value)
    .eq('id', todoId)
    .eq('user_id', ownerId)
    .select(TODO_SELECT)
    .maybeSingle();

  if (error) return fail(error.message, null);
  if (!data) return fail('That to-do could not be found.', null);
  const todo = todoFromRow(data, ownerId);
  if (!todo) return fail('Updated to-do could not be read back.', null);
  return { data: todo, error: null };
}

export async function setOwnedTodoArchived(
  client: SupabaseClient | null | undefined,
  ownerId: string,
  todo: Pick<Todo, 'id' | 'userId' | 'archivedAt'>,
  nextDone: boolean
): Promise<TodoAccessResult<Todo | null>> {
  if (todo.userId !== ownerId) {
    return fail(TODO_VALIDATION_MESSAGES.owner, null);
  }
  const prepared = prepareTodoArchiveTransition(nextDone);
  if (!prepared.ok) return fail(prepared.error, null);
  if (!requireClient(client)) return fail('Cloud sync is not available.', null);

  const { data, error } = await client
    .from('todos')
    .update(prepared.value)
    .eq('id', todo.id)
    .eq('user_id', ownerId)
    .select(TODO_SELECT)
    .maybeSingle();

  if (error) return fail(error.message, null);
  if (!data) return fail('That to-do could not be found.', null);
  const mapped = todoFromRow(data, ownerId);
  if (!mapped) return fail('Updated to-do could not be read back.', null);
  return { data: mapped, error: null };
}
