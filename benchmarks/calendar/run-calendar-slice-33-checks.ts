/**
 * Phase 3 Google Calendar Slice 3.3 — Sync On/Off, dedicated destination, disconnect.
 * Mocked Google. No planning mutation hooks (3.4).
 */
import assert from 'assert';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { CalendarConnectionRow } from '../../lib/calendar/connections';
import {
  BETTR_DESTINATION_SUMMARY,
  bettrDestinationDescription,
  isPersistedDedicatedCalendarId,
  isUnsetDestinationCalendarId,
  selectOwnedBettrDestination,
  UNSET_DESTINATION_CALENDAR_ID,
} from '../../lib/calendar/destination';
import type { CalendarEventLinkRow } from '../../lib/calendar/eventLinks';
import type { ProjectionOccurrence } from '../../lib/calendar/eligibility';
import { googleEventIdFromOccurrenceId } from '../../lib/calendar/eventIdentity';
import type { GoogleCalendarEventBody } from '../../lib/calendar/eventPayload';
import type { DestinationCatalogEntry } from '../../lib/calendar/destination';
import type {
  GoogleCalendarEventsClient,
  GoogleEventGetResult,
  GoogleEventWriteResult,
} from '../../lib/calendar/googleEvents';
import type { GoogleCalendarsClient } from '../../lib/calendar/googleCalendars';
import { projectOccurrence } from '../../lib/calendar/projection';
import {
  disableCalendarSync,
  disconnectCalendarSync,
  enableCalendarSync,
  type SyncLifecycleStore,
} from '../../lib/calendar/syncLifecycle';

const root = process.cwd();
const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const occTimed = '33333333-3333-4333-8333-333333333333';

function timed(
  overrides: Partial<ProjectionOccurrence> = {}
): ProjectionOccurrence {
  return {
    id: occTimed,
    userId: userA,
    sourceType: 'routine',
    routineId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    todoId: null,
    scheduledDate: '2026-09-23',
    scheduledTime: '18:00:00',
    timezone: 'America/New_York',
    durationMinutes: 60,
    status: 'planned',
    ...overrides,
  };
}

function baseConnection(
  overrides: Partial<CalendarConnectionRow> = {}
): CalendarConnectionRow {
  return {
    user_id: userA,
    sync_enabled: false,
    google_sub: 'sub',
    google_email: 'user@example.com',
    calendar_id: UNSET_DESTINATION_CALENDAR_ID,
    refresh_token_ciphertext: 'cipher',
    granted_scopes: 'https://www.googleapis.com/auth/calendar',
    connected_at: '2026-09-21T00:00:00.000Z',
    updated_at: '2026-09-21T00:00:00.000Z',
    last_reconcile_at: null,
    last_error: null,
    ...overrides,
  };
}

type MemoryEvents = GoogleCalendarEventsClient & {
  events: Map<string, GoogleCalendarEventBody & { status?: string }>;
  insertCalendarIds: string[];
  deletes: number;
  failNextDelete: boolean;
};

function createMemoryEvents(): MemoryEvents {
  const events = new Map<string, GoogleCalendarEventBody & { status?: string }>();
  const calendar: MemoryEvents = {
    events,
    insertCalendarIds: [],
    deletes: 0,
    failNextDelete: false,
    async getEvent({ eventId }): Promise<GoogleEventGetResult> {
      const event = events.get(eventId);
      if (!event) return { kind: 'missing' };
      return { kind: 'ok', event: { id: event.id, status: event.status } };
    },
    async insertEvent({ calendarId, body }): Promise<GoogleEventWriteResult> {
      calendar.insertCalendarIds.push(calendarId);
      events.set(body.id, { ...body, status: 'confirmed' });
      return { kind: 'ok', event: { id: body.id, status: 'confirmed' } };
    },
    async patchEvent({ eventId, body }): Promise<GoogleEventWriteResult> {
      const existing = events.get(eventId);
      if (!existing) return { kind: 'missing' };
      events.set(eventId, { ...existing, ...body, id: eventId, status: 'confirmed' });
      return { kind: 'ok', event: { id: eventId, status: 'confirmed' } };
    },
    async deleteEvent({ eventId }) {
      calendar.deletes += 1;
      if (calendar.failNextDelete) {
        calendar.failNextDelete = false;
        return { kind: 'error', message: 'Google Calendar is unavailable.' };
      }
      events.delete(eventId);
      return { kind: 'ok' };
    },
  };
  return calendar;
}

