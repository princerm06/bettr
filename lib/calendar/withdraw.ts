/**
 * Withdraw an outbound calendar copy for one occurrence.
 * Does not mutate planning, Logs, XP, or Discipline.
 * Google/API failure never rolls back Bettr state.
 */
import type { CalendarConnectionRow } from './connections';
import type { CalendarEventLinkRow } from './eventLinks';
import { hasLiveProjectedCopy } from './eligibility';
import { googleEventIdFromOccurrenceId } from './eventIdentity';
import type { CalendarPageResult } from './listPages';
import { isUuid } from './oauth';
import type { GoogleCalendarEventsClient } from './googleEvents';
import type { TokenRefreshResult } from './projection';

export type WithdrawalResultCode =
  | 'withdrawn'
  | 'noop'
  | 'not_connected'
  | 'denied'
  | 'error';

export type WithdrawalResult = {
  result: WithdrawalResultCode;
  googleEventId?: string;
  reason?: string;
};

export type WithdrawOccurrenceStore = {
  loadConnection: (userId: string) => Promise<CalendarConnectionRow | null>;
  loadOccurrence: (
    occurrenceId: string
  ) => Promise<{ id: string; userId: string } | null>;
  loadLink: (occurrenceId: string) => Promise<CalendarEventLinkRow | null>;
  saveLink: (row: {
    userId: string;
    occurrenceId: string;
    googleEventId: string;
    calendarId: string;
    syncStatus: 'deleted' | 'error';
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

export async function withdrawOccurrenceProjection(options: {
  actorUserId: string;
  occurrenceId: string;
  store: WithdrawOccurrenceStore;
}): Promise<WithdrawalResult> {
  const { actorUserId, occurrenceId, store } = options;
  if (!isUuid(occurrenceId)) {
    return { result: 'error', reason: 'Occurrence id is not valid.' };
  }

  const occurrence = await store.loadOccurrence(occurrenceId);
  if (occurrence && occurrence.userId !== actorUserId) {
    return { result: 'denied', reason: 'Occurrence is not yours.' };
  }

  const link = await store.loadLink(occurrenceId);
  const eventId = link?.google_event_id || googleEventIdFromOccurrenceId(occurrenceId);
  const calendarId = link?.calendar_id || 'primary';
  const connection = await store.loadConnection(actorUserId);

  if (!connection) {
    if (link) {
      await store.saveLink({
        userId: actorUserId,
        occurrenceId,
        googleEventId: eventId,
        calendarId,
        syncStatus: 'deleted',
        lastError: null,
      });
    }
    return { result: 'not_connected', googleEventId: link ? eventId : undefined };
  }

  let refreshToken: string;
  try {
    refreshToken = store.decryptRefreshToken(connection.refresh_token_ciphertext);
  } catch {
    return { result: 'error', reason: 'Calendar credentials are unavailable.' };
  }

  const refreshed = await store.refreshAccessToken(refreshToken);
  if (!refreshed.ok) {
    if (link) {
      await store.saveLink({
        userId: actorUserId,
        occurrenceId,
        googleEventId: eventId,
        calendarId,
        syncStatus: 'error',
        lastError: 'Calendar access could not be refreshed.',
      });
    }
    return { result: 'error', reason: 'Calendar access could not be refreshed.' };
  }
  if (refreshed.rotatedRefreshToken && store.persistRotatedRefreshToken) {
    try {
      await store.persistRotatedRefreshToken(
        actorUserId,
        refreshed.rotatedRefreshToken
      );
    } catch {
      // Continue withdrawal with the access token.
    }
  }

  const deleted = await store.calendar.deleteEvent({
    accessToken: refreshed.accessToken,
    calendarId: connection.calendar_id || calendarId,
    eventId,
  });
  if (deleted.kind === 'error') {
    await store.saveLink({
      userId: actorUserId,
      occurrenceId,
      googleEventId: eventId,
      calendarId,
      syncStatus: 'error',
      lastError: deleted.message,
    });
    return { result: 'error', googleEventId: eventId, reason: deleted.message };
  }

  const saved = await store.saveLink({
    userId: actorUserId,
    occurrenceId,
    googleEventId: eventId,
    calendarId,
    syncStatus: 'deleted',
    lastError: null,
  });
  if (!saved.ok) {
    return {
      result: 'error',
      googleEventId: eventId,
      reason: 'Calendar event was removed but the Bettr link could not be saved. Retry withdrawal.',
    };
  }

  if (!link && deleted.kind === 'missing') {
    return { result: 'noop', googleEventId: eventId };
  }
  return { result: 'withdrawn', googleEventId: eventId };
}

export type WithdrawKnownSummary = {
  withdrawn: number;
  errors: number;
  incomplete: boolean;
};

/**
 * Best-effort cleanup of known live projections. Fail-closed: incomplete
 * link pages skip Google deletes rather than guessing from a partial list.
 */
export async function withdrawKnownProjections(options: {
  actorUserId: string;
  store: WithdrawOccurrenceStore & {
    loadLinksForUser: (
      userId: string
    ) => Promise<CalendarPageResult<CalendarEventLinkRow>>;
  };
}): Promise<WithdrawKnownSummary> {
  const { actorUserId, store } = options;
  const page = await store.loadLinksForUser(actorUserId);
  if (!page.ok) {
    return { withdrawn: 0, errors: 1, incomplete: true };
  }
  const summary: WithdrawKnownSummary = {
    withdrawn: 0,
    errors: 0,
    incomplete: false,
  };
  const live = page.rows
    .filter(
      (row) =>
        row.user_id === actorUserId && hasLiveProjectedCopy(row.sync_status)
    )
    .sort((a, b) => a.occurrence_id.localeCompare(b.occurrence_id));
  for (const link of live) {
    const outcome = await withdrawOccurrenceProjection({
      actorUserId,
      occurrenceId: link.occurrence_id,
      store,
    });
    if (outcome.result === 'withdrawn' || outcome.result === 'noop') {
      summary.withdrawn += 1;
    } else if (outcome.result !== 'not_connected') {
      summary.errors += 1;
    }
  }
  return summary;
}
