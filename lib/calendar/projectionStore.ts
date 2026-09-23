import { decryptSecret } from './crypto';
import {
  deleteCalendarConnection,
  selectCalendarConnection,
  updateCalendarDestination,
  updateCalendarReconcileMeta,
  updateCalendarSyncEnabled,
} from './connections';
import {
  listEventLinksForUser,
  markEventLinkError,
  selectEventLinkByOccurrence,
  upsertEventLink,
} from './eventLinks';
import { liveGoogleCalendarsClient } from './googleCalendars';
import { liveGoogleCalendarEventsClient } from './googleEvents';
import { googleCalendarOAuthSettings } from './config';
import { refreshGoogleAccessToken, revokeGoogleToken } from './googleOAuth';
import {
  listOccurrencesForUser,
  loadOccurrenceSource,
  loadOwnedOccurrence,
  persistRotatedRefreshToken,
} from './occurrenceSource';
import type { ProjectOccurrenceStore } from './projection';
import type { ReconcileStore } from './reconcile';
import type { SyncLifecycleStore } from './syncLifecycle';
import { createCalendarAdminClient } from './serverAuth';

export function createLiveProjectionStore(): ProjectOccurrenceStore | null {
  const admin = createCalendarAdminClient();
  const settings = googleCalendarOAuthSettings();
  if (!admin || !settings) return null;

  return {
    loadConnection: (userId) => selectCalendarConnection(admin, userId),
    loadOccurrence: (occurrenceId) => loadOwnedOccurrence(admin, occurrenceId),
    loadSource: (occurrence) => loadOccurrenceSource(admin, occurrence),
    loadLink: (occurrenceId) => selectEventLinkByOccurrence(admin, occurrenceId),
    saveLink: async (row) => {
      if (row.syncStatus === 'error') {
        await markEventLinkError(admin, row.occurrenceId, row.lastError || 'error');
        return { ok: true };
      }
      const error = await upsertEventLink(admin, {
        userId: row.userId,
        occurrenceId: row.occurrenceId,
        googleEventId: row.googleEventId,
        calendarId: row.calendarId,
        syncStatus: row.syncStatus === 'deleted' ? 'deleted' : 'upserted',
        lastError: null,
      });
      return error ? { ok: false, error } : { ok: true };
    },
    decryptRefreshToken: (ciphertext) => decryptSecret(ciphertext),
    refreshAccessToken: async (refreshToken) => {
      const refreshed = await refreshGoogleAccessToken({
        refreshToken,
        clientId: settings.clientId,
        clientSecret: settings.clientSecret,
      });
      if (!refreshed.ok) return { ok: false, message: 'refresh failed' };
      return {
        ok: true,
        accessToken: refreshed.accessToken,
        rotatedRefreshToken: refreshed.rotatedRefreshToken,
      };
    },
    persistRotatedRefreshToken: async (userId, refreshToken) => {
      await persistRotatedRefreshToken(admin, userId, refreshToken);
    },
    calendar: liveGoogleCalendarEventsClient,
  };
}

export function createLiveReconcileStore(): ReconcileStore | null {
  const base = createLiveProjectionStore();
  const admin = createCalendarAdminClient();
  if (!base || !admin) return null;
  return {
    ...base,
    loadOccurrencesForUser: (userId) => listOccurrencesForUser(admin, userId),
    loadLinksForUser: (userId) => listEventLinksForUser(admin, userId),
    updateReconcileMeta: async (userId, meta) => {
      await updateCalendarReconcileMeta(admin, userId, meta);
    },
  };
}

export function createLiveSyncLifecycleStore(): SyncLifecycleStore | null {
  const base = createLiveReconcileStore();
  const admin = createCalendarAdminClient();
  if (!base || !admin) return null;
  return {
    ...base,
    persistDestination: async (userId, calendarId) => {
      const error = await updateCalendarDestination(admin, userId, calendarId);
      return error ? { ok: false, error } : { ok: true };
    },
    persistSyncEnabled: async (userId, options) => {
      const error = await updateCalendarSyncEnabled(admin, userId, options);
      return error ? { ok: false, error } : { ok: true };
    },
    calendars: liveGoogleCalendarsClient,
    revokeRefreshToken: async (refreshToken) => {
      await revokeGoogleToken(refreshToken);
    },
    deleteConnection: async (userId) => {
      const error = await deleteCalendarConnection(admin, userId);
      return error ? { ok: false, error } : { ok: true };
    },
  };
}
