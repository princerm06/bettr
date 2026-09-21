/**
 * Slice 6 reconciliation: skip and reschedule decisions.
 * Intention only — no Logs, XP, or semantic evaluation.
 */
import { COMPLETION_VALIDATION_MESSAGES } from './completion';
import {
  isLocalScheduledDate,
  isValidOccurrenceWrite,
} from './invariants';
import type { OccurrenceInsertDraft } from './materialize';
import type {
  OccurrenceCombinationInput,
  PlannedOccurrence,
} from './types';

export const RECONCILIATION_VALIDATION_MESSAGES = {
  notPlanned: COMPLETION_VALIDATION_MESSAGES.notReconcileable,
  invalidDate: 'Choose a date to move this to.',
  routineSameDate: 'Pick a different day for this routine.',
  routineCollision: 'That day already has this routine.',
  alreadyPlanned: 'This to-do already has a planned attempt.',
  invalid: COMPLETION_VALIDATION_MESSAGES.invalid,
} as const;

export type RescheduleDecision =
  | {
      kind: 'noop';
      previous: OccurrenceCombinationInput;
      reason: 'already_rescheduled';
      replacementId: string;
    }
  | {
      kind: 'apply';
      sourceNext: OccurrenceCombinationInput;
      replacementId: string;
      replacement: OccurrenceInsertDraft;
    }
  | { kind: 'reject'; error: string };

export function routineMoveCollides(
  source: Pick<PlannedOccurrence, 'id' | 'sourceType' | 'routineId'>,
  targetDate: string,
  existing: readonly Pick<
    PlannedOccurrence,
    'id' | 'sourceType' | 'routineId' | 'scheduledDate'
  >[]
): boolean {
  if (source.sourceType !== 'routine' || !source.routineId) return false;
  return existing.some(
    (row) =>
      row.id !== source.id &&
      row.sourceType === 'routine' &&
      row.routineId === source.routineId &&
      row.scheduledDate === targetDate
  );
}

export function todoHasOtherPlannedOccurrence(
  source: Pick<PlannedOccurrence, 'id' | 'sourceType' | 'todoId'>,
  existing: readonly Pick<
    PlannedOccurrence,
    'id' | 'sourceType' | 'todoId' | 'status'
  >[]
): boolean {
  if (source.sourceType !== 'todo' || !source.todoId) return false;
  return existing.some(
    (row) =>
      row.id !== source.id &&
      row.sourceType === 'todo' &&
      row.todoId === source.todoId &&
      row.status === 'planned'
  );
}

/**
 * Preserve the source row as rescheduled and describe a new planned replacement.
 * Caller inserts/updates in one transaction (v12 RPC).
 */
export function decideReschedule(options: {
  source: PlannedOccurrence;
  targetDate: string;
  replacementId: string;
  resolvedAt: string;
  existing: readonly Pick<
    PlannedOccurrence,
    | 'id'
    | 'sourceType'
    | 'routineId'
    | 'todoId'
    | 'scheduledDate'
    | 'status'
  >[];
}): RescheduleDecision {
  const { source, targetDate, replacementId, resolvedAt, existing } = options;
  const current: OccurrenceCombinationInput = {
    status: source.status,
    completionMode: source.completionMode,
    logId: source.logId,
    resolvedAt: source.resolvedAt,
    rescheduledToId: source.rescheduledToId,
  };

  if (current.status === 'rescheduled' && current.rescheduledToId) {
    return {
      kind: 'noop',
      previous: current,
      reason: 'already_rescheduled',
      replacementId: current.rescheduledToId,
    };
  }

  if (current.status !== 'planned') {
    return { kind: 'reject', error: RECONCILIATION_VALIDATION_MESSAGES.notPlanned };
  }
  if (!isLocalScheduledDate(targetDate)) {
    return { kind: 'reject', error: RECONCILIATION_VALIDATION_MESSAGES.invalidDate };
  }
  if (source.sourceType === 'routine' && source.scheduledDate === targetDate) {
    return {
      kind: 'reject',
      error: RECONCILIATION_VALIDATION_MESSAGES.routineSameDate,
    };
  }
  if (routineMoveCollides(source, targetDate, existing)) {
    return {
      kind: 'reject',
      error: RECONCILIATION_VALIDATION_MESSAGES.routineCollision,
    };
  }
  if (todoHasOtherPlannedOccurrence(source, existing)) {
    return {
      kind: 'reject',
      error: RECONCILIATION_VALIDATION_MESSAGES.alreadyPlanned,
    };
  }

  const sourceNext: OccurrenceCombinationInput = {
    status: 'rescheduled',
    completionMode: null,
    logId: null,
    resolvedAt,
    rescheduledToId: replacementId,
  };
  if (!isValidOccurrenceWrite(current, sourceNext)) {
    return { kind: 'reject', error: RECONCILIATION_VALIDATION_MESSAGES.invalid };
  }

  const replacement: OccurrenceInsertDraft = {
    userId: source.userId,
    sourceType: source.sourceType,
    routineId: source.routineId,
    todoId: source.todoId,
    scheduledDate: targetDate,
    scheduledTime: source.scheduledTime,
    timezone: source.timezone,
    durationMinutes: source.durationMinutes,
    status: 'planned',
    completionMode: null,
    logId: null,
    resolvedAt: null,
    rescheduledToId: null,
  };

  return {
    kind: 'apply',
    sourceNext,
    replacementId,
    replacement,
  };
}
