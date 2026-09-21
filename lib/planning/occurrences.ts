/**
 * Planned occurrence row mapping and write preparation.
 * Intention only: no XP / semantic evaluation.
 */
import {
  isIanaTimeZone,
  isLocalScheduledDate,
  isLocalScheduledTime,
  isPlanningCompletionMode,
  isPlanningOccurrenceSource,
  isPersistedOccurrenceStatus,
  isValidDurationMinutes,
  isValidOccurrenceSource,
  isValidOccurrenceWrite,
  isValidPlannedOccurrence,
  normalizeLocalScheduledTime,
  samePlanningOwner,
} from './invariants';
import type { OccurrenceInsertDraft } from './materialize';
import type {
  OccurrenceCombinationInput,
  PersistedOccurrenceStatus,
  PlannedOccurrence,
  PlanningCompletionMode,
  PlanningOccurrenceSource,
} from './types';

export const OCCURRENCE_TABLE_COLUMNS = [
  'id',
  'user_id',
  'source_type',
  'routine_id',
  'todo_id',
  'scheduled_date',
  'scheduled_time',
  'timezone',
  'duration_minutes',
  'status',
  'completion_mode',
  'log_id',
  'resolved_at',
  'rescheduled_to_id',
  'created_at',
  'updated_at',
] as const;

export const OCCURRENCE_VALIDATION_MESSAGES = {
  signedIn: 'Sign in to manage your plan.',
  owner: 'You can only manage your own plan.',
  notFound: 'That planned item could not be found.',
  invalid: 'That planned item is not valid.',
} as const;

export type OccurrenceRow = {
  id: string;
  user_id: string;
  source_type: string;
  routine_id: string | null;
  todo_id: string | null;
  scheduled_date: string;
  scheduled_time: string | null;
  timezone: string;
  duration_minutes: number | null;
  status: string;
  completion_mode: string | null;
  log_id: string | null;
  resolved_at: string | null;
  rescheduled_to_id: string | null;
  created_at: string;
  updated_at: string;
};

export type OccurrenceInsertRow = {
  user_id: string;
  source_type: PlanningOccurrenceSource;
  routine_id: string | null;
  todo_id: string | null;
  scheduled_date: string;
  scheduled_time: string | null;
  timezone: string;
  duration_minutes: number | null;
  status: 'planned';
  completion_mode: null;
  log_id: null;
  resolved_at: null;
  rescheduled_to_id: null;
};

export type OccurrenceCompletionUpdateRow = {
  status: PersistedOccurrenceStatus;
  completion_mode: PlanningCompletionMode | null;
  log_id: string | null;
  resolved_at: string | null;
  rescheduled_to_id: string | null;
  updated_at: string;
};

export type OccurrencePrepareSuccess<T> = { ok: true; value: T };
export type OccurrencePrepareFailure = { ok: false; error: string };
export type OccurrencePrepareResult<T> =
  | OccurrencePrepareSuccess<T>
  | OccurrencePrepareFailure;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mapScheduledTime(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !isLocalScheduledTime(value)) return null;
  return normalizeLocalScheduledTime(value).slice(0, 8);
}

export function occurrenceCombinationFromRow(
  row: Pick<
    OccurrenceRow,
    | 'status'
    | 'completion_mode'
    | 'log_id'
    | 'resolved_at'
    | 'rescheduled_to_id'
  >
): OccurrenceCombinationInput | null {
  if (!isPersistedOccurrenceStatus(row.status)) return null;
  if (
    row.completion_mode !== null &&
    !isPlanningCompletionMode(row.completion_mode)
  ) {
    return null;
  }
  return {
    status: row.status,
    completionMode: row.completion_mode,
    logId: row.log_id,
    resolvedAt: row.resolved_at,
    rescheduledToId: row.rescheduled_to_id,
  };
}

