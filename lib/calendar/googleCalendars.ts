/**
 * Google Calendar list/create HTTP. Server-only.
 * Calendars API has no private extendedProperties; ownership is a description tag.
 */
import type { DestinationCatalogEntry } from './destination';

export type GoogleCalendarGetResult =
  | { kind: 'ok'; calendar: DestinationCatalogEntry }
  | { kind: 'missing' }
  | { kind: 'error'; message: string };

export type GoogleCalendarWriteResult =
  | { kind: 'ok'; calendarId: string }
  | { kind: 'error'; message: string };

export type GoogleCalendarListResult =
  | { kind: 'ok'; entries: DestinationCatalogEntry[] }
  | { kind: 'error'; message: string };

export type GoogleCalendarsClient = {
  getCalendar: (options: {
    accessToken: string;
    calendarId: string;
  }) => Promise<GoogleCalendarGetResult>;
  insertCalendar: (options: {
    accessToken: string;
    summary: string;
    description: string;
  }) => Promise<GoogleCalendarWriteResult>;
  listCalendarList: (options: {
    accessToken: string;
  }) => Promise<GoogleCalendarListResult>;
};

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

function safeError(): string {
  return 'Google Calendar could not be updated.';
}

function mapEntry(payload: Record<string, unknown>): DestinationCatalogEntry | null {
  if (typeof payload.id !== 'string' || !payload.id) return null;
  return {
    id: payload.id,
    summary: typeof payload.summary === 'string' ? payload.summary : null,
    description: typeof payload.description === 'string' ? payload.description : null,
    accessRole: typeof payload.accessRole === 'string' ? payload.accessRole : null,
    primary: payload.primary === true,
  };
}

export async function googleGetCalendar(options: {
  accessToken: string;
  calendarId: string;
}): Promise<GoogleCalendarGetResult> {
  try {
    const response = await fetch(
      `${CALENDAR_API}/calendars/${encodeURIComponent(options.calendarId)}`,
      { headers: { Authorization: `Bearer ${options.accessToken}` } }
    );
    if (response.status === 404 || response.status === 410) {
      return { kind: 'missing' };
    }
    if (!response.ok) return { kind: 'error', message: safeError() };
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const calendar = mapEntry(payload);
    if (!calendar) return { kind: 'error', message: safeError() };
    return { kind: 'ok', calendar };
  } catch {
    return { kind: 'error', message: 'Google Calendar is unavailable.' };
  }
}

export async function googleInsertCalendar(options: {
  accessToken: string;
  summary: string;
  description: string;
}): Promise<GoogleCalendarWriteResult> {
  try {
    const response = await fetch(`${CALENDAR_API}/calendars`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary: options.summary,
        description: options.description,
      }),
    });
    if (!response.ok) return { kind: 'error', message: safeError() };
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof payload.id !== 'string' || !payload.id) {
      return { kind: 'error', message: safeError() };
    }
    return { kind: 'ok', calendarId: payload.id };
  } catch {
    return { kind: 'error', message: 'Google Calendar is unavailable.' };
  }
}

export async function googleListCalendarList(options: {
  accessToken: string;
}): Promise<GoogleCalendarListResult> {
  try {
    const entries: DestinationCatalogEntry[] = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({ maxResults: '250' });
      if (pageToken) params.set('pageToken', pageToken);
      const response = await fetch(
        `${CALENDAR_API}/users/me/calendarList?${params.toString()}`,
        { headers: { Authorization: `Bearer ${options.accessToken}` } }
      );
      if (!response.ok) return { kind: 'error', message: safeError() };
      const payload = (await response.json().catch(() => ({}))) as {
        items?: unknown;
        nextPageToken?: unknown;
      };
      if (!Array.isArray(payload.items)) return { kind: 'error', message: safeError() };
      for (const item of payload.items) {
        if (!item || typeof item !== 'object') continue;
        const mapped = mapEntry(item as Record<string, unknown>);
        if (mapped) entries.push(mapped);
      }
      pageToken =
        typeof payload.nextPageToken === 'string' ? payload.nextPageToken : '';
    } while (pageToken);
    return { kind: 'ok', entries };
  } catch {
    return { kind: 'error', message: 'Google Calendar is unavailable.' };
  }
}

export const liveGoogleCalendarsClient: GoogleCalendarsClient = {
  getCalendar: googleGetCalendar,
  insertCalendar: googleInsertCalendar,
  listCalendarList: googleListCalendarList,
};
