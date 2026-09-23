/**
 * Establish or recover the dedicated Bettr destination calendar.
 * Ownership is the description tag + owner role, never display name.
 */
import {
  BETTR_DESTINATION_SUMMARY,
  bettrDestinationDescription,
  isPersistedDedicatedCalendarId,
  selectOwnedBettrDestination,
} from './destination';
import type { GoogleCalendarsClient } from './googleCalendars';

export type EnsureDestinationResult =
  | { ok: true; calendarId: string; created: boolean }
  | { ok: false; reason: string };

export async function ensureBettrDestinationCalendar(options: {
  userId: string;
  accessToken: string;
  storedCalendarId: string;
  calendars: GoogleCalendarsClient;
}): Promise<EnsureDestinationResult> {
  const { userId, accessToken, storedCalendarId, calendars } = options;

  if (isPersistedDedicatedCalendarId(storedCalendarId)) {
    const existing = await calendars.getCalendar({
      accessToken,
      calendarId: storedCalendarId,
    });
    if (existing.kind === 'ok') {
      return { ok: true, calendarId: storedCalendarId, created: false };
    }
    if (existing.kind === 'error') {
      return { ok: false, reason: existing.message };
    }
  }

  const listed = await calendars.listCalendarList({ accessToken });
  if (listed.kind === 'error') {
    return { ok: false, reason: listed.message };
  }
  const recovered = selectOwnedBettrDestination(listed.entries, userId);
  if (recovered) {
    return { ok: true, calendarId: recovered, created: false };
  }

  const created = await calendars.insertCalendar({
    accessToken,
    summary: BETTR_DESTINATION_SUMMARY,
    description: bettrDestinationDescription(userId),
  });
  if (created.kind === 'error') {
    return { ok: false, reason: created.message };
  }
  return { ok: true, calendarId: created.calendarId, created: true };
}
