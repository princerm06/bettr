/**
 * Propagate a Routine's current schedule template onto already-materialized
 * planned occurrences. Intention only — no Calendar, Logs, XP, or Discipline.
 *
 * Scope: scheduled_time, duration_minutes, timezone.
 * Does not rewrite scheduled_date, status, or Move/reschedule history.
 */
import {
  isIanaTimeZone,
  isLocalScheduledTime,
  isValidDurationMinutes,
  isValidOccurrenceWrite,
  normalizeLocalScheduledTime,
} from './invariants';
import { OCCURRENCE_VALIDATION_MESSAGES } from './occurrences';
import type { PlannedOccurrence, Routine } from './types';

export const ROUTINE_SCHEDULE_PROPAGATION_ERROR =
  'Could not update existing planned days for this routine. Try saving again.';

export type RoutineScheduleTemplate = {
  scheduledTime: string | null;
  durationMinutes: number | null;
  timezone: string;
};

export type OccurrenceScheduleUpdateRow = {
  scheduled_time: string | null;
  duration_minutes: number | null;
  timezone: string;
  updated_at: string;
};

function normalizeTime(value: string | null): string | null {
  if (value === null) return null;
  return normalizeLocalScheduledTime(value).slice(0, 8);
}

export function routineScheduleTemplateFromRoutine(
  routine: Pick<Routine, 'scheduledTime' | 'durationMinutes' | 'timezone'>
): RoutineScheduleTemplate {
  return {
    scheduledTime: normalizeTime(routine.scheduledTime),
    durationMinutes: routine.durationMinutes,
    timezone: routine.timezone,
  };
}

export function isMoveDestinationOccurrence(
  occurrenceId: string,
  siblings: readonly Pick<PlannedOccurrence, 'rescheduledToId'>[]
): boolean {
  return siblings.some((row) => row.rescheduledToId === occurrenceId);
}

/**
 * Planned, unresolved, owned rows for this Routine. Excludes completed,
 * skipped, and rescheduled source history. Move destinations stay eligible
 * for time/duration/timezone (the user overrode date, not the template).
 */
export function isEligibleRoutineSchedulePropagation(
  occurrence: Pick<
    PlannedOccurrence,
    'userId' | 'sourceType' | 'routineId' | 'status' | 'rescheduledToId'
  >,
  options: { ownerId: string; routineId: string }
): boolean {
  if (occurrence.userId !== options.ownerId) return false;
  if (occurrence.sourceType !== 'routine') return false;
  if (occurrence.routineId !== options.routineId) return false;
  if (occurrence.status !== 'planned') return false;
  if (occurrence.rescheduledToId !== null) return false;
  return true;
}

export function occurrenceScheduleMatchesTemplate(
  occurrence: Pick<
    PlannedOccurrence,
    'scheduledTime' | 'durationMinutes' | 'timezone'
  >,
  template: RoutineScheduleTemplate
): boolean {
  return (
    normalizeTime(occurrence.scheduledTime) === template.scheduledTime &&
    occurrence.durationMinutes === template.durationMinutes &&
    occurrence.timezone === template.timezone
  );
}

export function selectOccurrencesForRoutineScheduleSync(
  occurrences: readonly PlannedOccurrence[],
  options: { ownerId: string; routineId: string; template: RoutineScheduleTemplate }
): PlannedOccurrence[] {
  return occurrences.filter(
    (row) =>
      isEligibleRoutineSchedulePropagation(row, options) &&
      !occurrenceScheduleMatchesTemplate(row, options.template)
  );
}

export function prepareOccurrenceRoutineScheduleUpdate(
  occurrence: PlannedOccurrence,
  template: RoutineScheduleTemplate,
  updatedAt: string
):
  | { ok: true; value: OccurrenceScheduleUpdateRow }
  | { ok: false; error: string } {
  if (
    !isValidOccurrenceWrite(
      {
        status: occurrence.status,
        completionMode: occurrence.completionMode,
        logId: occurrence.logId,
        resolvedAt: occurrence.resolvedAt,
        rescheduledToId: occurrence.rescheduledToId,
      },
      {
        status: occurrence.status,
        completionMode: occurrence.completionMode,
        logId: occurrence.logId,
        resolvedAt: occurrence.resolvedAt,
        rescheduledToId: occurrence.rescheduledToId,
      }
    )
  ) {
    return { ok: false, error: OCCURRENCE_VALIDATION_MESSAGES.invalid };
  }
  if (template.scheduledTime !== null && !isLocalScheduledTime(template.scheduledTime)) {
    return { ok: false, error: OCCURRENCE_VALIDATION_MESSAGES.invalid };
  }
  if (!isIanaTimeZone(template.timezone)) {
    return { ok: false, error: OCCURRENCE_VALIDATION_MESSAGES.invalid };
  }
  if (!isValidDurationMinutes(template.durationMinutes)) {
    return { ok: false, error: OCCURRENCE_VALIDATION_MESSAGES.invalid };
  }
  return {
    ok: true,
    value: {
      scheduled_time: template.scheduledTime,
      duration_minutes: template.durationMinutes,
      timezone: template.timezone,
      updated_at: updatedAt,
    },
  };
}
