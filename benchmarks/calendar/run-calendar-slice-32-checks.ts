/**
 * Phase 3 Google Calendar Slice 3.2 — reconcile engine + sync_enabled gate.
 * Mocked transport. No Sync UI, no planning hooks.
 */
import assert from 'assert';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { CalendarConnectionRow } from '../../lib/calendar/connections';
import type { CalendarEventLinkRow } from '../../lib/calendar/eventLinks';
import type { ProjectionOccurrence } from '../../lib/calendar/eligibility';
import { googleEventIdFromOccurrenceId } from '../../lib/calendar/eventIdentity';
import type { GoogleCalendarEventBody } from '../../lib/calendar/eventPayload';
import type {
  GoogleCalendarEventsClient,
  GoogleEventGetResult,
  GoogleEventWriteResult,
} from '../../lib/calendar/googleEvents';
import {
  projectOccurrence,
  type ProjectOccurrenceStore,
} from '../../lib/calendar/projection';
import {
  reconcileUserCalendar,
  sanitizeReconcileErrorSummary,
  CALENDAR_SOURCE_LOAD_ERROR,
  type ReconcileStore,
} from '../../lib/calendar/reconcile';
import { loadAllCalendarPages } from '../../lib/calendar/listPages';

const root = process.cwd();
const userA = '11111111-1111-4111-8111-111111111111';
const occTimed = '33333333-3333-4333-8333-333333333333';
const occTimedB = '44444444-4444-4444-8444-444444444444';
const occAllDay = '55555555-5555-4555-8555-555555555555';
const occGhost = '66666666-6666-4666-8666-666666666666';

