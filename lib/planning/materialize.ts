/**
 * Lazy occurrence materialization drafts for a planning window.
 * Pure intention helpers — no persistence, XP, or semantics.
 */
import { isoWeekdayFromLocalDate, localCalendarDateInTimeZone } from './localCalendar';
import { isTodoOpen } from './todos';
import { isRoutineLiveForPlanning } from './routines';
import type {
  PlannedOccurrence,
  PlanningOccurrenceSource,
  Routine,
  Todo,
} from './types';

export type OccurrenceInsertDraft = {
  userId: string;
  sourceType: PlanningOccurrenceSource;
  routineId: string | null;
  todoId: string | null;
  scheduledDate: string;
  scheduledTime: string | null;
  timezone: string;
  durationMinutes: number | null;
  status: 'planned';
  completionMode: null;
  logId: null;
  resolvedAt: null;
  rescheduledToId: null;
};

export type MaterializeTodayInput = {
  now: Date;
  viewerTimeZone: string;
  ownerId: string;
  routines: readonly Routine[];
  todos: readonly Todo[];
  existing: readonly Pick<
    PlannedOccurrence,
    'id' | 'sourceType' | 'routineId' | 'todoId' | 'scheduledDate' | 'status'
  >[];
};

function hasRoutineOccurrence(
  existing: MaterializeTodayInput['existing'],
  routineId: string,
  scheduledDate: string
): boolean {
  return existing.some(
    (row) =>
      row.sourceType === 'routine' &&
      row.routineId === routineId &&
      row.scheduledDate === scheduledDate &&
      (row.status === 'planned' ||
        row.status === 'skipped' ||
        row.status === 'completed')
  );
}

function hasActiveTodoOccurrence(
  existing: MaterializeTodayInput['existing'],
  todoId: string
): boolean {
  return existing.some(
    (row) =>
      row.sourceType === 'todo' &&
      row.todoId === todoId &&
      row.status === 'planned'
  );
}

export function routineAppliesOnLocalDate(
  routine: Pick<Routine, 'isActive' | 'deletedAt' | 'recurrenceType' | 'weekdays'>,
  localDate: string
): boolean {
  if (!isRoutineLiveForPlanning(routine)) return false;
  if (routine.recurrenceType === 'daily') return true;
  const weekday = isoWeekdayFromLocalDate(localDate);
  if (weekday === null) return false;
  return Array.isArray(routine.weekdays) && routine.weekdays.includes(weekday);
}

export function draftRoutineOccurrenceForDate(
  routine: Routine,
  scheduledDate: string
): OccurrenceInsertDraft | null {
  if (routine.userId.trim() === '') return null;
  if (!routineAppliesOnLocalDate(routine, scheduledDate)) return null;
  return {
    userId: routine.userId,
    sourceType: 'routine',
    routineId: routine.id,
    todoId: null,
    scheduledDate,
    scheduledTime: routine.scheduledTime,
    timezone: routine.timezone,
    durationMinutes: routine.durationMinutes,
    status: 'planned',
    completionMode: null,
    logId: null,
    resolvedAt: null,
    rescheduledToId: null,
  };
}

export function draftTodoOccurrenceForDate(
  todo: Todo,
  scheduledDate: string,
  timezone: string
): OccurrenceInsertDraft | null {
  if (todo.userId.trim() === '') return null;
  if (!isTodoOpen(todo)) return null;
  return {
    userId: todo.userId,
    sourceType: 'todo',
    routineId: null,
    todoId: todo.id,
    scheduledDate,
    scheduledTime: null,
    timezone,
    durationMinutes: null,
    status: 'planned',
    completionMode: null,
    logId: null,
    resolvedAt: null,
    rescheduledToId: null,
  };
}

/**
 * Build missing planned_occurrence drafts for "today" without rewriting history.
 * Routines use each routine's timezone local date. Open to-dos use the viewer
 * timezone and materialize at most one active occurrence per to-do.
 */
