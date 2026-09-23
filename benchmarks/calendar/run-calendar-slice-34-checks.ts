/**
 * Phase 3 Google Calendar Slice 3.4 — planning lifecycle → best-effort reconcile.
 * Mocked Google. lib/planning stays Calendar-free.
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
import type { ProjectOccurrenceStore } from '../../lib/calendar/projection';
import type { ReconcileStore } from '../../lib/calendar/reconcile';
import { scheduleCalendarReconcile } from '../../lib/calendar/scheduleReconcile';

const root = process.cwd();
const userA = '11111111-1111-4111-8111-111111111111';
const occTimed = '33333333-3333-4333-8333-333333333333';
const occTimedB = '44444444-4444-4444-8444-444444444444';
const occAllDay = '55555555-5555-4555-8555-555555555555';

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
    calendar_id: 'bettr-1@group.calendar.google.com',
    refresh_token_ciphertext: 'cipher',
    granted_scopes: 'https://www.googleapis.com/auth/calendar',
    connected_at: '2026-09-21T00:00:00.000Z',
    updated_at: '2026-09-21T00:00:00.000Z',
    last_reconcile_at: null,
    last_error: null,
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
      events.set(eventId, { ...existing, ...body, id: eventId, status: 'confirmed' });
      return { kind: 'ok', event: { id: eventId, status: 'confirmed' } };
    },
    async deleteEvent({ eventId }) {
      calendar.deletes += 1;
      if (calendar.failNext === 'delete') {
        calendar.failNext = 'none';
        return { kind: 'error', message: 'Google Calendar is unavailable.' };
      }
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
    calendar_id: 'bettr-1@group.calendar.google.com',
    sync_status: 'upserted',
    last_error: null,
    created_at: '2026-09-23T00:00:00.000Z',
    updated_at: '2026-09-23T00:00:00.000Z',
    ...overrides,
  };
}

function createHarness(options: {
  occurrences: ProjectionOccurrence[];
  links?: CalendarEventLinkRow[];
  connection: CalendarConnectionRow | null;
  calendar: MemoryCalendar;
  refreshFails?: boolean;
}) {
  const occurrenceById = new Map(
    options.occurrences.map((row) => [row.id, { ...row }])
  );
  const links = new Map(
    (options.links ?? []).map((row) => [row.occurrence_id, { ...row }])
  );
  const connection = options.connection ? { ...options.connection } : null;
  const planningCredit = { xp: 0, logs: 0, statusById: new Map<string, string>() };
  for (const row of occurrenceById.values()) {
    planningCredit.statusById.set(row.id, row.status);
  }
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
    refreshAccessToken: async () =>
      options.refreshFails
        ? { ok: false, message: 'refresh failed' }
        : { ok: true, accessToken: 'access-token-value' },
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
    },
  };

  function commitPlanning(id: string, next: ProjectionOccurrence) {
    occurrenceById.set(id, next);
    planningCredit.statusById.set(id, next.status);
  }

  return {
    store,
    occurrenceById,
    links,
    planningCredit,
    commitPlanning,
    connection,
  };
}

async function afterPlanning(
  actorUserId: string,
  store: ReconcileStore | null
) {
  return scheduleCalendarReconcile({ actorUserId, store });
}

async function run() {
  {
    const calendar = createMemoryCalendar();
    const harness = createHarness({
      occurrences: [timed(occTimed)],
      connection: baseConnection({ sync_enabled: false }),
      calendar,
    });
    harness.commitPlanning(occTimed, timed(occTimed, { status: 'completed' }));
    harness.planningCredit.xp = 5;
    harness.planningCredit.logs = 1;
    const summary = await afterPlanning(userA, harness.store);
    assert.equal(summary?.result, 'sync_disabled');
    assert.equal(calendar.inserts, 0);
    assert.equal(calendar.deletes, 0);
    assert.equal(harness.planningCredit.statusById.get(occTimed), 'completed');
    assert.equal(harness.planningCredit.xp, 5);
    assert.equal(harness.planningCredit.logs, 1);
  }

  {
    const calendar = createMemoryCalendar();
    const harness = createHarness({
      occurrences: [timed(occTimed), dateOnly()],
      connection: baseConnection(),
      calendar,
    });
    await afterPlanning(userA, harness.store);
    assert.equal(calendar.inserts, 1);
    assert.ok(calendar.events.has(googleEventIdFromOccurrenceId(occTimed)));
    assert.ok(!calendar.events.has(googleEventIdFromOccurrenceId(occAllDay)));
  }

  {
    const calendar = createMemoryCalendar();
    const harness = createHarness({
      occurrences: [timed(occTimed)],
      connection: baseConnection(),
      calendar,
    });
    await afterPlanning(userA, harness.store);
    harness.commitPlanning(occTimed, timed(occTimed, { status: 'completed' }));
    harness.planningCredit.xp = 5;
    harness.planningCredit.logs = 1;
    const summary = await afterPlanning(userA, harness.store);
    assert.equal(summary?.withdrawn, 1);
    assert.equal(calendar.events.size, 0);
    assert.equal(harness.planningCredit.statusById.get(occTimed), 'completed');
    assert.equal(harness.planningCredit.xp, 5);
  }

  {
    const calendar = createMemoryCalendar();
    const harness = createHarness({
      occurrences: [timed(occTimed)],
      links: [liveLink(occTimed)],
      connection: baseConnection(),
      calendar,
    });
    calendar.events.set(googleEventIdFromOccurrenceId(occTimed), {
      id: googleEventIdFromOccurrenceId(occTimed),
      summary: 'BJJ training',
      description: '',
      start: { dateTime: '2026-09-23T18:00:00', timeZone: 'America/New_York' },
      end: { dateTime: '2026-09-23T19:00:00', timeZone: 'America/New_York' },
      status: 'confirmed',
    });
    harness.commitPlanning(occTimed, timed(occTimed, { status: 'completed' }));
    harness.planningCredit.xp = 7;
    harness.planningCredit.logs = 1;
    calendar.failNext = 'delete';
    await afterPlanning(userA, harness.store);
    assert.equal(harness.planningCredit.statusById.get(occTimed), 'completed');
    assert.equal(harness.planningCredit.xp, 7);
    assert.equal(harness.planningCredit.logs, 1);
    assert.equal(calendar.events.size, 1);
  }

  {
    const calendar = createMemoryCalendar();
    const harness = createHarness({
      occurrences: [timed(occTimed)],
      connection: baseConnection(),
      calendar,
    });
    await afterPlanning(userA, harness.store);
    harness.commitPlanning(occTimed, timed(occTimed, { status: 'skipped' }));
    await afterPlanning(userA, harness.store);
    assert.equal(harness.planningCredit.statusById.get(occTimed), 'skipped');
    assert.equal(calendar.events.size, 0);
  }

  {
    const calendar = createMemoryCalendar();
    const harness = createHarness({
      occurrences: [timed(occTimed)],
      links: [liveLink(occTimed)],
      connection: baseConnection(),
      calendar,
    });
    calendar.events.set(googleEventIdFromOccurrenceId(occTimed), {
      id: googleEventIdFromOccurrenceId(occTimed),
      summary: 'BJJ training',
      description: '',
      start: { dateTime: '2026-09-23T18:00:00', timeZone: 'America/New_York' },
      end: { dateTime: '2026-09-23T19:00:00', timeZone: 'America/New_York' },
      status: 'confirmed',
    });
    harness.commitPlanning(occTimed, timed(occTimed, { status: 'skipped' }));
    calendar.failNext = 'delete';
    await afterPlanning(userA, harness.store);
    assert.equal(harness.planningCredit.statusById.get(occTimed), 'skipped');
    assert.equal(calendar.events.size, 1);
  }

  {
    const calendar = createMemoryCalendar();
    const source = timed(occTimed);
    const replacement = timed(occTimedB, { scheduledDate: '2026-09-25' });
    const harness = createHarness({
      occurrences: [source],
      connection: baseConnection(),
      calendar,
    });
    await afterPlanning(userA, harness.store);
    harness.commitPlanning(occTimed, timed(occTimed, { status: 'rescheduled' }));
    harness.commitPlanning(occTimedB, replacement);
    await afterPlanning(userA, harness.store);
    assert.ok(!calendar.events.has(googleEventIdFromOccurrenceId(occTimed)));
    assert.ok(calendar.events.has(googleEventIdFromOccurrenceId(occTimedB)));
    assert.notEqual(
      googleEventIdFromOccurrenceId(occTimed),
      googleEventIdFromOccurrenceId(occTimedB)
    );
    assert.equal(calendar.events.size, 1);
  }

  {
    const calendar = createMemoryCalendar();
    const harness = createHarness({
      occurrences: [timed(occTimed)],
      connection: baseConnection(),
      calendar,
    });
    await afterPlanning(userA, harness.store);
    harness.commitPlanning(occTimed, timed(occTimed, { status: 'rescheduled' }));
    harness.commitPlanning(occAllDay, dateOnly());
    await afterPlanning(userA, harness.store);
    assert.ok(!calendar.events.has(googleEventIdFromOccurrenceId(occTimed)));
    assert.ok(!calendar.events.has(googleEventIdFromOccurrenceId(occAllDay)));
  }

  {
    const calendar = createMemoryCalendar();
    const harness = createHarness({
      occurrences: [dateOnly()],
      connection: baseConnection(),
      calendar,
    });
    await afterPlanning(userA, harness.store);
    assert.equal(calendar.inserts, 0);
    harness.commitPlanning(
      occAllDay,
      dateOnly({ scheduledTime: '09:00:00', durationMinutes: 30 })
    );
    await afterPlanning(userA, harness.store);
    assert.ok(calendar.events.has(googleEventIdFromOccurrenceId(occAllDay)));
  }

  {
    const calendar = createMemoryCalendar();
    const harness = createHarness({
      occurrences: [timed(occTimed, { status: 'completed' })],
      connection: baseConnection(),
      calendar,
    });
    harness.commitPlanning(occTimed, timed(occTimed, { status: 'planned' }));
    await afterPlanning(userA, harness.store);
    assert.ok(calendar.events.has(googleEventIdFromOccurrenceId(occTimed)));
    const again = await afterPlanning(userA, harness.store);
    assert.equal(again?.updated, 1);
    assert.equal(calendar.inserts, 1);
    assert.equal(calendar.events.size, 1);
  }

  {
    const calendar = createMemoryCalendar();
    const harness = createHarness({
      occurrences: [dateOnly({ status: 'completed' })],
      connection: baseConnection(),
      calendar,
    });
    harness.commitPlanning(occAllDay, dateOnly({ status: 'planned' }));
    await afterPlanning(userA, harness.store);
    assert.equal(calendar.inserts, 0);
    assert.equal(calendar.events.size, 0);
  }

  {
    const calendar = createMemoryCalendar();
    const harness = createHarness({
      occurrences: [timed(occTimed)],
      connection: null,
      calendar,
    });
    harness.commitPlanning(occTimed, timed(occTimed, { status: 'completed' }));
    const summary = await afterPlanning(userA, harness.store);
    assert.equal(summary?.result, 'not_connected');
    assert.equal(calendar.inserts, 0);
    assert.equal(calendar.deletes, 0);
    assert.equal(harness.planningCredit.statusById.get(occTimed), 'completed');
  }

  {
    const calendar = createMemoryCalendar();
    const harness = createHarness({
      occurrences: [timed(occTimed)],
      connection: baseConnection(),
      calendar,
      refreshFails: true,
    });
    harness.commitPlanning(occTimed, timed(occTimed, { status: 'planned' }));
    harness.planningCredit.xp = 4;
    await afterPlanning(userA, harness.store);
    assert.equal(harness.planningCredit.statusById.get(occTimed), 'planned');
    assert.equal(harness.planningCredit.xp, 4);
    assert.equal(calendar.inserts, 0);
  }

  {
    const calendar = createMemoryCalendar();
    const thrown: ReconcileStore = {
      loadConnection: async () => {
        throw new Error('boom');
      },
      loadOccurrence: async () => null,
      loadSource: async () => ({ title: 'BJJ training' }),
      loadLink: async () => null,
      saveLink: async () => ({ ok: true }),
      decryptRefreshToken: () => 'x',
      refreshAccessToken: async () => ({ ok: true, accessToken: 'a' }),
      calendar,
      loadOccurrencesForUser: async () => ({ ok: true as const, rows: [] }),
      loadLinksForUser: async () => ({ ok: true as const, rows: [] }),
      updateReconcileMeta: async () => undefined,
    };
    const planning = { completed: true, xp: 5 };
    const result = await scheduleCalendarReconcile({
      actorUserId: userA,
      store: thrown,
    });
    assert.equal(result, null);
    assert.equal(planning.completed, true);
    assert.equal(planning.xp, 5);
  }

  const planningDir = join(root, 'lib/planning');
  const planningBundle = readdirSync(planningDir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => readFileSync(join(planningDir, name), 'utf8'))
    .join('\n');
  assert.ok(!planningBundle.includes('lib/calendar'));
  assert.ok(!planningBundle.includes('requestCalendarReconcileAfterPlanning'));
  assert.ok(!planningBundle.includes('scheduleCalendarReconcile'));

  const access = readFileSync(join(root, 'lib/planning/occurrencesAccess.ts'), 'utf8');
  assert.ok(!access.includes('lib/calendar'));
  assert.ok(!access.includes('requestCalendarReconcileAfterPlanning'));

  const execution = readFileSync(
    join(root, 'lib/plannerExecution/completePlannedOccurrence.ts'),
    'utf8'
  );
  assert.ok(!execution.includes('lib/calendar'));

  const today = readFileSync(join(root, 'app/planning/TodayView.tsx'), 'utf8');
  assert.ok(today.includes('requestCalendarReconcileAfterPlanning'));
  assert.ok(!today.includes('reconcileUserCalendar'));
  assert.ok(!today.includes('Google synced'));
  const todos = readFileSync(join(root, 'app/planning/TodosView.tsx'), 'utf8');
  assert.ok(todos.includes('requestCalendarReconcileAfterPlanning'));
  const routines = readFileSync(join(root, 'app/planning/RoutinesView.tsx'), 'utf8');
  assert.ok(routines.includes('requestCalendarReconcileAfterPlanning'));
  const goals = readFileSync(join(root, 'app/planning/GoalsView.tsx'), 'utf8');
  assert.ok(!goals.includes('requestCalendarReconcileAfterPlanning'));

  const helper = readFileSync(join(root, 'lib/calendar/requestReconcile.ts'), 'utf8');
  assert.ok(!helper.includes('/calendar/v3'));
  assert.ok(!helper.includes('from ./reconcile'));
  assert.ok(!helper.includes("searchParams.get('user_id')"));
  assert.ok(helper.includes('/api/calendar/reconcile'));
  assert.ok(helper.includes('getSession'));

  const calendarDir = join(root, 'lib/calendar');
  const calendarBundle = readdirSync(calendarDir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => readFileSync(join(calendarDir, name), 'utf8'))
    .join('\n');
  assert.ok(!calendarBundle.includes("from '../planning"));
  assert.ok(!calendarBundle.includes("from 'lib/planning"));
  assert.ok(!calendarBundle.includes("from('logs')"));
  assert.ok(!calendarBundle.includes('awardXp'));
  assert.ok(!calendarBundle.includes('discipline'));

  const settings = readFileSync(
    join(root, 'app/calendar/GoogleCalendarSettings.tsx'),
    'utf8'
  );
  assert.ok(settings.includes("process.env.NODE_ENV !== 'production'"));
  assert.ok(settings.includes('Test occurrence projection'));

  console.log(
    JSON.stringify(
      {
        ok: true,
        slice: 'calendar-3.4',
        hooks: 'after-planning-success',
        planningImportsCalendar: false,
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
