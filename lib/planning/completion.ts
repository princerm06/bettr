/**
 * Pure planned-occurrence completion transitions.
 * Adherence state only — does not create Logs, award XP, or run semantics.
 */
import {
  isValidOccurrenceWrite,
  isValidLogBackedCompletionEntry,
} from './invariants';
import type {
  OccurrenceCombinationInput,
  PlanningCompletionMode,
} from './types';

export const COMPLETION_VALIDATION_MESSAGES = {
  notPlanned: 'Only a planned item can be completed.',
  notReconcileable: 'Only a planned item can be skipped or moved.',
  missingLog: 'Log-backed completion requires a Log.',
  duplicateLog: 'This plan is already linked to a different Log.',
  cannotDowngrade: 'A Log-backed completion cannot become lightweight.',
  invalid: 'That completion state is not allowed.',
} as const;

export type CompletionDecision =
  | {
      kind: 'noop';
      previous: OccurrenceCombinationInput;
      reason:
        | 'already_light'
        | 'already_log'
        | 'same_log'
        | 'already_skipped'
        | 'already_rescheduled';
    }
  | { kind: 'apply'; next: OccurrenceCombinationInput }
  | { kind: 'reject'; error: string };

function asCombination(
  input: OccurrenceCombinationInput
): OccurrenceCombinationInput {
  return {
    status: input.status,
    completionMode: input.completionMode,
    logId: input.logId,
    resolvedAt: input.resolvedAt,
    rescheduledToId: input.rescheduledToId,
  };
}

/**
 * Lightweight completion: adherence only, no Log, no credit side effects.
 * Idempotent when already completed/light. Already completed/log is a no-op
 * (does not downgrade).
 */
export function decideLightCompletion(
  previous: OccurrenceCombinationInput,
  resolvedAt: string
): CompletionDecision {
  const current = asCombination(previous);

  if (current.status === 'completed' && current.completionMode === 'light') {
    return { kind: 'noop', previous: current, reason: 'already_light' };
  }
  if (current.status === 'completed' && current.completionMode === 'log') {
    return { kind: 'noop', previous: current, reason: 'already_log' };
  }
  if (current.status !== 'planned') {
    return { kind: 'reject', error: COMPLETION_VALIDATION_MESSAGES.notPlanned };
  }

  const next: OccurrenceCombinationInput = {
    status: 'completed',
    completionMode: 'light',
    logId: null,
    resolvedAt,
    rescheduledToId: null,
  };

  if (!isValidOccurrenceWrite(current, next)) {
    return { kind: 'reject', error: COMPLETION_VALIDATION_MESSAGES.invalid };
  }
  return { kind: 'apply', next };
}

/**
 * Log-backed completion / Add Details upgrade.
 * Reuses previous.logId when present (one occurrence → one Log).
 * Rejects linking a different Log after one is already attached.
 */
export function decideLogLinkedCompletion(
  previous: OccurrenceCombinationInput,
  logId: string,
  resolvedAt: string
): CompletionDecision {
  const current = asCombination(previous);

  if (!logId) {
    return { kind: 'reject', error: COMPLETION_VALIDATION_MESSAGES.missingLog };
  }

  if (current.status === 'completed' && current.completionMode === 'log') {
    if (current.logId === logId) {
      return { kind: 'noop', previous: current, reason: 'same_log' };
    }
    if (current.logId !== null && current.logId !== logId) {
      return { kind: 'reject', error: COMPLETION_VALIDATION_MESSAGES.duplicateLog };
    }
    // Preserved completed/log after Log deletion (log_id null): do not invent
    // a second Log link in Slice 5; treat as already resolved.
    return { kind: 'noop', previous: current, reason: 'already_log' };
  }

  if (current.status === 'skipped' || current.status === 'rescheduled') {
    return { kind: 'reject', error: COMPLETION_VALIDATION_MESSAGES.notPlanned };
  }

  const next: OccurrenceCombinationInput = {
    status: 'completed',
    completionMode: 'log',
    logId,
    resolvedAt: current.resolvedAt ?? resolvedAt,
    rescheduledToId: null,
  };

  if (!isValidOccurrenceWrite(current, next)) {
    return { kind: 'reject', error: COMPLETION_VALIDATION_MESSAGES.invalid };
  }
  if (!isValidLogBackedCompletionEntry(next)) {
    return { kind: 'reject', error: COMPLETION_VALIDATION_MESSAGES.missingLog };
  }
  return { kind: 'apply', next };
}

/** Prefer an existing linked Log for Add Details / retries. */
export function linkedLogIdForReuse(
  previous: OccurrenceCombinationInput
): string | null {
  return previous.logId;
}

/**
 * 0-or-1 Goal attribution from the intention source (Routine / To-Do).
 * Logs schema has no goal_id; attribution is derived, not denormalized.
 */
export function goalAttributionFromSource(source: {
  goalId: string | null;
}): string | null {
  return source.goalId;
}

/**
 * One-off To-Do completion is `todos.archived_at`, not a second done flag.
 * Completing a todo-sourced occurrence must close that To-Do.
 */
export function todoIdToCloseOnOccurrenceCompletion(occurrence: {
  sourceType: string;
  todoId: string | null;
}): string | null {
  if (occurrence.sourceType !== 'todo') return null;
  return occurrence.todoId;
}

/**
 * Skip: planned → skipped. No Log, no XP. Idempotent when already skipped.
 */
export function decideSkip(
  previous: OccurrenceCombinationInput,
  resolvedAt: string
): CompletionDecision {
  const current = asCombination(previous);

  if (current.status === 'skipped') {
    return { kind: 'noop', previous: current, reason: 'already_skipped' };
  }
  if (current.status !== 'planned') {
    return {
      kind: 'reject',
      error: COMPLETION_VALIDATION_MESSAGES.notReconcileable,
    };
  }

  const next: OccurrenceCombinationInput = {
    status: 'skipped',
    completionMode: null,
    logId: null,
    resolvedAt,
    rescheduledToId: null,
  };

  if (!isValidOccurrenceWrite(current, next)) {
    return { kind: 'reject', error: COMPLETION_VALIDATION_MESSAGES.invalid };
  }
  return { kind: 'apply', next };
}

export function completionModeLabel(
  mode: PlanningCompletionMode | null
): string {
  if (mode === 'light') return 'Done';
  if (mode === 'log') return 'Logged';
  return 'Planned';
}