export function occurrenceFromRow(
  row: unknown,
  ownerId: string
): PlannedOccurrence | null {
  if (!isPlainObject(row)) return null;
  if (!samePlanningOwner(ownerId, typeof row.user_id === 'string' ? row.user_id : null)) {
    return null;
  }
  if (typeof row.id !== 'string' || !row.id) return null;
  if (!isPlanningOccurrenceSource(row.source_type)) return null;
  if (!isPersistedOccurrenceStatus(row.status)) return null;
  if (
    row.completion_mode !== null &&
    row.completion_mode !== undefined &&
    !isPlanningCompletionMode(row.completion_mode)
  ) {
    return null;
  }
  if (typeof row.scheduled_date !== 'string') return null;
  const scheduledDate = row.scheduled_date.slice(0, 10);
  if (!isLocalScheduledDate(scheduledDate)) return null;
  if (typeof row.timezone !== 'string' || !isIanaTimeZone(row.timezone)) {
    return null;
  }
  if (!isValidDurationMinutes(row.duration_minutes ?? null)) return null;

  const occurrence: PlannedOccurrence = {
    id: row.id,
    userId: ownerId,
    sourceType: row.source_type,
    routineId: typeof row.routine_id === 'string' ? row.routine_id : null,
    todoId: typeof row.todo_id === 'string' ? row.todo_id : null,
    scheduledDate,
    scheduledTime: mapScheduledTime(row.scheduled_time),
    timezone: row.timezone,
    durationMinutes:
      typeof row.duration_minutes === 'number' ? row.duration_minutes : null,
    status: row.status,
    completionMode:
      row.completion_mode === null || row.completion_mode === undefined
        ? null
        : row.completion_mode,
    logId: typeof row.log_id === 'string' ? row.log_id : null,
    resolvedAt: typeof row.resolved_at === 'string' ? row.resolved_at : null,
    rescheduledToId:
      typeof row.rescheduled_to_id === 'string' ? row.rescheduled_to_id : null,
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : '',
  };

  if (!isValidOccurrenceSource(occurrence)) return null;
  if (!isValidPlannedOccurrence(occurrence)) return null;
  return occurrence;
}

export function mapOwnedOccurrenceRows(
  rows: unknown,
  ownerId: string
): PlannedOccurrence[] {
  if (!Array.isArray(rows)) return [];
  const mapped: PlannedOccurrence[] = [];
  for (const row of rows) {
    const occurrence = occurrenceFromRow(row, ownerId);
    if (occurrence) mapped.push(occurrence);
  }
  return mapped;
}

export function prepareOccurrenceInsert(
  draft: OccurrenceInsertDraft
): OccurrencePrepareResult<OccurrenceInsertRow> {
  if (!isValidOccurrenceSource(draft)) {
    return { ok: false, error: OCCURRENCE_VALIDATION_MESSAGES.invalid };
  }
  if (!isLocalScheduledDate(draft.scheduledDate)) {
    return { ok: false, error: OCCURRENCE_VALIDATION_MESSAGES.invalid };
  }
  if (
    draft.scheduledTime !== null &&
    !isLocalScheduledTime(draft.scheduledTime)
  ) {
    return { ok: false, error: OCCURRENCE_VALIDATION_MESSAGES.invalid };
  }
  if (!isIanaTimeZone(draft.timezone)) {
    return { ok: false, error: OCCURRENCE_VALIDATION_MESSAGES.invalid };
  }
  if (!isValidDurationMinutes(draft.durationMinutes)) {
    return { ok: false, error: OCCURRENCE_VALIDATION_MESSAGES.invalid };
  }

  return {
    ok: true,
    value: {
      user_id: draft.userId,
      source_type: draft.sourceType,
      routine_id: draft.routineId,
      todo_id: draft.todoId,
      scheduled_date: draft.scheduledDate,
      scheduled_time:
        draft.scheduledTime === null
          ? null
          : normalizeLocalScheduledTime(draft.scheduledTime).slice(0, 8),
      timezone: draft.timezone,
      duration_minutes: draft.durationMinutes,
      status: 'planned',
      completion_mode: null,
      log_id: null,
      resolved_at: null,
      rescheduled_to_id: null,
    },
  };
}

export function prepareOccurrenceCompletionUpdate(
  previous: OccurrenceCombinationInput,
  next: OccurrenceCombinationInput,
  updatedAt: string
): OccurrencePrepareResult<OccurrenceCompletionUpdateRow> {
  if (!isValidOccurrenceWrite(previous, next)) {
    return { ok: false, error: OCCURRENCE_VALIDATION_MESSAGES.invalid };
  }
  return {
    ok: true,
    value: {
      status: next.status,
      completion_mode: next.completionMode,
      log_id: next.logId,
      resolved_at: next.resolvedAt,
      rescheduled_to_id: next.rescheduledToId,
      updated_at: updatedAt,
    },
  };
}
