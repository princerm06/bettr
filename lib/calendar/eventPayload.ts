/**
 * V1 Google event body from a Bettr planned occurrence.
 *
 * Timed: Google start/end dateTime in the occurrence IANA timezone.
 *   Missing duration_minutes → 30-minute V1 default.
 * Date-only (no scheduled_time): all-day event. Google end.date is exclusive.
 *
 * Civil scheduled_date is used as-is. It is never reinterpreted through UTC
 * as a Unix instant that could shift the user's date.
 */
import {
  addMinutesToCivilDateTime,
  isCivilDate,
  isoWeekdayFromCivilDate,
  nextCivilDate,
  normalizeCivilTime,
} from './civilDate';
import { googleEventIdFromOccurrenceId } from './eventIdentity';
import type { ProjectionOccurrence } from './eligibility';

export const DEFAULT_TIMED_DURATION_MINUTES = 30;

export const BETTR_EVENT_DESCRIPTION =
  'Synced from Bettr. Google Calendar is a copy of this planned action; Bettr remains the source of truth.';

export type GoogleEventDateBound =
  | { dateTime: string; timeZone: string }
  | { date: string };

export type GoogleCalendarEventBody = {
  id: string;
  summary: string;
  description: string;
  start: GoogleEventDateBound;
  end: GoogleEventDateBound;
};

export type EventPayloadSource = {
  title: string;
  recurrenceType?: string | null;
  weekdayLabels?: Record<string, string> | null;
  /** Routine-only. Undefined for To-Dos (always allowed). */
  allowsExternalCalendar?: boolean;
};

export function effectiveProjectionTitle(
  occurrence: ProjectionOccurrence,
  source: EventPayloadSource
): string {
  const title = source.title.trim() || 'Bettr plan';
  if (occurrence.sourceType !== 'routine') return title;
  if (source.recurrenceType !== 'weekly' || !source.weekdayLabels) return title;
  const weekday = isoWeekdayFromCivilDate(occurrence.scheduledDate);
  if (weekday === null) return title;
  const label = source.weekdayLabels[String(weekday)]?.trim();
  return label || title;
}

export function buildGoogleEventPayload(
  occurrence: ProjectionOccurrence,
  source: EventPayloadSource
): GoogleCalendarEventBody {
  const summary = effectiveProjectionTitle(occurrence, source);
  const id = googleEventIdFromOccurrenceId(occurrence.id);
  const timed = Boolean(occurrence.scheduledTime);

  if (!timed) {
    if (!isCivilDate(occurrence.scheduledDate)) {
      throw new Error('Occurrence date is not valid.');
    }
    const endDate = nextCivilDate(occurrence.scheduledDate);
    if (!endDate) {
      throw new Error('Occurrence date is not valid.');
    }
    return {
      id,
      summary,
      description: BETTR_EVENT_DESCRIPTION,
      start: { date: occurrence.scheduledDate },
      end: { date: endDate },
    };
  }

  const startTime = normalizeCivilTime(occurrence.scheduledTime!);
  if (!startTime || !isCivilDate(occurrence.scheduledDate)) {
    throw new Error('Occurrence time is not valid.');
  }
  const duration =
    typeof occurrence.durationMinutes === 'number' &&
    Number.isInteger(occurrence.durationMinutes) &&
    occurrence.durationMinutes > 0
      ? occurrence.durationMinutes
      : DEFAULT_TIMED_DURATION_MINUTES;
  const end = addMinutesToCivilDateTime(
    occurrence.scheduledDate,
    startTime,
    duration
  );
  if (!end) {
    throw new Error('Occurrence end time is not valid.');
  }
  const timeZone = occurrence.timezone;
  return {
    id,
    summary,
    description: BETTR_EVENT_DESCRIPTION,
    start: {
      dateTime: `${occurrence.scheduledDate}T${startTime}`,
      timeZone,
    },
    end: {
      dateTime: `${end.date}T${end.time}`,
      timeZone,
    },
  };
}

export function googleEventPatchBody(
  payload: GoogleCalendarEventBody
): Omit<GoogleCalendarEventBody, 'id'> {
  const { id: _id, ...rest } = payload;
  return rest;
}
