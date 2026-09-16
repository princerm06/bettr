/**
 * To-Do write/normalization and database mapping.
 * Intention only: no XP, semantic evaluation, or Log scoring.
 *
 * Lifecycle uses archived_at only (open ↔ done). Due date/time/timezone
 * are not columns on todos and are out of scope for this slice.
 */
import {
  isPlanningCategoryKey,
  isValidPlanningCategories,
  isValidPlanningTitle,
  isValidTodo,
  samePlanningOwner,
} from './invariants';
import {
  PLANNING_TITLE_MAX_LENGTH,
  type PlanningCategoryKey,
  type Todo,
} from './types';

export const TODO_CREATE_ARCHIVED_AT = null;

export const TODO_TABLE_COLUMNS = [
  'id',
  'user_id',
  'title',
  'description',
  'categories',
  'goal_id',
  'created_at',
  'updated_at',
  'archived_at',
] as const;

export const TODO_DOMAIN_FIELDS = [
  'id',
  'userId',
  'title',
  'description',
  'categories',
  'goalId',
  'createdAt',
  'updatedAt',
  'archivedAt',
] as const;

export const TODO_VALIDATION_MESSAGES = {
  signedIn: 'Sign in to manage to-dos.',
  owner: 'You can only manage your own to-dos.',
  title: 'Give this to-do a name.',
  titleTooLong: `Keep the name under ${PLANNING_TITLE_MAX_LENGTH} characters.`,
  categories: 'Choose 1–3 areas this to-do supports.',
  categoriesUnknown: "Choose from Bettr's development areas.",
  goal: 'That goal could not be linked.',
  archive: 'That to-do status is not available.',
} as const;

export type TodoRow = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  categories: string[];
  goal_id: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type TodoInsertRow = {
  user_id: string;
  title: string;
  description: string | null;
  categories: PlanningCategoryKey[];
  goal_id: string | null;
  archived_at: null;
};

export type TodoUpdateRow = {
  title: string;
  description: string | null;
  categories: PlanningCategoryKey[];
  goal_id: string | null;
  updated_at: string;
};

export type TodoArchiveUpdateRow = {
  archived_at: string | null;
  updated_at: string;
};

export type TodoWriteInput = {
  title: unknown;
  description?: unknown;
  categories: unknown;
  goalId?: unknown;
};

export type TodoPrepareSuccess<T> = { ok: true; value: T };
export type TodoPrepareFailure = { ok: false; error: string };
export type TodoPrepareResult<T> = TodoPrepareSuccess<T> | TodoPrepareFailure;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeTitle(value: unknown): TodoPrepareResult<string> {
  if (typeof value !== 'string') {
    return { ok: false, error: TODO_VALIDATION_MESSAGES.title };
  }
  const trimmed = value.trim();
  if (trimmed.length < 1) {
    return { ok: false, error: TODO_VALIDATION_MESSAGES.title };
  }
  if (trimmed.length > PLANNING_TITLE_MAX_LENGTH) {
    return { ok: false, error: TODO_VALIDATION_MESSAGES.titleTooLong };
  }
  if (!isValidPlanningTitle(trimmed)) {
    return { ok: false, error: TODO_VALIDATION_MESSAGES.title };
  }
  return { ok: true, value: trimmed };
}

