import {
  DERIVED_OCCURRENCE_STATE,
  PERSISTED_OCCURRENCE_STATUSES,
  PLANNING_CATEGORY_KEYS,
  PLANNING_COMPLETION_MODES,
  GOAL_STATUS_TRANSITIONS,
  PLANNING_GOAL_STATUSES,
  PLANNING_ISO_WEEKDAYS,
  PLANNING_OCCURRENCE_SOURCES,
  PLANNING_RECURRENCE_TYPES,
  PLANNING_TITLE_MAX_LENGTH,
  type DerivedOccurrenceState,
  type Goal,
  type OccurrenceCombinationInput,
  type OccurrenceSchedule,
  type OccurrenceSourceInput,
  type PersistedOccurrenceStatus,
  type PlannedOccurrence,
  type PlanningCategoryKey,
  type PlanningCompletionMode,
  type PlanningGoalStatus,
  type PlanningIsoWeekday,
  type PlanningOccurrenceSource,
  type PlanningRecurrenceType,
  type Routine,
  type Todo,
} from './types';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNullableId(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function isPersistedOccurrenceStatus(
  value: unknown
): value is PersistedOccurrenceStatus {
  return (
    typeof value === 'string' &&
    (PERSISTED_OCCURRENCE_STATUSES as readonly string[]).includes(value)
  );
}

export function isPlanningCategoryKey(value: unknown): value is PlanningCategoryKey {
  return (
    typeof value === 'string' &&
    (PLANNING_CATEGORY_KEYS as readonly string[]).includes(value)
  );
}

export function isPlanningGoalStatus(value: unknown): value is PlanningGoalStatus {
  return (
    typeof value === 'string' &&
    (PLANNING_GOAL_STATUSES as readonly string[]).includes(value)
  );
}

export function isValidGoalStatusTransition(
  from: unknown,
  to: unknown
): boolean {
  if (!isPlanningGoalStatus(from) || !isPlanningGoalStatus(to)) return false;
  if (from === to) return true;
  return (GOAL_STATUS_TRANSITIONS[from] as readonly string[]).includes(to);
}

export function isValidPlanningCategories(
  value: unknown
): value is PlanningCategoryKey[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) return false;
  if (!value.every(isPlanningCategoryKey)) return false;
  return new Set(value).size === value.length;
}

export function isValidPlanningTitle(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= PLANNING_TITLE_MAX_LENGTH;
}

export function isPlanningRecurrenceType(
  value: unknown
): value is PlanningRecurrenceType {
  return (
    typeof value === 'string' &&
    (PLANNING_RECURRENCE_TYPES as readonly string[]).includes(value)
  );
}

export function isPlanningIsoWeekday(value: unknown): value is PlanningIsoWeekday {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    (PLANNING_ISO_WEEKDAYS as readonly number[]).includes(value)
  );
}

export function isValidRoutineRecurrence(
  recurrenceType: unknown,
  weekdays: unknown
): boolean {
  if (!isPlanningRecurrenceType(recurrenceType)) return false;
  if (recurrenceType === 'daily') return weekdays === null;
  if (!Array.isArray(weekdays) || weekdays.length < 1 || weekdays.length > 7) {
    return false;
  }
  if (!weekdays.every(isPlanningIsoWeekday)) return false;
  return new Set(weekdays).size === weekdays.length;
}

export function isValidDurationMinutes(value: unknown): value is number | null {
  if (value === null) return true;
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function isIanaTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '' || value.trim() !== value) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function isLocalScheduledDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
}

export function isLocalScheduledTime(value: unknown): value is string {
  return typeof value === 'string' && LOCAL_TIME.test(value);
}

export function normalizeLocalScheduledTime(value: string): string {
  return value.length === 5 ? `${value}:00` : value;
}

export function isPlanningOccurrenceSource(
  value: unknown
): value is PlanningOccurrenceSource {
  return (
    typeof value === 'string' &&
    (PLANNING_OCCURRENCE_SOURCES as readonly string[]).includes(value)
  );
}

export function isPlanningCompletionMode(
  value: unknown
): value is PlanningCompletionMode {
  return (
    typeof value === 'string' &&
    (PLANNING_COMPLETION_MODES as readonly string[]).includes(value)
  );
}

