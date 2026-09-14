/**
 * Locked production taxonomy, mirrored (not imported) so planning stays
 * off the XP / semantic evaluation path. Tests lock this to CATEGORY_KEYS.
 */
export const PLANNING_CATEGORY_KEYS = [
  'appearance',
  'fashion',
  'academics',
  'career',
  'finance',
  'nutrition',
  'social',
  'physical',
  'mind',
  'inner',
  'spirituality',
] as const;

export type PlanningCategoryKey = (typeof PLANNING_CATEGORY_KEYS)[number];

export const PERSISTED_OCCURRENCE_STATUSES = [
  'planned',
  'completed',
  'skipped',
  'rescheduled',
] as const;

export type PersistedOccurrenceStatus = (typeof PERSISTED_OCCURRENCE_STATUSES)[number];

/** Derived only. Never stored. */
export const DERIVED_OCCURRENCE_STATE = 'unresolved' as const;

export type DerivedOccurrenceState = PersistedOccurrenceStatus | typeof DERIVED_OCCURRENCE_STATE;

export const PLANNING_COMPLETION_MODES = ['light', 'log'] as const;

export type PlanningCompletionMode = (typeof PLANNING_COMPLETION_MODES)[number];

export const PLANNING_OCCURRENCE_SOURCES = ['routine', 'todo'] as const;

export type PlanningOccurrenceSource = (typeof PLANNING_OCCURRENCE_SOURCES)[number];

export const PLANNING_RECURRENCE_TYPES = ['daily', 'weekly'] as const;

export type PlanningRecurrenceType = (typeof PLANNING_RECURRENCE_TYPES)[number];

export const PLANNING_GOAL_STATUSES = ['active', 'completed', 'archived'] as const;

export type PlanningGoalStatus = (typeof PLANNING_GOAL_STATUSES)[number];

/**
 * Allowed Goal status transitions. Same-status is a no-op.
 * Destructive deletion is not part of the Goal write path.
 */
export const GOAL_STATUS_TRANSITIONS: Record<
  PlanningGoalStatus,
  readonly PlanningGoalStatus[]
> = {
  active: ['completed', 'archived'],
  completed: ['active', 'archived'],
  archived: ['active'],
};

/** ISO-8601 weekday: Monday = 1 … Sunday = 7. */
export const PLANNING_ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export type PlanningIsoWeekday = (typeof PLANNING_ISO_WEEKDAYS)[number];

export const PLANNING_TITLE_MAX_LENGTH = 200;

export type Goal = {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  categories: PlanningCategoryKey[];
  targetDate: string | null;
  status: PlanningGoalStatus;
  createdAt: string;
  updatedAt: string;
};

export type Routine = {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  categories: PlanningCategoryKey[];
  goalId: string | null;
  recurrenceType: PlanningRecurrenceType;
  weekdays: PlanningIsoWeekday[] | null;
  scheduledTime: string | null;
  durationMinutes: number | null;
  timezone: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Todo = {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  categories: PlanningCategoryKey[];
  goalId: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type PlannedOccurrence = {
  id: string;
  userId: string;
  sourceType: PlanningOccurrenceSource;
  routineId: string | null;
  todoId: string | null;
  scheduledDate: string;
  scheduledTime: string | null;
  timezone: string;
  durationMinutes: number | null;
  status: PersistedOccurrenceStatus;
  completionMode: PlanningCompletionMode | null;
  logId: string | null;
  resolvedAt: string | null;
  rescheduledToId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OccurrenceSchedule = Pick<
  PlannedOccurrence,
  'scheduledDate' | 'scheduledTime' | 'timezone'
>;

export type OccurrenceCombinationInput = Pick<
  PlannedOccurrence,
  | 'status'
  | 'completionMode'
  | 'logId'
  | 'resolvedAt'
  | 'rescheduledToId'
>;

export type OccurrenceSourceInput = Pick<
  PlannedOccurrence,
  'sourceType' | 'routineId' | 'todoId'
>;
