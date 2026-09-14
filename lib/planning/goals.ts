/**
 * Goal write/normalization and database mapping.
 * Intention only: no XP, semantic evaluation, or Log scoring.
 */
import {
  isLocalScheduledDate,
  isPlanningCategoryKey,
  isPlanningGoalStatus,
  isValidGoal,
  isValidGoalStatusTransition,
  isValidPlanningCategories,
  isValidPlanningTitle,
  samePlanningOwner,
} from './invariants';
import {
  PLANNING_TITLE_MAX_LENGTH,
  type Goal,
  type PlanningCategoryKey,
  type PlanningGoalStatus,
} from './types';

export const GOAL_CREATE_STATUS = 'active' as const satisfies PlanningGoalStatus;

export const GOAL_TABLE_COLUMNS = [
  'id',
  'user_id',
  'title',
  'description',
  'categories',
  'target_date',
  'status',
  'created_at',
  'updated_at',
] as const;

export const GOAL_DOMAIN_FIELDS = [
  'id',
  'userId',
  'title',
  'description',
  'categories',
  'targetDate',
  'status',
  'createdAt',
  'updatedAt',
] as const;

export const GOAL_VALIDATION_MESSAGES = {
  signedIn: 'Sign in to manage goals.',
  owner: 'You can only manage your own goals.',
  title: 'Give this goal a name.',
  titleTooLong: `Keep the name under ${PLANNING_TITLE_MAX_LENGTH} characters.`,
  categories: 'Choose 1–3 areas this goal supports.',
  categoriesUnknown: 'Choose from Bettr\'s development areas.',
  status: 'That goal status is not available.',
  transition: 'That status change is not allowed.',
  targetDate: 'Use a real calendar date.',
} as const;

export type GoalRow = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  categories: string[];
  target_date: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type GoalInsertRow = {
  user_id: string;
  title: string;
  description: string | null;
  categories: PlanningCategoryKey[];
  target_date: string | null;
  status: PlanningGoalStatus;
};

export type GoalUpdateRow = {
  title: string;
  description: string | null;
  categories: PlanningCategoryKey[];
  target_date: string | null;
  updated_at: string;
};

export type GoalStatusUpdateRow = {
  status: PlanningGoalStatus;
  updated_at: string;
};

export type GoalWriteInput = {
  title: unknown;
  description?: unknown;
  categories: unknown;
  targetDate?: unknown;
};

export type GoalPrepareSuccess<T> = { ok: true; value: T };
export type GoalPrepareFailure = { ok: false; error: string };
export type GoalPrepareResult<T> = GoalPrepareSuccess<T> | GoalPrepareFailure;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeTitle(value: unknown): GoalPrepareResult<string> {
  if (typeof value !== 'string') {
    return { ok: false, error: GOAL_VALIDATION_MESSAGES.title };
  }
  const trimmed = value.trim();
  if (trimmed.length < 1) {
    return { ok: false, error: GOAL_VALIDATION_MESSAGES.title };
  }
  if (trimmed.length > PLANNING_TITLE_MAX_LENGTH) {
    return { ok: false, error: GOAL_VALIDATION_MESSAGES.titleTooLong };
  }
  if (!isValidPlanningTitle(trimmed)) {
    return { ok: false, error: GOAL_VALIDATION_MESSAGES.title };
  }
  return { ok: true, value: trimmed };
}

