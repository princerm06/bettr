/**
 * Outbound calendar projection policy.
 * Provider-neutral: no Google API types, tokens, or event IDs.
 * Transport/idempotency lives in googleEvents / projection / withdraw.
 *
 * manual: Slice 2 test surface — any live planned occurrence.
 * automatic: timed planned occurrences only (scheduled_time required).
 */
export type ProjectionMode = 'manual' | 'automatic';

export type ProjectionOccurrence = {
  id: string;
  userId: string;
  sourceType: 'routine' | 'todo';
  routineId: string | null;
  todoId: string | null;
  scheduledDate: string;
  scheduledTime: string | null;
  timezone: string;
  durationMinutes: number | null;
  status: string;
};

export type EligibilityDecision =
  | { ok: true }
  | { ok: false; result: 'denied' | 'ineligible'; reason: string };

const TERMINAL_STATUSES = new Set(['completed', 'skipped', 'rescheduled']);

export function isTimedOccurrence(
  occurrence: Pick<ProjectionOccurrence, 'scheduledTime'>
): boolean {
  return Boolean(occurrence.scheduledTime && occurrence.scheduledTime.trim());
}

export function isLivePlannedOccurrence(
  occurrence: Pick<ProjectionOccurrence, 'status'>
): boolean {
  return occurrence.status === 'planned';
}

export function isTerminalOccurrenceStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function decideOccurrenceProjectionEligibility(options: {
  actorUserId: string;
  occurrence: ProjectionOccurrence | null;
  mode?: ProjectionMode;
  sourceAllowsExternalCalendar?: boolean;
}): EligibilityDecision {
  const mode = options.mode ?? 'manual';
  if (!options.occurrence) {
    return { ok: false, result: 'denied', reason: 'Occurrence was not found.' };
  }
  if (options.occurrence.userId !== options.actorUserId) {
    return { ok: false, result: 'denied', reason: 'Occurrence is not yours.' };
  }
  if (
    options.occurrence.sourceType !== 'routine' &&
    options.occurrence.sourceType !== 'todo'
  ) {
    return { ok: false, result: 'ineligible', reason: 'Unknown occurrence source.' };
  }
  if (!isLivePlannedOccurrence(options.occurrence)) {
    return {
      ok: false,
      result: 'ineligible',
      reason: `Status ${options.occurrence.status} is not projected.`,
    };
  }
  if (mode === 'automatic' && !isTimedOccurrence(options.occurrence)) {
    return {
      ok: false,
      result: 'ineligible',
      reason: 'Automatic projection requires a scheduled time.',
    };
  }
  if (
    mode === 'automatic' &&
    options.occurrence.sourceType === 'routine' &&
    options.sourceAllowsExternalCalendar === false
  ) {
    return {
      ok: false,
      result: 'ineligible',
      reason: 'This routine is not added to a connected calendar.',
    };
  }
  return { ok: true };
}

/**
 * Whether a live calendar copy should be withdrawn.
 * Skip / complete / reschedule-source always withdraw.
 * Automatic mode also withdraws date-only leftovers.
 */
export function shouldWithdrawProjectedCopy(options: {
  actorUserId: string;
  occurrence: ProjectionOccurrence | null;
  mode?: ProjectionMode;
  sourceAllowsExternalCalendar?: boolean;
}): EligibilityDecision {
  if (!options.occurrence) {
    return { ok: false, result: 'denied', reason: 'Occurrence was not found.' };
  }
  if (options.occurrence.userId !== options.actorUserId) {
    return { ok: false, result: 'denied', reason: 'Occurrence is not yours.' };
  }
  const mode = options.mode ?? 'automatic';
  if (isTerminalOccurrenceStatus(options.occurrence.status)) {
    return { ok: true };
  }
  if (mode === 'automatic' && !isTimedOccurrence(options.occurrence)) {
    return { ok: true };
  }
  if (
    mode === 'automatic' &&
    options.occurrence.sourceType === 'routine' &&
    options.sourceAllowsExternalCalendar === false
  ) {
    return { ok: true };
  }
  if (isLivePlannedOccurrence(options.occurrence) && mode === 'manual') {
    return {
      ok: false,
      result: 'ineligible',
      reason: 'Live planned copy is still projectable.',
    };
  }
  if (
    isLivePlannedOccurrence(options.occurrence) &&
    isTimedOccurrence(options.occurrence)
  ) {
    return {
      ok: false,
      result: 'ineligible',
      reason: 'Live timed copy is still projectable.',
    };
  }
  return { ok: true };
}

export function hasLiveProjectedCopy(syncStatus: string | null | undefined): boolean {
  return syncStatus === 'upserted' || syncStatus === 'error';
}

/**
 * Automatic reconcile decision for one already-materialized occurrence
 * (or a stale owned link whose occurrence is gone).
 */
export function decideAutomaticReconcileAction(options: {
  actorUserId: string;
  occurrence: ProjectionOccurrence | null;
  linkStatus: string | null;
  sourceAllowsExternalCalendar?: boolean;
}): 'project' | 'withdraw' | 'noop' {
  const live = hasLiveProjectedCopy(options.linkStatus);
  if (options.occurrence && options.occurrence.userId !== options.actorUserId) {
    return 'noop';
  }
  if (!options.occurrence) {
    return live ? 'withdraw' : 'noop';
  }
  const eligible = decideOccurrenceProjectionEligibility({
    actorUserId: options.actorUserId,
    occurrence: options.occurrence,
    mode: 'automatic',
    sourceAllowsExternalCalendar: options.sourceAllowsExternalCalendar,
  });
  if (eligible.ok) return 'project';
  return live ? 'withdraw' : 'noop';
}