function timed(
  id: string,
  overrides: Partial<ProjectionOccurrence> = {}
): ProjectionOccurrence {
  return {
    id,
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

function dateOnly(
  overrides: Partial<ProjectionOccurrence> = {}
): ProjectionOccurrence {
  return {
    id: occAllDay,
    userId: userA,
    sourceType: 'todo',
    routineId: null,
    todoId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    scheduledDate: '2026-09-24',
    scheduledTime: null,
    timezone: 'America/Chicago',
    durationMinutes: null,
    status: 'planned',
    ...overrides,
  };
}

function baseConnection(
  overrides: Partial<CalendarConnectionRow> = {}
): CalendarConnectionRow {
  return {
    user_id: userA,
    sync_enabled: true,
    google_sub: 'sub',
    google_email: 'user@example.com',
    calendar_id: 'primary',
    refresh_token_ciphertext: 'cipher',
    granted_scopes: 'https://www.googleapis.com/auth/calendar.events',
    connected_at: '2026-09-21T00:00:00.000Z',
    updated_at: '2026-09-21T00:00:00.000Z',
    last_reconcile_at: null,
    last_error: 'stale',
    ...overrides,
  };
}

type MemoryCalendar = GoogleCalendarEventsClient & {
  events: Map<string, GoogleCalendarEventBody & { status?: string }>;
  inserts: number;
  patches: number;
  deletes: number;
  failNext: 'insert' | 'patch' | 'get' | 'delete' | 'none';
};

function createMemoryCalendar(): MemoryCalendar {
  const events = new Map<string, GoogleCalendarEventBody & { status?: string }>();
  const calendar: MemoryCalendar = {
    events,
    inserts: 0,
    patches: 0,
    deletes: 0,
    failNext: 'none',
    async getEvent({ eventId }): Promise<GoogleEventGetResult> {
      if (calendar.failNext === 'get') {
        calendar.failNext = 'none';
        return { kind: 'error', message: 'Google Calendar is unavailable.' };
      }
      const event = events.get(eventId);
      if (!event) return { kind: 'missing' };
      if (event.status === 'cancelled') {
        return { kind: 'cancelled', event: { id: event.id, status: 'cancelled' } };
      }
      return { kind: 'ok', event: { id: event.id, status: event.status } };
    },
    async insertEvent({ body }): Promise<GoogleEventWriteResult> {
      calendar.inserts += 1;
      if (calendar.failNext === 'insert') {
        calendar.failNext = 'none';
        return { kind: 'error', message: 'Google Calendar is unavailable.' };
      }
      if (events.has(body.id)) return { kind: 'exists', eventId: body.id };
      events.set(body.id, { ...body, status: 'confirmed' });
      return { kind: 'ok', event: { id: body.id, status: 'confirmed' } };
    },
    async patchEvent({ eventId, body }): Promise<GoogleEventWriteResult> {
      calendar.patches += 1;
      if (calendar.failNext === 'patch') {
        calendar.failNext = 'none';
        return { kind: 'error', message: 'Google Calendar is unavailable.' };
      }
      const existing = events.get(eventId);
      if (!existing) return { kind: 'missing' };
      events.set(eventId, {
        ...existing,
        ...body,
        id: eventId,
        status: 'confirmed',
      });
      return { kind: 'ok', event: { id: eventId, status: 'confirmed' } };
    },
    async deleteEvent({ eventId }) {
      calendar.deletes += 1;
      if (calendar.failNext === 'delete') {
        calendar.failNext = 'none';
        return { kind: 'error', message: 'Google Calendar is unavailable.' };
      }
      if (!events.has(eventId)) return { kind: 'missing' };
      events.delete(eventId);
      return { kind: 'ok' };
    },
  };
  return calendar;
}

function liveLink(
  occurrenceId: string,
  overrides: Partial<CalendarEventLinkRow> = {}
): CalendarEventLinkRow {
  return {
    id: `link-${occurrenceId}`,
    user_id: userA,
    occurrence_id: occurrenceId,
    google_event_id: googleEventIdFromOccurrenceId(occurrenceId),
    calendar_id: 'primary',
    sync_status: 'upserted',
    last_error: null,
    created_at: '2026-09-23T00:00:00.000Z',
    updated_at: '2026-09-23T00:00:00.000Z',
    ...overrides,
  };
}

function createReconcileHarness(options: {
  occurrences: ProjectionOccurrence[];
  links?: CalendarEventLinkRow[];
  connection: CalendarConnectionRow | null;
  calendar: MemoryCalendar;
}) {
  const occurrenceById = new Map(
    options.occurrences.map((row) => [row.id, { ...row }])
  );
  const links = new Map(
    (options.links ?? []).map((row) => [row.occurrence_id, { ...row }])
  );
  const connection = options.connection ? { ...options.connection } : null;
  const planningSnapshot = options.occurrences.map((row) => ({ ...row }));
  const saveLink: ProjectOccurrenceStore['saveLink'] = async (row) => {
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
  };
  const store: ReconcileStore = {
    loadConnection: async () => connection,
    loadOccurrence: async (id) => occurrenceById.get(id) ?? null,
    loadSource: async () => ({ title: 'BJJ training' }),
    loadLink: async (id) => links.get(id) ?? null,
    saveLink,
    decryptRefreshToken: () => 'refresh-token-value',
    refreshAccessToken: async () => ({ ok: true, accessToken: 'access-token-value' }),
    calendar: options.calendar,
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
      connection.updated_at = meta.lastReconcileAt;
    },
  };
  return { store, connection, links, occurrenceById, planningSnapshot };
}

async function run() {
  {
    const calendar = createMemoryCalendar();
    const harness = createReconcileHarness({
      occurrences: [timed(occTimed)],
      connection: null,
      calendar,
    });
    const summary = await reconcileUserCalendar({
      actorUserId: userA,
      store: harness.store,
    });
    assert.equal(summary.result, 'not_connected');
    assert.equal(calendar.inserts, 0);
    assert.equal(calendar.deletes, 0);
  }

  {
    const calendar = createMemoryCalendar();
    const harness = createReconcileHarness({
      occurrences: [timed(occTimed), dateOnly()],
      connection: baseConnection({ sync_enabled: false }),
      calendar,
    });
    const summary = await reconcileUserCalendar({
      actorUserId: userA,
      store: harness.store,
    });
    assert.equal(summary.result, 'sync_disabled');
    assert.equal(summary.projected, 0);
    assert.equal(summary.withdrawn, 0);
    assert.equal(calendar.inserts, 0);
    assert.equal(calendar.deletes, 0);
    assert.equal(calendar.patches, 0);
    assert.equal(harness.connection?.last_reconcile_at, null);
  }

  {
    const calendar = createMemoryCalendar();
    const harness = createReconcileHarness({
      occurrences: [timed(occTimed)],
      connection: baseConnection(),
      calendar,
    });
    const first = await reconcileUserCalendar({
      actorUserId: userA,
      store: harness.store,
    });
    assert.equal(first.result, 'reconciled');
    assert.equal(first.projected, 1);
    assert.equal(calendar.events.size, 1);
    assert.ok(harness.connection?.last_reconcile_at);
    assert.equal(harness.connection?.last_error, null);

    const second = await reconcileUserCalendar({
      actorUserId: userA,
      store: harness.store,
    });
    assert.equal(second.updated, 1);
    assert.equal(calendar.events.size, 1);
    assert.equal(calendar.inserts, 1);
  }

  {
    const calendar = createMemoryCalendar();
    const harness = createReconcileHarness({
      occurrences: [dateOnly()],
      connection: baseConnection(),
      calendar,
    });
    const summary = await reconcileUserCalendar({
      actorUserId: userA,
      store: harness.store,
    });
    assert.equal(summary.projected, 0);
    assert.equal(summary.noop, 1);
    assert.equal(calendar.inserts, 0);
  }

  {
    const calendar = createMemoryCalendar();
    const eventId = googleEventIdFromOccurrenceId(occAllDay);
    calendar.events.set(eventId, {
      id: eventId,
      summary: 'Update portfolio',
      description: 'Synced from Bettr.',
      start: { date: '2026-09-24' },
      end: { date: '2026-09-25' },
      status: 'confirmed',
    });
    const harness = createReconcileHarness({
      occurrences: [dateOnly()],
      links: [liveLink(occAllDay)],
      connection: baseConnection(),
      calendar,
    });
    const summary = await reconcileUserCalendar({
      actorUserId: userA,
      store: harness.store,
    });
    assert.equal(summary.withdrawn, 1);
    assert.equal(calendar.events.size, 0);
    assert.equal(harness.links.get(occAllDay)?.sync_status, 'deleted');
  }

  for (const status of ['completed', 'skipped', 'rescheduled'] as const) {
    const calendar = createMemoryCalendar();
    const eventId = googleEventIdFromOccurrenceId(occTimed);
    calendar.events.set(eventId, {
      id: eventId,
      summary: 'BJJ training',
      description: 'Synced from Bettr.',
      start: { dateTime: '2026-09-23T18:00:00', timeZone: 'America/New_York' },
      end: { dateTime: '2026-09-23T19:00:00', timeZone: 'America/New_York' },
      status: 'confirmed',
    });
    const harness = createReconcileHarness({
      occurrences: [timed(occTimed, { status })],
      links: [liveLink(occTimed)],
      connection: baseConnection(),
      calendar,
    });
    const snapshot = harness.planningSnapshot[0];
    const summary = await reconcileUserCalendar({
      actorUserId: userA,
      store: harness.store,
    });
    assert.equal(summary.withdrawn, 1, status);
    assert.equal(calendar.events.size, 0, status);
    assert.equal(harness.occurrenceById.get(occTimed)?.status, status);
    assert.equal(snapshot.status, status);
  }

  {
    const calendar = createMemoryCalendar();
    const eventId = googleEventIdFromOccurrenceId(occGhost);
    calendar.events.set(eventId, {
      id: eventId,
      summary: 'Gone',
      description: 'Synced from Bettr.',
      start: { dateTime: '2026-09-23T18:00:00', timeZone: 'America/New_York' },
      end: { dateTime: '2026-09-23T19:00:00', timeZone: 'America/New_York' },
    });
    const harness = createReconcileHarness({
      occurrences: [],
      links: [liveLink(occGhost)],
      connection: baseConnection(),
      calendar,
    });
    const summary = await reconcileUserCalendar({
      actorUserId: userA,
      store: harness.store,
    });
    assert.equal(summary.withdrawn, 1);
    assert.equal(calendar.events.size, 0);
  }

  {
    const calendar = createMemoryCalendar();
    const eventId = googleEventIdFromOccurrenceId(occTimed);
    const harness = createReconcileHarness({
      occurrences: [timed(occTimed)],
      links: [liveLink(occTimed)],
      connection: baseConnection(),
      calendar,
    });
    const summary = await reconcileUserCalendar({
      actorUserId: userA,
      store: harness.store,
    });
    assert.equal(summary.projected + summary.updated, 1);
    assert.equal(calendar.events.size, 1);
    assert.equal([...calendar.events.keys()][0], eventId);
  }

  {
    const calendar = createMemoryCalendar();
    const eventId = googleEventIdFromOccurrenceId(occTimed);
    calendar.events.set(eventId, {
      id: eventId,
      summary: 'BJJ training',
      description: 'Synced from Bettr.',
      start: { dateTime: '2026-09-23T18:00:00', timeZone: 'America/New_York' },
      end: { dateTime: '2026-09-23T19:00:00', timeZone: 'America/New_York' },
      status: 'cancelled',
    });
    const harness = createReconcileHarness({
      occurrences: [timed(occTimed)],
      links: [liveLink(occTimed)],
      connection: baseConnection(),
      calendar,
    });
    const summary = await reconcileUserCalendar({
      actorUserId: userA,
      store: harness.store,
    });
    assert.equal(summary.updated, 1);
    assert.equal(calendar.events.size, 1);
    assert.equal(calendar.events.get(eventId)?.status, 'confirmed');
  }

  {
    const calendar = createMemoryCalendar();
    const harness = createReconcileHarness({
      occurrences: [timed(occTimed), timed(occTimedB, { scheduledTime: '07:00:00' })],
      connection: baseConnection(),
      calendar,
    });
    calendar.failNext = 'insert';
    const snapshot = harness.planningSnapshot.map((row) => ({ ...row }));
    const summary = await reconcileUserCalendar({
      actorUserId: userA,
      store: harness.store,
    });
    assert.equal(summary.errors, 1);
    assert.equal(summary.projected, 1);
    assert.equal(calendar.events.size, 1);
    assert.deepEqual(
      Array.from(harness.occurrenceById.values()).map((row) => row.status),
      snapshot.map((row) => row.status)
    );
    assert.ok(harness.connection?.last_error);
    assert.ok(!harness.connection?.last_error?.toLowerCase().includes('token'));
    assert.equal(
      harness.connection?.last_error,
      sanitizeReconcileErrorSummary(1)
    );
  }

  {
    const calendar = createMemoryCalendar();
    const harness = createReconcileHarness({
      occurrences: [timed(occTimed)],
      connection: baseConnection(),
      calendar,
    });
    const first = reconcileUserCalendar({
      actorUserId: userA,
      store: harness.store,
    });
    const second = reconcileUserCalendar({
      actorUserId: userA,
      store: harness.store,
    });
    assert.equal(first, second);
    await first;
    assert.equal(calendar.inserts, 1);
    assert.equal(calendar.events.size, 1);
  }

  {
    const calendar = createMemoryCalendar();
    const harness = createReconcileHarness({
      occurrences: [dateOnly()],
      connection: baseConnection({ sync_enabled: false, last_error: 'stale' }),
      calendar,
    });
    const manual = await projectOccurrence({
      actorUserId: userA,
      occurrenceId: occAllDay,
      store: harness.store,
      mode: 'manual',
    });
    assert.equal(manual.result, 'created');
    assert.equal(calendar.events.size, 1);
  }

  {
    const firstPage = await loadAllCalendarPages({
      pageSize: 2,
      fetchPage: async () => ({ ok: false }),
    });
    assert.equal(firstPage.ok, false);

    const laterPage = await loadAllCalendarPages({
      pageSize: 1,
      fetchPage: async ({ from }) =>
        from === 0 ? { ok: true, rows: [{ id: 'a' }] } : { ok: false },
    });
    assert.equal(laterPage.ok, false);
  }

  async function assertFailClosed(kind: 'occurrences' | 'links', laterPage: boolean) {
    const calendar = createMemoryCalendar();
    const eventId = googleEventIdFromOccurrenceId(occTimed);
    calendar.events.set(eventId, {
      id: eventId,
      summary: 'BJJ training',
      description: 'Synced from Bettr.',
      start: { dateTime: '2026-09-23T18:00:00', timeZone: 'America/New_York' },
      end: { dateTime: '2026-09-23T19:00:00', timeZone: 'America/New_York' },
    });
    const harness = createReconcileHarness({
      occurrences: [timed(occTimed), timed(occTimedB, { scheduledTime: '07:00:00' })],
      links: [liveLink(occTimed)],
      connection: baseConnection(),
      calendar,
    });
    const pageSize = 1;
    if (kind === 'occurrences') {
      harness.store.loadOccurrencesForUser = async () =>
        loadAllCalendarPages({
          pageSize,
          fetchPage: async ({ from }) => {
            if (!laterPage && from === 0) return { ok: false };
            if (laterPage && from >= pageSize) return { ok: false };
            return { ok: true, rows: [timed(occTimed)] };
          },
        });
    } else {
      harness.store.loadLinksForUser = async () =>
        loadAllCalendarPages({
          pageSize,
          fetchPage: async ({ from }) => {
            if (!laterPage && from === 0) return { ok: false };
            if (laterPage && from >= pageSize) return { ok: false };
            return { ok: true, rows: [liveLink(occTimed)] };
          },
        });
    }
    const snapshot = harness.planningSnapshot.map((row) => ({ ...row }));
    const insertsBefore = calendar.inserts;
    const deletesBefore = calendar.deletes;
    const patchesBefore = calendar.patches;
    const summary = await reconcileUserCalendar({
      actorUserId: userA,
      store: harness.store,
    });
    assert.equal(summary.result, 'error', `${kind} later=${laterPage}`);
    assert.equal(summary.projected, 0);
    assert.equal(summary.updated, 0);
    assert.equal(summary.withdrawn, 0);
    assert.equal(calendar.inserts, insertsBefore);
    assert.equal(calendar.deletes, deletesBefore);
    assert.equal(calendar.patches, patchesBefore);
    assert.equal(calendar.events.size, 1);
    assert.deepEqual(
      Array.from(harness.occurrenceById.values()).map((row) => row.status),
      snapshot.map((row) => row.status)
    );
    assert.equal(harness.connection?.last_error, CALENDAR_SOURCE_LOAD_ERROR);
    assert.ok(!JSON.stringify(summary).toLowerCase().includes('token'));
    assert.ok(!String(harness.connection?.last_error).includes('PGRST'));
  }

  await assertFailClosed('occurrences', false);
  await assertFailClosed('occurrences', true);
  await assertFailClosed('links', false);
  await assertFailClosed('links', true);

  const calendarDir = join(root, 'lib/calendar');
  const calendarBundle = readdirSync(calendarDir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => readFileSync(join(calendarDir, name), 'utf8'))
    .join('\n');
  assert.ok(!calendarBundle.includes("from '../planning"));
  assert.ok(!calendarBundle.includes("from 'lib/planning"));
  assert.ok(!calendarBundle.includes("from('logs')"));
  assert.ok(!readFileSync(join(calendarDir, 'listPages.ts'), 'utf8').includes('/calendar/v3'));
  assert.ok(readFileSync(join(calendarDir, 'reconcile.ts'), 'utf8').includes('CALENDAR_SOURCE_LOAD_ERROR'));
  assert.ok(
    !readFileSync(join(calendarDir, 'eligibility.ts'), 'utf8').includes('/calendar/v3')
  );

  const planningBundle = readdirSync(join(root, 'lib/planning'))
    .filter((name) => name.endsWith('.ts'))
    .map((name) => readFileSync(join(root, 'lib/planning', name), 'utf8'))
    .join('\n');
  assert.ok(!planningBundle.includes('lib/calendar'));
  assert.ok(!planningBundle.includes('reconcileUserCalendar'));

  const access = readFileSync(join(root, 'lib/planning/occurrencesAccess.ts'), 'utf8');
  assert.ok(!access.includes('reconcileUserCalendar'));
  assert.ok(!access.includes('projectOccurrence'));

  const today = readFileSync(join(root, 'app/planning/TodayView.tsx'), 'utf8');
  assert.ok(!today.includes('createLiveReconcileStore'));
  const settings = readFileSync(
    join(root, 'app/calendar/GoogleCalendarSettings.tsx'),
    'utf8'
  );
  assert.ok(!settings.includes('/api/calendar/reconcile'));
  assert.ok(settings.includes("process.env.NODE_ENV !== 'production'"));

  const route = readFileSync(
    join(root, 'app/api/calendar/reconcile/route.ts'),
    'utf8'
  );
  assert.ok(route.includes('calendarUserFromBearer'));
  assert.ok(route.includes('actorUserId: user.id'));
  assert.ok(!route.includes('body.userId'));
  assert.ok(!route.includes("body.user_id"));
  assert.ok(!route.includes('sync_enabled: true'));

  const manualRoute = readFileSync(
    join(root, 'app/api/calendar/project-occurrence/route.ts'),
    'utf8'
  );
  assert.ok(manualRoute.includes("mode: 'manual'"));

  console.log(
    JSON.stringify(
      {
        ok: true,
        slice: 'calendar-3.2',
        syncGate: true,
        hooks: false,
        dedicatedCalendar: false,
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