type MemoryCatalog = GoogleCalendarsClient & {
  entries: Map<string, DestinationCatalogEntry>;
  inserts: number;
  failNext: 'get' | 'insert' | 'list' | 'none';
};

function createMemoryCatalog(): MemoryCatalog {
  const entries = new Map<string, DestinationCatalogEntry>();
  const catalog: MemoryCatalog = {
    entries,
    inserts: 0,
    failNext: 'none',
    async getCalendar({ calendarId }) {
      if (catalog.failNext === 'get') {
        catalog.failNext = 'none';
        return { kind: 'error' as const, message: 'Google Calendar is unavailable.' };
      }
      const found = entries.get(calendarId);
      if (!found) return { kind: 'missing' as const };
      return { kind: 'ok' as const, calendar: found };
    },
    async insertCalendar({ summary, description }) {
      catalog.inserts += 1;
      if (catalog.failNext === 'insert') {
        catalog.failNext = 'none';
        return { kind: 'error' as const, message: 'Google Calendar could not be updated.' };
      }
      const id = `bettr-${catalog.inserts}@group.calendar.google.com`;
      const entry: DestinationCatalogEntry = {
        id,
        summary,
        description,
        accessRole: 'owner',
        primary: false,
      };
      entries.set(id, entry);
      return { kind: 'ok' as const, calendarId: id };
    },
    async listCalendarList() {
      if (catalog.failNext === 'list') {
        catalog.failNext = 'none';
        return { kind: 'error' as const, message: 'Google Calendar is unavailable.' };
      }
      return { kind: 'ok' as const, entries: Array.from(entries.values()) };
    },
  };
  return catalog;
}

function createLifecycleHarness(options: {
  connection: CalendarConnectionRow | null;
  occurrences?: ProjectionOccurrence[];
  links?: CalendarEventLinkRow[];
  events: MemoryEvents;
  calendars: MemoryCatalog;
  persistDestinationFails?: number;
}) {
  const occurrenceById = new Map(
    (options.occurrences ?? []).map((row) => [row.id, { ...row }])
  );
  const links = new Map(
    (options.links ?? []).map((row) => [row.occurrence_id, { ...row }])
  );
  let connection = options.connection ? { ...options.connection } : null;
  let persistDestinationFails = options.persistDestinationFails ?? 0;
  const planningSnapshot = JSON.stringify(Array.from(occurrenceById.values()));
  const store: SyncLifecycleStore = {
    loadConnection: async () => connection,
    loadOccurrence: async (id) => occurrenceById.get(id) ?? null,
    loadSource: async () => ({ title: 'BJJ training' }),
    loadLink: async (id) => links.get(id) ?? null,
    saveLink: async (row) => {
      const previous = links.get(row.occurrenceId);
      links.set(row.occurrenceId, {
        id: previous?.id ?? `link-${row.occurrenceId}`,
        user_id: row.userId,
        occurrence_id: row.occurrenceId,
        google_event_id: row.googleEventId,
        calendar_id: row.calendarId,
        sync_status: row.syncStatus,
        last_error: row.lastError,
        created_at: previous?.created_at ?? '2026-09-23T00:00:00.000Z',
        updated_at: '2026-09-23T00:00:00.000Z',
      });
      return { ok: true };
    },
    decryptRefreshToken: () => 'refresh-token-value',
    refreshAccessToken: async () => ({ ok: true, accessToken: 'access-token-value' }),
    calendar: options.events,
    loadOccurrencesForUser: async () => ({
      ok: true as const,
      rows: Array.from(occurrenceById.values()),
    }),
    loadLinksForUser: async () => ({
      ok: true as const,
      rows: Array.from(links.values()),
    }),
    updateReconcileMeta: async (_userId, meta) => {
      if (!connection) return;
      connection.last_reconcile_at = meta.lastReconcileAt;
      connection.last_error = meta.lastError;
    },
    persistDestination: async (_userId, calendarId) => {
      if (persistDestinationFails > 0) {
        persistDestinationFails -= 1;
        return { ok: false, error: 'db' };
      }
      if (!connection) return { ok: false, error: 'missing' };
      connection.calendar_id = calendarId;
      return { ok: true };
    },
    persistSyncEnabled: async (_userId, patch) => {
      if (!connection) return { ok: false, error: 'missing' };
      connection.sync_enabled = patch.syncEnabled;
      if (patch.lastError !== undefined) connection.last_error = patch.lastError;
      return { ok: true };
    },
    calendars: options.calendars,
    revokeRefreshToken: async () => undefined,
    deleteConnection: async () => {
      connection = null;
      return { ok: true };
    },
  };
  return {
    store,
    getConnection: () => connection,
    links,
    occurrenceById,
    planningUnchanged: () =>
      JSON.stringify(Array.from(occurrenceById.values())) === planningSnapshot,
  };
}