export function isValidOccurrenceSource(input: OccurrenceSourceInput): boolean {
  if (input.sourceType === 'routine') {
    return isNonEmptyString(input.routineId) && input.todoId === null;
  }
  if (input.sourceType === 'todo') {
    return isNonEmptyString(input.todoId) && input.routineId === null;
  }
  return false;
}

/**
 * Structural validity of a persisted occurrence combination.
 *
 * completed/log with log_id=null is representable because
 * planned_occurrences.log_id uses ON DELETE SET NULL. This is not
 * permission to INSERT or transition into that state.
 */
export function isValidOccurrenceCombination(
  input: OccurrenceCombinationInput
): boolean {
  const { status, completionMode, logId, resolvedAt, rescheduledToId } = input;

  if (status === 'planned') {
    return (
      completionMode === null &&
      logId === null &&
      resolvedAt === null &&
      rescheduledToId === null
    );
  }

  if (status === 'completed' && completionMode === 'light') {
    return (
      logId === null &&
      isNonEmptyString(resolvedAt) &&
      rescheduledToId === null
    );
  }

  if (status === 'completed' && completionMode === 'log') {
    return isNonEmptyString(resolvedAt) && rescheduledToId === null;
  }

  if (status === 'skipped') {
    return (
      completionMode === null &&
      logId === null &&
      isNonEmptyString(resolvedAt) &&
      rescheduledToId === null
    );
  }

  if (status === 'rescheduled') {
    return (
      completionMode === null &&
      logId === null &&
      isNonEmptyString(resolvedAt) &&
      isNonEmptyString(rescheduledToId)
    );
  }

  return false;
}

export function isLogBackedCompletion(input: OccurrenceCombinationInput): boolean {
  return input.status === 'completed' && input.completionMode === 'log';
}

/**
 * A Log-backed completion whose Log was deleted must stay
 * status=completed / completion_mode=log / log_id=null.
 */
export function isPreservedLogBackedCompletion(
  input: OccurrenceCombinationInput
): boolean {
  return (
    isLogBackedCompletion(input) &&
    input.logId === null &&
    isNonEmptyString(input.resolvedAt) &&
    input.rescheduledToId === null
  );
}

/**
 * Creating or transitioning INTO completed/log requires a real log_id.
 * A pure persisted-state check cannot infer deletion without previous state.
 */
export function isValidLogBackedCompletionEntry(
  input: OccurrenceCombinationInput
): boolean {
  return (
    isLogBackedCompletion(input) &&
    isNonEmptyString(input.logId) &&
    isNonEmptyString(input.resolvedAt) &&
    input.rescheduledToId === null
  );
}

export function isEnteringLogBackedCompletion(
  previous: OccurrenceCombinationInput | null,
  next: OccurrenceCombinationInput
): boolean {
  if (!isLogBackedCompletion(next)) return false;
  if (previous === null) return true;
  return !isLogBackedCompletion(previous);
}

export function reinterpretsLogBackedAsLightweight(
  from: OccurrenceCombinationInput,
  to: OccurrenceCombinationInput
): boolean {
  return from.completionMode === 'log' && to.completionMode === 'light';
}

/**
 * Write/transition validity. `previous === null` means INSERT.
 * Distinguishes preserved post-deletion rows from fabricating a new
 * log-backed completion without a Log.
 */
export function isValidOccurrenceWrite(
  previous: OccurrenceCombinationInput | null,
  next: OccurrenceCombinationInput
): boolean {
  if (!isValidOccurrenceCombination(next)) return false;
  if (
    previous !== null &&
    previous.completionMode === 'log' &&
    next.completionMode !== 'log'
  ) {
    return false;
  }
  if (isEnteringLogBackedCompletion(previous, next)) {
    return isValidLogBackedCompletionEntry(next);
  }
  return true;
}

function zonedDateTimeParts(
  now: Date,
  timeZone: string
): { date: string; time: string } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);

    const read = (type: string) => parts.find((part) => part.type === type)?.value;
    const year = read('year');
    const month = read('month');
    const day = read('day');
    const hour = read('hour');
    const minute = read('minute');
    const second = read('second');
    if (!year || !month || !day || !hour || !minute || !second) return null;
    return {
      date: `${year}-${month}-${day}`,
      time: `${hour}:${minute}:${second}`,
    };
  } catch {
    return null;
  }
}