export function buildMissingTodayOccurrenceDrafts(
  input: MaterializeTodayInput
): OccurrenceInsertDraft[] {
  const drafts: OccurrenceInsertDraft[] = [];
  const ownerId = input.ownerId;
  if (!ownerId) return drafts;

  for (const routine of input.routines) {
    if (routine.userId !== ownerId) continue;
    const localDate = localCalendarDateInTimeZone(input.now, routine.timezone);
    if (!localDate) continue;
    if (hasRoutineOccurrence(input.existing, routine.id, localDate)) continue;
    const draft = draftRoutineOccurrenceForDate(routine, localDate);
    if (draft) drafts.push(draft);
  }

  const viewerDate = localCalendarDateInTimeZone(
    input.now,
    input.viewerTimeZone
  );
  if (!viewerDate) return drafts;

  for (const todo of input.todos) {
    if (todo.userId !== ownerId) continue;
    if (hasActiveTodoOccurrence(input.existing, todo.id)) continue;
    const draft = draftTodoOccurrenceForDate(
      todo,
      viewerDate,
      input.viewerTimeZone
    );
    if (draft) drafts.push(draft);
  }

  return drafts;
}

/** Dates that belong on the Today surface for the given viewer/routines. */
export function todayScheduledDates(
  now: Date,
  viewerTimeZone: string,
  routines: readonly Pick<Routine, 'timezone'>[]
): string[] {
  const dates = new Set<string>();
  const viewerDate = localCalendarDateInTimeZone(now, viewerTimeZone);
  if (viewerDate) dates.add(viewerDate);
  for (const routine of routines) {
    const date = localCalendarDateInTimeZone(now, routine.timezone);
    if (date) dates.add(date);
  }
  return Array.from(dates).sort();
}

/**
 * Identity key for the Slice 5 uniqueness invariant:
 * - one live planned routine expectation per (routine, local date)
 * - skipped/completed history shares that date key so Today collapse does
 *   not show a duplicate planned twin
 * - one currently planned expectation per to-do (completed/skipped/rescheduled
 *   are historical and do not occupy the live identity)
 *
 * Archive skips planned rows; uniqueness is planned-only in v14 so a later
 * rematerialize of a new date is not blocked by skipped history. Same-date
 * rematerialize after skip remains blocked by hasRoutineOccurrence.
 *
 * Rescheduled rows keep per-id identity so historical reschedule chains
 * are never collapsed. This is deterministic uniqueness, not fuzzy dedupe.
 */
export function logicalOccurrenceIdentityKey(
  row: Pick<
    PlannedOccurrence,
    'id' | 'sourceType' | 'routineId' | 'todoId' | 'scheduledDate' | 'status'
  >
): string {
  if (row.sourceType === 'routine' && row.routineId) {
    return `routine:${row.routineId}:${row.scheduledDate}`;
  }
  if (row.sourceType === 'todo' && row.todoId) {
    if (row.status === 'planned') {
      return `todo:${row.todoId}`;
    }
    return `todo-history:${row.id}`;
  }
  return `row:${row.id}`;
}

function occurrencePreferenceScore(
  row: Pick<
    PlannedOccurrence,
    'status' | 'completionMode' | 'logId' | 'createdAt' | 'id'
  >
): number {
  // Higher is preferred when accidental duplicates already exist.
  if (row.status === 'completed' && row.completionMode === 'log' && row.logId) {
    return 400;
  }
  if (row.status === 'completed' && row.completionMode === 'log') return 350;
  if (row.status === 'completed' && row.completionMode === 'light') return 300;
  if (row.status === 'skipped') return 200;
  if (row.status === 'planned') return 100;
  if (row.status === 'rescheduled') return 50;
  return 0;
}

function preferLogicalOccurrence(
  candidate: PlannedOccurrence,
  incumbent: PlannedOccurrence
): boolean {
  const scoreDelta =
    occurrencePreferenceScore(candidate) - occurrencePreferenceScore(incumbent);
  if (scoreDelta !== 0) return scoreDelta > 0;
  // Prefer the earlier materialized row (stable first-write wins).
  if (candidate.createdAt !== incumbent.createdAt) {
    return candidate.createdAt < incumbent.createdAt;
  }
  return candidate.id < incumbent.id;
}

/**
 * Collapse accidental duplicate rows to at most one logical occurrence per
 * intended expectation. Preserves distinct rescheduled history rows.
 */
export function selectLogicalTodayOccurrences(
  rows: readonly PlannedOccurrence[]
): PlannedOccurrence[] {
  const bestByKey = new Map<string, PlannedOccurrence>();
  for (const row of rows) {
    const key = logicalOccurrenceIdentityKey(row);
    const incumbent = bestByKey.get(key);
    if (!incumbent || preferLogicalOccurrence(row, incumbent)) {
      bestByKey.set(key, row);
    }
  }
  return Array.from(bestByKey.values());
}