function normalizeDescription(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeTargetDate(value: unknown): GoalPrepareResult<string | null> {
  if (value === null || value === undefined || value === '') {
    return { ok: true, value: null };
  }
  if (typeof value !== 'string' || !isLocalScheduledDate(value)) {
    return { ok: false, error: GOAL_VALIDATION_MESSAGES.targetDate };
  }
  return { ok: true, value };
}

/**
 * Rejects unknown keys. Dedupes while preserving first-seen order, then
 * requires exactly 1–3 canonical categories.
 */
export function normalizeGoalCategories(
  value: unknown
): GoalPrepareResult<PlanningCategoryKey[]> {
  if (!Array.isArray(value)) {
    return { ok: false, error: GOAL_VALIDATION_MESSAGES.categories };
  }

  const unique: PlanningCategoryKey[] = [];
  for (const item of value) {
    if (!isPlanningCategoryKey(item)) {
      return { ok: false, error: GOAL_VALIDATION_MESSAGES.categoriesUnknown };
    }
    if (!unique.includes(item)) unique.push(item);
  }

  if (unique.length < 1 || unique.length > 3) {
    return { ok: false, error: GOAL_VALIDATION_MESSAGES.categories };
  }

  return { ok: true, value: unique };
}

function requireOwnerId(ownerId: unknown): GoalPrepareResult<string> {
  if (!isNonEmptyString(ownerId)) {
    return { ok: false, error: GOAL_VALIDATION_MESSAGES.signedIn };
  }
  return { ok: true, value: ownerId };
}

export function prepareGoalCreate(
  ownerId: unknown,
  input: GoalWriteInput
): GoalPrepareResult<GoalInsertRow> {
  const owner = requireOwnerId(ownerId);
  if (!owner.ok) return owner;

  const title = normalizeTitle(input.title);
  if (!title.ok) return title;

  const categories = normalizeGoalCategories(input.categories);
  if (!categories.ok) return categories;

  const targetDate = normalizeTargetDate(input.targetDate);
  if (!targetDate.ok) return targetDate;

  const row: GoalInsertRow = {
    user_id: owner.value,
    title: title.value,
    description: normalizeDescription(input.description),
    categories: categories.value,
    target_date: targetDate.value,
    status: GOAL_CREATE_STATUS,
  };

  if (
    !isValidGoal({
      userId: row.user_id,
      title: row.title,
      description: row.description,
      categories: row.categories,
      targetDate: row.target_date,
      status: row.status,
    })
  ) {
    return { ok: false, error: GOAL_VALIDATION_MESSAGES.title };
  }

  return { ok: true, value: row };
}

export function prepareGoalUpdate(
  ownerId: unknown,
  input: GoalWriteInput
): GoalPrepareResult<GoalUpdateRow> {
  const created = prepareGoalCreate(ownerId, input);
  if (!created.ok) return created;

  return {
    ok: true,
    value: {
      title: created.value.title,
      description: created.value.description,
      categories: created.value.categories,
      target_date: created.value.target_date,
      updated_at: new Date().toISOString(),
    },
  };
}

export function prepareGoalStatusTransition(
  from: unknown,
  to: unknown
): GoalPrepareResult<GoalStatusUpdateRow> {
  if (!isPlanningGoalStatus(to)) {
    return { ok: false, error: GOAL_VALIDATION_MESSAGES.status };
  }
  if (!isValidGoalStatusTransition(from, to)) {
    return { ok: false, error: GOAL_VALIDATION_MESSAGES.transition };
  }
  return {
    ok: true,
    value: {
      status: to,
      updated_at: new Date().toISOString(),
    },
  };
}

export function goalFromRow(row: unknown, ownerId: string): Goal | null {
  if (!isPlainObject(row)) return null;

  const id = row.id;
  const userId = row.user_id;
  const title = row.title;
  const description = row.description;
  const rawCategories = row.categories;
  const targetDate = row.target_date;
  const status = row.status;
  const createdAt = row.created_at;
  const updatedAt = row.updated_at;

  if (!samePlanningOwner(ownerId, typeof userId === 'string' ? userId : null)) {
    return null;
  }
  if (!isNonEmptyString(id) || !isNonEmptyString(userId)) return null;
  if (typeof title !== 'string') return null;
  if (description !== null && typeof description !== 'string') return null;
  if (targetDate !== null && typeof targetDate !== 'string') return null;
  if (!isPlanningGoalStatus(status)) return null;
  if (!isNonEmptyString(createdAt) || !isNonEmptyString(updatedAt)) return null;
  if (!isValidPlanningCategories(rawCategories)) return null;

  const goal: Goal = {
    id,
    userId,
    title: title.trim(),
    description:
      typeof description === 'string' && description.trim() ? description : null,
    categories: rawCategories,
    targetDate,
    status,
    createdAt,
    updatedAt,
  };

  if (
    !isValidGoal({
      userId: goal.userId,
      title: goal.title,
      description: goal.description,
      categories: goal.categories,
      targetDate: goal.targetDate,
      status: goal.status,
    })
  ) {
    return null;
  }

  return goal;
}

export function mapOwnedGoalRows(rows: unknown, ownerId: string): Goal[] {
  if (!Array.isArray(rows)) return [];
  const goals: Goal[] = [];
  for (const row of rows) {
    const goal = goalFromRow(row, ownerId);
    if (goal) goals.push(goal);
  }
  return goals;
}
