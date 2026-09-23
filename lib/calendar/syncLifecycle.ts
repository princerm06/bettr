/**
 * User-facing automatic Sync On / Off / Disconnect.
 * Establishes a dedicated Bettr destination calendar before enabling sync.
 * Does not mutate planning, Logs, XP, or Discipline.
 * Does not delete the dedicated Google calendar on Sync Off or Disconnect
 * (V1: ownership of calendar deletion is only proven for IDs Bettr created
 * and persisted; leaving an empty Bettr calendar is safer than deleting
 * the wrong calendar).
 */
import type { CalendarConnectionRow } from './connections';
import { ensureBettrDestinationCalendar } from './ensureDestination';
import type { GoogleCalendarsClient } from './googleCalendars';
import { reconcileUserCalendar, type ReconcileStore, type ReconcileSummary } from './reconcile';
import {
  withdrawKnownProjections,
  type WithdrawKnownSummary,
} from './withdraw';

export type SyncLifecycleStore = ReconcileStore & {
  persistDestination: (
    userId: string,
    calendarId: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  persistSyncEnabled: (
    userId: string,
    options: { syncEnabled: boolean; lastError?: string | null }
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  calendars: GoogleCalendarsClient;
  revokeRefreshToken?: (refreshToken: string) => Promise<void>;
  deleteConnection: (
    userId: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
};

export type EnableSyncResult = {
  result: 'enabled' | 'not_connected' | 'destination_failed' | 'error';
  calendarId: string | null;
  createdDestination: boolean;
  syncEnabled: boolean;
  reconcile: ReconcileSummary | null;
  reason?: string;
};

export type DisableSyncResult = {
  result: 'disabled' | 'not_connected' | 'error';
  syncEnabled: boolean;
  withdrawn: number;
  cleanupErrors: number;
  reason?: string;
};

export type DisconnectSyncResult = {
  result: 'disconnected' | 'error';
  withdrawn: number;
  cleanupErrors: number;
  reason?: string;
};

function applyConnectionPatch(
  connection: CalendarConnectionRow,
  patch: Partial<CalendarConnectionRow>
) {
  Object.assign(connection, patch);
}

async function refreshForUser(
  actorUserId: string,
  store: SyncLifecycleStore,
  connection: CalendarConnectionRow
): Promise<{ ok: true; accessToken: string } | { ok: false; reason: string }> {
  let refreshToken: string;
  try {
    refreshToken = store.decryptRefreshToken(connection.refresh_token_ciphertext);
  } catch {
    return { ok: false, reason: 'Calendar credentials are unavailable.' };
  }
  const refreshed = await store.refreshAccessToken(refreshToken);
  if (!refreshed.ok) {
    return { ok: false, reason: 'Calendar access could not be refreshed.' };
  }
  if (refreshed.rotatedRefreshToken && store.persistRotatedRefreshToken) {
    try {
      await store.persistRotatedRefreshToken(
        actorUserId,
        refreshed.rotatedRefreshToken
      );
    } catch {
      // Continue with the access token.
    }
  }
  return { ok: true, accessToken: refreshed.accessToken };
}

function sanitizeCleanupError(summary: WithdrawKnownSummary): string | null {
  if (summary.incomplete) {
    return 'Calendar copies could not be fully loaded for cleanup.';
  }
  if (summary.errors > 0) {
    return 'Some calendar copies could not be removed.';
  }
  return null;
}

export async function enableCalendarSync(options: {
  actorUserId: string;
  store: SyncLifecycleStore;
  now?: Date;
}): Promise<EnableSyncResult> {
  const { actorUserId, store } = options;
  const connection = await store.loadConnection(actorUserId);
  if (!connection) {
    return {
      result: 'not_connected',
      calendarId: null,
      createdDestination: false,
      syncEnabled: false,
      reconcile: null,
      reason: 'Connect Google Calendar first.',
    };
  }

  const refreshed = await refreshForUser(actorUserId, store, connection);
  if (!refreshed.ok) {
    await store.persistSyncEnabled(actorUserId, {
      syncEnabled: false,
      lastError: refreshed.reason,
    });
    applyConnectionPatch(connection, {
      sync_enabled: false,
      last_error: refreshed.reason,
    });
    return {
      result: 'error',
      calendarId: isDedicated(connection.calendar_id) ? connection.calendar_id : null,
      createdDestination: false,
      syncEnabled: false,
      reconcile: null,
      reason: refreshed.reason,
    };
  }

  const destination = await ensureBettrDestinationCalendar({
    userId: actorUserId,
    accessToken: refreshed.accessToken,
    storedCalendarId: connection.calendar_id,
    calendars: store.calendars,
  });
  if (!destination.ok) {
    await store.persistSyncEnabled(actorUserId, {
      syncEnabled: false,
      lastError: destination.reason,
    });
    applyConnectionPatch(connection, {
      sync_enabled: false,
      last_error: destination.reason,
    });
    return {
      result: 'destination_failed',
      calendarId: null,
      createdDestination: false,
      syncEnabled: false,
      reconcile: null,
      reason: destination.reason,
    };
  }

  const persisted = await store.persistDestination(actorUserId, destination.calendarId);
  if (!persisted.ok) {
    const reason = 'Could not save the Bettr calendar.';
    await store.persistSyncEnabled(actorUserId, {
      syncEnabled: false,
      lastError: reason,
    });
    applyConnectionPatch(connection, {
      sync_enabled: false,
      last_error: reason,
    });
    return {
      result: 'destination_failed',
      calendarId: destination.calendarId,
      createdDestination: destination.created,
      syncEnabled: false,
      reconcile: null,
      reason,
    };
  }
  applyConnectionPatch(connection, { calendar_id: destination.calendarId });

  const enabled = await store.persistSyncEnabled(actorUserId, {
    syncEnabled: true,
    lastError: null,
  });
  if (!enabled.ok) {
    return {
      result: 'error',
      calendarId: destination.calendarId,
      createdDestination: destination.created,
      syncEnabled: false,
      reconcile: null,
      reason: 'Could not enable calendar sync.',
    };
  }
  applyConnectionPatch(connection, {
    sync_enabled: true,
    last_error: null,
  });

  const reconcile = await reconcileUserCalendar({
    actorUserId,
    store,
    now: options.now,
  });
  return {
    result: 'enabled',
    calendarId: destination.calendarId,
    createdDestination: destination.created,
    syncEnabled: true,
    reconcile,
  };
}

function isDedicated(calendarId: string): boolean {
  return calendarId !== 'primary' && Boolean(calendarId);
}

export async function disableCalendarSync(options: {
  actorUserId: string;
  store: SyncLifecycleStore;
}): Promise<DisableSyncResult> {
  const { actorUserId, store } = options;
  const connection = await store.loadConnection(actorUserId);
  if (!connection) {
    return {
      result: 'not_connected',
      syncEnabled: false,
      withdrawn: 0,
      cleanupErrors: 0,
      reason: 'Google Calendar is not connected.',
    };
  }

  const cleanup = await withdrawKnownProjections({ actorUserId, store });
  const lastError = sanitizeCleanupError(cleanup);
  const persisted = await store.persistSyncEnabled(actorUserId, {
    syncEnabled: false,
    lastError,
  });
  applyConnectionPatch(connection, {
    sync_enabled: false,
    last_error: lastError,
  });
  if (!persisted.ok) {
    return {
      result: 'error',
      syncEnabled: false,
      withdrawn: cleanup.withdrawn,
      cleanupErrors: cleanup.errors + (cleanup.incomplete ? 1 : 0),
      reason: 'Could not save calendar sync settings.',
    };
  }
  return {
    result: 'disabled',
    syncEnabled: false,
    withdrawn: cleanup.withdrawn,
    cleanupErrors: cleanup.errors + (cleanup.incomplete ? 1 : 0),
  };
}

export async function disconnectCalendarSync(options: {
  actorUserId: string;
  store: SyncLifecycleStore;
}): Promise<DisconnectSyncResult> {
  const { actorUserId, store } = options;
  const connection = await store.loadConnection(actorUserId);
  let cleanup: WithdrawKnownSummary = {
    withdrawn: 0,
    errors: 0,
    incomplete: false,
  };
  if (connection) {
    cleanup = await withdrawKnownProjections({ actorUserId, store });
    if (store.revokeRefreshToken) {
      try {
        const refresh = store.decryptRefreshToken(
          connection.refresh_token_ciphertext
        );
        await store.revokeRefreshToken(refresh);
      } catch {
        // Local disconnect still proceeds.
      }
    }
  }
  const deleted = await store.deleteConnection(actorUserId);
  if (!deleted.ok) {
    return {
      result: 'error',
      withdrawn: cleanup.withdrawn,
      cleanupErrors: cleanup.errors + (cleanup.incomplete ? 1 : 0),
      reason: 'Could not disconnect Google Calendar.',
    };
  }
  return {
    result: 'disconnected',
    withdrawn: cleanup.withdrawn,
    cleanupErrors: cleanup.errors + (cleanup.incomplete ? 1 : 0),
  };
}
