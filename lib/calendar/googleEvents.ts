/**
 * Google Calendar event HTTP. Server-only. No googleapis package.
 * Confirmed writes always send status=confirmed so a cancelled event id
 * can be restored instead of creating a duplicate.
 */
import type { GoogleCalendarEventBody } from './eventPayload';

export type GoogleEventRecord = {
  id: string;
  status?: string;
};

export type GoogleEventGetResult =
  | { kind: 'ok'; event: GoogleEventRecord }
  | { kind: 'cancelled'; event: GoogleEventRecord }
  | { kind: 'missing' }
  | { kind: 'error'; message: string };

export type GoogleEventWriteResult =
  | { kind: 'ok'; event: GoogleEventRecord }
  | { kind: 'exists'; eventId: string }
  | { kind: 'missing' }
  | { kind: 'error'; message: string };

export type GoogleEventDeleteResult =
  | { kind: 'ok' }
  | { kind: 'missing' }
  | { kind: 'error'; message: string };

export type GoogleCalendarEventsClient = {
  getEvent: (options: {
    accessToken: string;
    calendarId: string;
    eventId: string;
  }) => Promise<GoogleEventGetResult>;
  insertEvent: (options: {
    accessToken: string;
    calendarId: string;
    body: GoogleCalendarEventBody;
  }) => Promise<GoogleEventWriteResult>;
  patchEvent: (options: {
    accessToken: string;
    calendarId: string;
    eventId: string;
    body: Omit<GoogleCalendarEventBody, 'id'>;
  }) => Promise<GoogleEventWriteResult>;
  deleteEvent: (options: {
    accessToken: string;
    calendarId: string;
    eventId: string;
  }) => Promise<GoogleEventDeleteResult>;
};

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

function eventUrl(
  calendarId: string,
  eventId?: string,
  query?: Record<string, string>
): string {
  const calendar = encodeURIComponent(calendarId);
  const path = eventId
    ? `${CALENDAR_API}/calendars/${calendar}/events/${encodeURIComponent(eventId)}`
    : `${CALENDAR_API}/calendars/${calendar}/events`;
  if (!query) return path;
  return `${path}?${new URLSearchParams(query).toString()}`;
}

function safeGoogleError(_status: number): string {
  return 'Google Calendar could not be updated.';
}

async function readEventRecord(
  response: Response
): Promise<GoogleEventRecord | null> {
  const payload = (await response.json().catch(() => ({}))) as {
    id?: unknown;
    status?: unknown;
  };
  if (typeof payload.id !== 'string' || !payload.id) return null;
  return {
    id: payload.id,
    status: typeof payload.status === 'string' ? payload.status : undefined,
  };
}

function writeBody(body: object): string {
  return JSON.stringify({ ...body, status: 'confirmed' });
}

export async function googleGetEvent(options: {
  accessToken: string;
  calendarId: string;
  eventId: string;
}): Promise<GoogleEventGetResult> {
  try {
    const response = await fetch(
      eventUrl(options.calendarId, options.eventId, { showDeleted: 'true' }),
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${options.accessToken}` },
      }
    );
    if (response.status === 404 || response.status === 410) {
      return { kind: 'missing' };
    }
    if (!response.ok) {
      return { kind: 'error', message: safeGoogleError(response.status) };
    }
    const event = await readEventRecord(response);
    if (!event) return { kind: 'error', message: safeGoogleError(response.status) };
    if (event.status === 'cancelled') {
      return { kind: 'cancelled', event };
    }
    return { kind: 'ok', event };
  } catch {
    return { kind: 'error', message: 'Google Calendar is unavailable.' };
  }
}

export async function googleInsertEvent(options: {
  accessToken: string;
  calendarId: string;
  body: GoogleCalendarEventBody;
}): Promise<GoogleEventWriteResult> {
  try {
    const response = await fetch(eventUrl(options.calendarId), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: writeBody(options.body),
    });
    if (response.status === 409) {
      return { kind: 'exists', eventId: options.body.id };
    }
    if (!response.ok) {
      return { kind: 'error', message: safeGoogleError(response.status) };
    }
    const event = await readEventRecord(response);
    return { kind: 'ok', event: event ?? { id: options.body.id, status: 'confirmed' } };
  } catch {
    return { kind: 'error', message: 'Google Calendar is unavailable.' };
  }
}

export async function googlePatchEvent(options: {
  accessToken: string;
  calendarId: string;
  eventId: string;
  body: Omit<GoogleCalendarEventBody, 'id'>;
}): Promise<GoogleEventWriteResult> {
  try {
    const response = await fetch(eventUrl(options.calendarId, options.eventId), {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${options.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: writeBody(options.body),
    });
    if (response.status === 404 || response.status === 410) {
      return { kind: 'missing' };
    }
    if (!response.ok) {
      return { kind: 'error', message: safeGoogleError(response.status) };
    }
    const event = await readEventRecord(response);
    return { kind: 'ok', event: event ?? { id: options.eventId, status: 'confirmed' } };
  } catch {
    return { kind: 'error', message: 'Google Calendar is unavailable.' };
  }
}

export async function googleDeleteEvent(options: {
  accessToken: string;
  calendarId: string;
  eventId: string;
}): Promise<GoogleEventDeleteResult> {
  try {
    const response = await fetch(eventUrl(options.calendarId, options.eventId), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${options.accessToken}` },
    });
    if (response.status === 404 || response.status === 410) {
      return { kind: 'missing' };
    }
    if (!response.ok) {
      return { kind: 'error', message: safeGoogleError(response.status) };
    }
    return { kind: 'ok' };
  } catch {
    return { kind: 'error', message: 'Google Calendar is unavailable.' };
  }
}

export const liveGoogleCalendarEventsClient: GoogleCalendarEventsClient = {
  getEvent: googleGetEvent,
  insertEvent: googleInsertEvent,
  patchEvent: googlePatchEvent,
  deleteEvent: googleDeleteEvent,
};
