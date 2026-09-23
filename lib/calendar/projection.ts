/**
 * Idempotent one-occurrence Google Calendar projection.
 * Does not mutate Goals, Routines, To-Dos, planned_occurrences, Logs, or XP.
 * Does not consult sync_enabled (manual Slice 2 test surface only).
 */
import type { CalendarConnectionRow } from './connections';
import type { CalendarEventLinkRow } from './eventLinks';
import { decideOccurrenceProjectionEligibility } from './eligibility';
import type { ProjectionMode, ProjectionOccurrence } from './eligibility';
import { googleEventIdFromOccurrenceId } from './eventIdentity';
import {
  buildGoogleEventPayload,
  googleEventPatchBody,
  type EventPayloadSource,
} from './eventPayload';
import type { GoogleCalendarEventsClient } from './googleEvents';

export type ProjectionResultCode =
  | 'created'
  | 'updated'
  | 'ineligible'
  | 'not_connected'
  | 'denied'
  | 'error';

export type ProjectionResult = {
  result: ProjectionResultCode;
  googleEventId?: string;
  reason?: string;
};

export type TokenRefreshResult =
  | { ok: true; accessToken: string; rotatedRefreshToken?: string }
  | { ok: false; message: string };

export type ProjectOccurrenceStore = {
  loadConnection: (userId: string) => Promise<CalendarConnectionRow | null>;
  loadOccurrence: (occurrenceId: string) => Promise<ProjectionOccurrence | null>;
  loadSource: (
    occurrence: ProjectionOccurrence
  ) => Promise<EventPayloadSource | null>;
  loadLink: (occurrenceId: string) => Promise<CalendarEventLinkRow | null>;
  saveLink: (row: {
    userId: string;
    occurrenceId: string;
    googleEventId: string;
    calendarId: string;
    syncStatus: 'upserted' | 'deleted' | 'error';
    lastError: string | null;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
  decryptRefreshToken: (ciphertext: string) => string;
  refreshAccessToken: (refreshToken: string) => Promise<TokenRefreshResult>;
  persistRotatedRefreshToken?: (
    userId: string,
    refreshToken: string
  ) => Promise<void>;
  calendar: GoogleCalendarEventsClient;
};

export async function projectOccurrence(options: {
  actorUserId: string;
  occurrenceId: string;
  store: ProjectOccurrenceStore;
  mode?: ProjectionMode;
}): Promise<ProjectionResult> {
  const { actorUserId, occurrenceId, store, mode = 'manual' } = options;

  const connection = await store.loadConnection(actorUserId);
  if (!connection) {
    return { result: 'not_connected' };
  }

  const occurrence = await store.loadOccurrence(occurrenceId);
  let sourceAllowsExternalCalendar: boolean | undefined;
  if (mode === 'automatic' && occurrence?.sourceType === 'routine') {
    const sourcePreview = await store.loadSource(occurrence);
    if (!sourcePreview) {
      sourceAllowsExternalCalendar = false;
    } else {
      sourceAllowsExternalCalendar = sourcePreview.allowsExternalCalendar !== false;
    }
  }
  const eligibility = decideOccurrenceProjectionEligibility({
    actorUserId,
    occurrence,
    mode,
    sourceAllowsExternalCalendar,
  });
  if (!eligibility.ok) {
    return { result: eligibility.result, reason: eligibility.reason };
  }

  const source = await store.loadSource(occurrence!);
  if (!source) {
    return { result: 'ineligible', reason: 'Source action was not found.' };
  }

  let payload;
  try {
    payload = buildGoogleEventPayload(occurrence!, source);
  } catch {
    return { result: 'error', reason: 'Could not build a Calendar event.' };
  }

  let refreshToken: string;
  try {
    refreshToken = store.decryptRefreshToken(connection.refresh_token_ciphertext);
  } catch {
    return { result: 'error', reason: 'Google Calendar credentials are unavailable.' };
  }

  const refreshed = await store.refreshAccessToken(refreshToken);
  if (!refreshed.ok) {
    return { result: 'error', reason: 'Google Calendar access could not be refreshed.' };
  }
  if (refreshed.rotatedRefreshToken && store.persistRotatedRefreshToken) {
    try {
      await store.persistRotatedRefreshToken(
        actorUserId,
        refreshed.rotatedRefreshToken
      );
    } catch {
      // Keep projecting with the still-valid access token.
    }
  }

  const calendarId = connection.calendar_id || 'primary';
  const deterministicId = googleEventIdFromOccurrenceId(occurrence!.id);
  const existingLink = await store.loadLink(occurrence!.id);
  const accessToken = refreshed.accessToken;

  const upserted = await upsertGoogleEvent({
    store,
    accessToken,
    calendarId,
    payload,
    existingLink,
    deterministicId,
  });
  if (upserted.result !== 'created' && upserted.result !== 'updated') {
    if (existingLink) {
      await store.saveLink({
        userId: actorUserId,
        occurrenceId: occurrence!.id,
        googleEventId: existingLink.google_event_id,
        calendarId: existingLink.calendar_id,
        syncStatus: 'error',
        lastError: upserted.reason ?? 'Google Calendar could not be updated.',
      });
    }
    return upserted;
  }

  const saved = await store.saveLink({
    userId: actorUserId,
    occurrenceId: occurrence!.id,
    googleEventId: upserted.googleEventId!,
    calendarId,
    syncStatus: 'upserted',
    lastError: null,
  });
  if (!saved.ok) {
    return {
      result: 'error',
      googleEventId: upserted.googleEventId,
      reason: 'Google event was written but the Bettr link could not be saved. Retry this occurrence.',
    };
  }

  return upserted;
}

async function upsertGoogleEvent(options: {
  store: ProjectOccurrenceStore;
  accessToken: string;
  calendarId: string;
  payload: ReturnType<typeof buildGoogleEventPayload>;
  existingLink: CalendarEventLinkRow | null;
  deterministicId: string;
}): Promise<ProjectionResult> {
  const { store, accessToken, calendarId, payload, existingLink, deterministicId } =
    options;
  const patchBody = googleEventPatchBody(payload);

  if (existingLink?.google_event_id) {
    const patched = await store.calendar.patchEvent({
      accessToken,
      calendarId,
      eventId: existingLink.google_event_id,
      body: patchBody,
    });
    if (patched.kind === 'ok') {
      return { result: 'updated', googleEventId: patched.event.id };
    }
    if (patched.kind === 'error') {
      return { result: 'error', reason: patched.message };
    }
    const created = await insertOrRecover({
      store,
      accessToken,
      calendarId,
      payload: { ...payload, id: deterministicId },
    });
    if (created.result === 'created' || created.result === 'updated') {
      return { result: 'updated', googleEventId: created.googleEventId };
    }
    return created;
  }

  return insertOrRecover({ store, accessToken, calendarId, payload });
}

async function insertOrRecover(options: {
  store: ProjectOccurrenceStore;
  accessToken: string;
  calendarId: string;
  payload: ReturnType<typeof buildGoogleEventPayload>;
}): Promise<ProjectionResult> {
  const inserted = await options.store.calendar.insertEvent({
    accessToken: options.accessToken,
    calendarId: options.calendarId,
    body: options.payload,
  });
  if (inserted.kind === 'ok') {
    return { result: 'created', googleEventId: inserted.event.id };
  }
  if (inserted.kind === 'error') {
    return { result: 'error', reason: inserted.message };
  }
  if (inserted.kind !== 'exists') {
    return { result: 'error', reason: 'Google Calendar could not be updated.' };
  }

  const existing = await options.store.calendar.getEvent({
    accessToken: options.accessToken,
    calendarId: options.calendarId,
    eventId: options.payload.id,
  });
  if (existing.kind === 'error') {
    return { result: 'error', reason: existing.message };
  }

  const patched = await options.store.calendar.patchEvent({
    accessToken: options.accessToken,
    calendarId: options.calendarId,
    eventId: options.payload.id,
    body: googleEventPatchBody(options.payload),
  });
  if (patched.kind === 'ok') {
    return { result: 'updated', googleEventId: patched.event.id };
  }
  if (patched.kind === 'error') {
    return { result: 'error', reason: patched.message };
  }
  if (existing.kind === 'cancelled' || existing.kind === 'ok') {
    return { result: 'error', reason: 'Google Calendar could not be updated.' };
  }
  return { result: 'error', reason: 'Google Calendar could not be updated.' };
}