function normalizeDescription(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Rejects unknown keys. Dedupes while preserving first-seen order, then
 * requires exactly 1–3 canonical categories.
 */
export function normalizeTodoCategories(
  value: unknown
): TodoPrepareResult<PlanningCategoryKey[]> {
  if (!Array.isArray(value)) {
    return { ok: false, error: TODO_VALIDATION_MESSAGES.categories };
  }

  const unique: PlanningCategoryKey[] = [];
  for (const item of value) {
    if (!isPlanningCategoryKey(item)) {
      return { ok: false, error: TODO_VALIDATION_MESSAGES.categoriesUnknown };
    }
    if (!unique.includes(item)) unique.push(item);
  }

  if (unique.length < 1 || unique.length > 3) {
    return { ok: false, error: TODO_VALIDATION_MESSAGES.categories };
  }

  return { ok: true, value: unique };
}

function normalizeGoalId(value: unknown): TodoPrepareResult<string | null> {
  if (value === null || value === undefined || value === '') {
    return { ok: true, value: null };
  }
  if (!isNonEmptyString(value)) {
    return { ok: false, error: TODO_VALIDATION_MESSAGES.goal };
  }
  return { ok: true, value };
}

function requireOwnerId(ownerId: unknown): TodoPrepareResult<string> {
  if (!isNonEmptyString(ownerId)) {
    return { ok: false, error: TODO_VALIDATION_MESSAGES.signedIn };
  }
  return { ok: true, value: ownerId };
}

export function isTodoOpen(
  todo: Pick<Todo, 'archivedAt'> | { archived_at: string | null }
): boolean {
  if ('archivedAt' in todo) return todo.archivedAt === null;
  return todo.archived_at === null;
}

export function prepareTodoCreate(
  ownerId: unknown,
  input: TodoWriteInput
): TodoPrepareResult<TodoInsertRow> {
  const owner = requireOwnerId(ownerId);
  if (!owner.ok) return owner;

  const title = normalizeTitle(input.title);
  if (!title.ok) return title;

  const categories = normalizeTodoCategories(input.categories);
  if (!categories.ok) return categories;

  const goalId = normalizeGoalId(input.goalId);
  if (!goalId.ok) return goalId;

  const row: TodoInsertRow = {
    user_id: owner.value,
    title: title.value,
    description: normalizeDescription(input.description),
    categories: categories.value,
    goal_id: goalId.value,
    archived_at: TODO_CREATE_ARCHIVED_AT,
  };

  if (
    !isValidTodo({
      userId: row.user_id,
      title: row.title,
      description: row.description,
      categories: row.categories,
      goalId: row.goal_id,
      archivedAt: row.archived_at,
    })
  ) {
    return { ok: false, error: TODO_VALIDATION_MESSAGES.title };
  }

  return { ok: true, value: row };
}

export function prepareTodoUpdate(
  ownerId: unknown,
  input: TodoWriteInput
): TodoPrepareResult<TodoUpdateRow> {
  const created = prepareTodoCreate(ownerId, input);
  if (!created.ok) return created;

  return {
    ok: true,
    value: {
      title: created.value.title,
      description: created.value.description,
      categories: created.value.categories,
      goal_id: created.value.goal_id,
      updated_at: new Date().toISOString(),
    },
  };
}

/**
 * Complete (archived_at = now) or reopen (archived_at = null).
 * Planning adherence only — does not create Logs or award XP.
 * `nextDone === true` marks done; `false` reopens.
 */
export function prepareTodoArchiveTransition(
  nextDone: unknown
): TodoPrepareResult<TodoArchiveUpdateRow> {
  if (typeof nextDone !== 'boolean') {
    return { ok: false, error: TODO_VALIDATION_MESSAGES.archive };
  }
  return {
    ok: true,
    value: {
      archived_at: nextDone ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    },
  };
}

export function todoFromRow(row: unknown, ownerId: string): Todo | null {
  if (!isPlainObject(row)) return null;

  const id = row.id;
  const userId = row.user_id;
  const title = row.title;
  const description = row.description;
  const rawCategories = row.categories;
  const goalId = row.goal_id;
  const createdAt = row.created_at;
  const updatedAt = row.updated_at;
  const archivedAt = row.archived_at;

  if (!samePlanningOwner(ownerId, typeof userId === 'string' ? userId : null)) {
    return null;
  }
  if (!isNonEmptyString(id) || !isNonEmptyString(userId)) return null;
  if (typeof title !== 'string') return null;
  if (description !== null && typeof description !== 'string') return null;
  if (goalId !== null && typeof goalId !== 'string') return null;
  if (archivedAt !== null && typeof archivedAt !== 'string') return null;
  if (!isNonEmptyString(createdAt) || !isNonEmptyString(updatedAt)) return null;
  if (!isValidPlanningCategories(rawCategories)) return null;

  const todo: Todo = {
    id,
    userId,
    title: title.trim(),
    description:
      typeof description === 'string' && description.trim() ? description : null,
    categories: rawCategories,
    goalId,
    createdAt,
    updatedAt,
    archivedAt,
  };

  if (
    !isValidTodo({
      userId: todo.userId,
      title: todo.title,
      description: todo.description,
      categories: todo.categories,
      goalId: todo.goalId,
      archivedAt: todo.archivedAt,
    })
  ) {
    return null;
  }

  return todo;
}

export function mapOwnedTodoRows(rows: unknown, ownerId: string): Todo[] {
  if (!Array.isArray(rows)) return [];
  const todos: Todo[] = [];
  for (const row of rows) {
    const todo = todoFromRow(row, ownerId);
    if (todo) todos.push(todo);
  }
  return todos;
}