export function isOccurrenceOverdue(
  schedule: OccurrenceSchedule,
  now: Date
): boolean {
  if (
    !isLocalScheduledDate(schedule.scheduledDate) ||
    !isIanaTimeZone(schedule.timezone)
  ) {
    return false;
  }
  if (schedule.scheduledTime !== null && !isLocalScheduledTime(schedule.scheduledTime)) {
    return false;
  }

  const local = zonedDateTimeParts(now, schedule.timezone);
  if (!local) return false;
  if (local.date > schedule.scheduledDate) return true;
  if (local.date < schedule.scheduledDate) return false;
  if (schedule.scheduledTime === null) return false;
  return local.time > normalizeLocalScheduledTime(schedule.scheduledTime);
}

export function deriveOccurrenceState(
  occurrence: Pick<PlannedOccurrence, 'status'> & OccurrenceSchedule,
  now: Date
): DerivedOccurrenceState {
  if (occurrence.status !== 'planned') return occurrence.status;
  if (isOccurrenceOverdue(occurrence, now)) return DERIVED_OCCURRENCE_STATE;
  return 'planned';
}

export function isValidGoal(
  goal: Pick<
    Goal,
    'userId' | 'title' | 'description' | 'categories' | 'targetDate' | 'status'
  >
): boolean {
  return (
    isNonEmptyString(goal.userId) &&
    isValidPlanningTitle(goal.title) &&
    isNullableString(goal.description) &&
    isValidPlanningCategories(goal.categories) &&
    (goal.targetDate === null || isLocalScheduledDate(goal.targetDate)) &&
    isPlanningGoalStatus(goal.status)
  );
}

export function isValidRoutine(
  routine: Pick<
    Routine,
    | 'userId'
    | 'title'
    | 'description'
    | 'categories'
    | 'goalId'
    | 'recurrenceType'
    | 'weekdays'
    | 'scheduledTime'
    | 'durationMinutes'
    | 'timezone'
    | 'isActive'
  >
): boolean {
  return (
    isNonEmptyString(routine.userId) &&
    isValidPlanningTitle(routine.title) &&
    isNullableString(routine.description) &&
    isValidPlanningCategories(routine.categories) &&
    isNullableId(routine.goalId) &&
    isValidRoutineRecurrence(routine.recurrenceType, routine.weekdays) &&
    (routine.scheduledTime === null || isLocalScheduledTime(routine.scheduledTime)) &&
    isValidDurationMinutes(routine.durationMinutes) &&
    isIanaTimeZone(routine.timezone) &&
    typeof routine.isActive === 'boolean'
  );
}

export function isValidTodo(
  todo: Pick<
    Todo,
    'userId' | 'title' | 'description' | 'categories' | 'goalId' | 'archivedAt'
  >
): boolean {
  return (
    isNonEmptyString(todo.userId) &&
    isValidPlanningTitle(todo.title) &&
    isNullableString(todo.description) &&
    isValidPlanningCategories(todo.categories) &&
    isNullableId(todo.goalId) &&
    (todo.archivedAt === null || isNonEmptyString(todo.archivedAt))
  );
}

export function isValidPlannedOccurrence(occurrence: PlannedOccurrence): boolean {
  if (!isNonEmptyString(occurrence.id) || !isNonEmptyString(occurrence.userId)) {
    return false;
  }
  if (occurrence.status === 'rescheduled' && occurrence.rescheduledToId === occurrence.id) {
    return false;
  }
  return (
    isValidOccurrenceSource(occurrence) &&
    isValidOccurrenceCombination(occurrence) &&
    isLocalScheduledDate(occurrence.scheduledDate) &&
    (occurrence.scheduledTime === null || isLocalScheduledTime(occurrence.scheduledTime)) &&
    isIanaTimeZone(occurrence.timezone) &&
    isValidDurationMinutes(occurrence.durationMinutes)
  );
}

export function samePlanningOwner(
  ownerId: string,
  relatedOwnerId: string | null | undefined
): boolean {
  return isNonEmptyString(ownerId) && relatedOwnerId === ownerId;
}