async function run() {
  assert.equal(UNSET_DESTINATION_CALENDAR_ID, 'primary');
  assert.equal(isUnsetDestinationCalendarId('primary'), true);
  assert.equal(isPersistedDedicatedCalendarId('primary'), false);
  assert.equal(
    isPersistedDedicatedCalendarId('abc@group.calendar.google.com'),
    true
  );
  assert.equal(
    selectOwnedBettrDestination(
      [
        {
          id: 'named',
          summary: BETTR_DESTINATION_SUMMARY,
          description: 'Personal',
          accessRole: 'owner',
        },
      ],
      userA
    ),
    null
  );
  assert.equal(
    selectOwnedBettrDestination(
      [
        {
          id: 'owned-b',
          summary: BETTR_DESTINATION_SUMMARY,
          description: bettrDestinationDescription(userB),
          accessRole: 'owner',
        },
        {
          id: 'owned-a',
          summary: 'Anything',
          description: bettrDestinationDescription(userA),
          accessRole: 'owner',
        },
      ],
      userA
    ),
    'owned-a'
  );

  {
    const events = createMemoryEvents();
    const calendars = createMemoryCatalog();
    const harness = createLifecycleHarness({
      connection: null,
      occurrences: [timed()],
      events,
      calendars,
    });
    const enabled = await enableCalendarSync({
      actorUserId: userA,
      store: harness.store,
    });
    assert.equal(enabled.result, 'not_connected');
    assert.equal(enabled.syncEnabled, false);
    assert.equal(calendars.inserts, 0);
    assert.equal(events.insertCalendarIds.length, 0);
    assert.ok(harness.planningUnchanged());
  }

  {
    const events = createMemoryEvents();
    const calendars = createMemoryCatalog();
    calendars.entries.set('named-bettr', {
      id: 'named-bettr',
      summary: 'Bettr',
      description: '',
      accessRole: 'owner',
    });
    const harness = createLifecycleHarness({
      connection: baseConnection(),
      occurrences: [timed()],
      events,
      calendars,
    });
    const enabled = await enableCalendarSync({
      actorUserId: userA,
      store: harness.store,
    });
    assert.equal(enabled.result, 'enabled');
    assert.equal(enabled.syncEnabled, true);
    assert.equal(enabled.createdDestination, true);
    assert.equal(calendars.inserts, 1);
    const dest = harness.getConnection()?.calendar_id ?? '';
    assert.ok(isPersistedDedicatedCalendarId(dest));
    assert.notEqual(dest, 'named-bettr');
    assert.notEqual(dest, 'primary');
    assert.equal(enabled.calendarId, dest);
    assert.equal(harness.getConnection()?.sync_enabled, true);
    assert.equal(enabled.reconcile?.result, 'reconciled');
    assert.equal(enabled.reconcile?.projected, 1);
    assert.deepEqual(events.insertCalendarIds, [dest]);
    assert.ok(!events.insertCalendarIds.includes('primary'));
    assert.ok(harness.planningUnchanged());
  }

  {
    const events = createMemoryEvents();
    const calendars = createMemoryCatalog();
    const harness = createLifecycleHarness({
      connection: baseConnection(),
      occurrences: [timed()],
      events,
      calendars,
    });
    const first = await enableCalendarSync({
      actorUserId: userA,
      store: harness.store,
    });
    const second = await enableCalendarSync({
      actorUserId: userA,
      store: harness.store,
    });
    assert.equal(first.result, 'enabled');
    assert.equal(second.result, 'enabled');
    assert.equal(calendars.inserts, 1);
    assert.equal(second.createdDestination, false);
    assert.equal(second.calendarId, first.calendarId);
  }

  {
    const events = createMemoryEvents();
    const calendars = createMemoryCatalog();
    const harness = createLifecycleHarness({
      connection: baseConnection(),
      occurrences: [timed()],
      events,
      calendars,
      persistDestinationFails: 1,
    });
    const failed = await enableCalendarSync({
      actorUserId: userA,
      store: harness.store,
    });
    assert.equal(failed.result, 'destination_failed');
    assert.equal(failed.syncEnabled, false);
    assert.equal(harness.getConnection()?.sync_enabled, false);
    assert.equal(harness.getConnection()?.calendar_id, 'primary');
    assert.equal(calendars.inserts, 1);
    assert.equal(events.insertCalendarIds.length, 0);
    const retried = await enableCalendarSync({
      actorUserId: userA,
      store: harness.store,
    });
    assert.equal(retried.result, 'enabled');
    assert.equal(calendars.inserts, 1);
    assert.equal(retried.createdDestination, false);
    assert.ok(isPersistedDedicatedCalendarId(retried.calendarId));
  }

  {
    const events = createMemoryEvents();
    const calendars = createMemoryCatalog();
    const harness = createLifecycleHarness({
      connection: baseConnection(),
      events,
      calendars,
    });
    calendars.failNext = 'insert';
    const failed = await enableCalendarSync({
      actorUserId: userA,
      store: harness.store,
    });
    assert.equal(failed.result, 'destination_failed');
    assert.equal(harness.getConnection()?.sync_enabled, false);
    assert.equal(calendars.inserts, 1);
  }

  {
    const events = createMemoryEvents();
    const calendars = createMemoryCatalog();
    const harness = createLifecycleHarness({
      connection: baseConnection(),
      occurrences: [timed()],
      events,
      calendars,
    });
    await enableCalendarSync({ actorUserId: userA, store: harness.store });
    const dest = harness.getConnection()!.calendar_id;
    const disabled = await disableCalendarSync({
      actorUserId: userA,
      store: harness.store,
    });
    assert.equal(disabled.result, 'disabled');
    assert.equal(disabled.syncEnabled, false);
    assert.equal(harness.getConnection()?.sync_enabled, false);
    assert.equal(harness.getConnection()?.calendar_id, dest);
    assert.equal(events.deletes, 1);
    assert.equal(calendars.entries.has(dest), true);
    assert.ok(harness.planningUnchanged());

    const reenabled = await enableCalendarSync({
      actorUserId: userA,
      store: harness.store,
    });
    assert.equal(reenabled.createdDestination, false);
    assert.equal(reenabled.calendarId, dest);
    assert.equal(calendars.inserts, 1);
  }

  {
    const events = createMemoryEvents();
    const calendars = createMemoryCatalog();
    const harness = createLifecycleHarness({
      connection: baseConnection(),
      occurrences: [timed()],
      events,
      calendars,
    });
    await enableCalendarSync({ actorUserId: userA, store: harness.store });
    const dest = harness.getConnection()!.calendar_id;
    events.failNextDelete = true;
    const disabled = await disableCalendarSync({
      actorUserId: userA,
      store: harness.store,
    });
    assert.equal(disabled.result, 'disabled');
    assert.equal(disabled.syncEnabled, false);
    assert.equal(disabled.cleanupErrors, 1);
    assert.equal(harness.getConnection()?.sync_enabled, false);
    assert.equal(harness.getConnection()?.calendar_id, dest);
    assert.ok(harness.planningUnchanged());
  }

  {
    const events = createMemoryEvents();
    const calendars = createMemoryCatalog();
    const harness = createLifecycleHarness({
      connection: baseConnection(),
      occurrences: [timed()],
      events,
      calendars,
    });
    await enableCalendarSync({ actorUserId: userA, store: harness.store });
    const gone = harness.getConnection()!.calendar_id;
    calendars.entries.delete(gone);
    const recovered = await enableCalendarSync({
      actorUserId: userA,
      store: harness.store,
    });
    assert.equal(recovered.result, 'enabled');
    assert.equal(recovered.createdDestination, true);
    assert.equal(calendars.inserts, 2);
    assert.notEqual(recovered.calendarId, gone);
    assert.equal(harness.getConnection()?.calendar_id, recovered.calendarId);
    assert.ok(!events.insertCalendarIds.includes('primary'));
  }

  {
    const events = createMemoryEvents();
    const calendars = createMemoryCatalog();
    const harness = createLifecycleHarness({
      connection: baseConnection(),
      occurrences: [timed()],
      events,
      calendars,
    });
    await enableCalendarSync({ actorUserId: userA, store: harness.store });
    const dest = harness.getConnection()!.calendar_id;
    const disconnected = await disconnectCalendarSync({
      actorUserId: userA,
      store: harness.store,
    });
    assert.equal(disconnected.result, 'disconnected');
    assert.equal(events.deletes, 1);
    assert.equal(harness.getConnection(), null);
    assert.equal(calendars.entries.has(dest), true);
    assert.ok(harness.planningUnchanged());
  }

  {
    const events = createMemoryEvents();
    const calendars = createMemoryCatalog();
    const harness = createLifecycleHarness({
      connection: baseConnection(),
      occurrences: [timed()],
      events,
      calendars,
    });
    await enableCalendarSync({ actorUserId: userA, store: harness.store });
    events.failNextDelete = true;
    const disconnected = await disconnectCalendarSync({
      actorUserId: userA,
      store: harness.store,
    });
    assert.equal(disconnected.result, 'disconnected');
    assert.equal(harness.getConnection(), null);
    assert.ok(harness.planningUnchanged());
  }

  {
    const events = createMemoryEvents();
    const calendars = createMemoryCatalog();
    const dedicated = 'kept@group.calendar.google.com';
    calendars.entries.set(dedicated, {
      id: dedicated,
      summary: 'Bettr',
      description: bettrDestinationDescription(userA),
      accessRole: 'owner',
    });
    const harness = createLifecycleHarness({
      connection: baseConnection({
        calendar_id: dedicated,
        sync_enabled: false,
      }),
      occurrences: [timed()],
      events,
      calendars,
    });
    const manual = await projectOccurrence({
      actorUserId: userA,
      occurrenceId: occTimed,
      store: harness.store,
    });
    assert.equal(manual.result, 'created');
    assert.deepEqual(events.insertCalendarIds, [dedicated]);
  }

  const planningDir = join(root, 'lib/planning');
  const planningBundle = readdirSync(planningDir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => readFileSync(join(planningDir, name), 'utf8'))
    .join('\n');
  assert.ok(!planningBundle.includes('lib/calendar'));
  assert.ok(!planningBundle.includes('enableCalendarSync'));
  assert.ok(!planningBundle.includes('ensureBettrDestinationCalendar'));

  const access = readFileSync(join(root, 'lib/planning/occurrencesAccess.ts'), 'utf8');
  assert.ok(!access.includes('enableCalendarSync'));
  assert.ok(!access.includes('reconcileUserCalendar'));
  const today = readFileSync(join(root, 'app/planning/TodayView.tsx'), 'utf8');
  assert.ok(!today.includes('/api/calendar/sync'));
  assert.ok(!today.includes('enableCalendarSync'));

  const calendarDir = join(root, 'lib/calendar');
  const calendarBundle = readdirSync(calendarDir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => readFileSync(join(calendarDir, name), 'utf8'))
    .join('\n');
  assert.ok(!calendarBundle.includes("from '../planning"));
  assert.ok(!calendarBundle.includes("from 'lib/planning"));
  assert.ok(!calendarBundle.includes("from('logs')"));
  assert.ok(!calendarBundle.includes('awardXp'));
  assert.ok(!readFileSync(join(calendarDir, 'syncLifecycle.ts'), 'utf8').includes('calendars.delete'));
  assert.ok(
    readFileSync(join(calendarDir, 'syncLifecycle.ts'), 'utf8').includes(
      'leaving an empty Bettr calendar'
    )
  );

  const settings = readFileSync(
    join(root, 'app/calendar/GoogleCalendarSettings.tsx'),
    'utf8'
  );
  assert.ok(settings.includes('Turn on'));
  assert.ok(settings.includes('Turn off'));
  assert.ok(settings.includes("Sync: {status.syncEnabled ? 'On' : 'Off'}"));
  assert.ok(settings.includes('/api/calendar/sync'));
  assert.ok(settings.includes("process.env.NODE_ENV !== 'production'"));
  assert.ok(settings.includes('Test occurrence projection'));
  assert.ok(!settings.includes('Sync now'));
  assert.ok(
    settings.indexOf("process.env.NODE_ENV !== 'production'") <
      settings.indexOf('Test occurrence projection')
  );

  const syncRoute = readFileSync(
    join(root, 'app/api/calendar/sync/route.ts'),
    'utf8'
  );
  assert.ok(syncRoute.includes('calendarUserFromBearer'));
  assert.ok(syncRoute.includes('actorUserId: user.id'));
  assert.ok(!syncRoute.includes('body.userId') || syncRoute.includes('void body.userId'));
  assert.ok(!syncRoute.includes("searchParams.get('user_id')"));
  assert.ok(!syncRoute.includes('refresh_token'));
  assert.ok(!syncRoute.includes('accessToken'));

  const disconnect = readFileSync(
    join(root, 'app/api/calendar/disconnect/route.ts'),
    'utf8'
  );
  assert.ok(disconnect.includes('disconnectCalendarSync'));
  assert.ok(!disconnect.includes('planned_occurrences'));
  assert.ok(!disconnect.includes("from('goals')"));

  const connections = readFileSync(
    join(root, 'lib/calendar/connections.ts'),
    'utf8'
  );
  assert.ok(connections.includes('const existing = await selectCalendarConnection'));
  assert.ok(connections.includes('hasDedicatedCalendar'));

  const oauth = readFileSync(join(root, 'lib/calendar/oauth.ts'), 'utf8');
  assert.ok(oauth.includes('https://www.googleapis.com/auth/calendar'));

  const status = readFileSync(
    join(root, 'app/api/calendar/status/route.ts'),
    'utf8'
  );
  assert.ok(!status.includes('refresh_token_ciphertext'));

  console.log(
    JSON.stringify(
      {
        ok: true,
        slice: 'calendar-3.3',
        dedicatedCalendar: true,
        migration: false,
        hooks: false,
      },
      null,
      2
    )
  );
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
