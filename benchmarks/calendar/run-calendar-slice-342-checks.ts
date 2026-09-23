/**
 * Phase 3 Slice 3.4.2 — per-Routine external calendar + archive withdraw.
 * Mocked Google. lib/planning stays Calendar-free.
 */
import assert from 'assert';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { CalendarConnectionRow } from '../../lib/calendar/connections';
import type { CalendarEventLinkRow } from '../../lib/calendar/eventLinks';
import {
  decideAutomaticReconcileAction,
  decideOccurrenceProjectionEligibility,
  type ProjectionOccurrence,
} from '../../lib/calendar/eligibility';
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
const userB = '22222222-2222-4222-8222-222222222222';
const occTimed = '33333333-3333-4333-8333-333333333333';
const occTodo = '55555555-5555-4555-8555-555555555555';

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

function todoOcc(
  overrides: Partial<ProjectionOccurrence> = {}
): ProjectionOccurrence {
  return {
    id: occTodo,
    userId: userA,
    sourceType: 'todo',
    routineId: null,
    todoId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    scheduledDate: '2026-09-23',
    scheduledTime: '09:00:00',
    timezone: 'America/New_York',
    durationMinutes: 30,
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
  failNext: 'insert' | 'delete' | 'none';
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
      events.delete(eventId);
      return { kind: 'ok' };
    },
  };
  return calendar;
}

function createHarness(options: {
  occurrence: ProjectionOccurrence;
  calendar: MemoryCalendar;
  allowsExternalCalendar?: boolean;
  connection?: CalendarConnectionRow | null;
  refreshFails?: boolean;
}) {
  const occurrenceById = new Map([
    [options.occurrence.id, { ...options.occurrence }],
  ]);
  const links = new Map<string, CalendarEventLinkRow>();
  const conn = options.connection === undefined ? baseConnection() : options.connection;
  const planning = {
    xp: 7,
    logs: 2,
    discipline: 3,
    status: options.occurrence.status,
  };
  let allows =
    options.allowsExternalCalendar === undefined
      ? true
      : options.allowsExternalCalendar;
  const saveLink: ProjectOccurrenceStore['saveLink'] = async (row) => {
    links.set(row.occurrenceId, {
      id: `link-${row.occurrenceId}`,
      user_id: row.userId,
      occurrence_id: row.occurrenceId,
      google_event_id: row.googleEventId,
      calendar_id: row.calendarId,
      sync_status: row.syncStatus,
      last_error: row.lastError,
      created_at: '2026-09-23T00:00:00.000Z',
      updated_at: '2026-09-23T00:00:00.000Z',
    });
    return { ok: true };
  };
  const store: ReconcileStore = {
    loadConnection: async () => conn,
    loadOccurrence: async (id) => occurrenceById.get(id) ?? null,
    loadSource: async (occurrence) => {
      if (occurrence.sourceType === 'todo') return { title: 'Inbox' };
      return { title: 'Lift', allowsExternalCalendar: allows };
    },
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
    updateReconcileMeta: async () => undefined,
  };
  return {
    store,
    occurrenceById,
    planning,
    setAllows(next: boolean) {
      allows = next;
    },
  };
}

async function run() {
  const eventId = googleEventIdFromOccurrenceId(occTimed);
  const todoEventId = googleEventIdFromOccurrenceId(occTodo);

  assert.equal(
    decideOccurrenceProjectionEligibility({
      actorUserId: userA,
      occurrence: timed(),
      mode: 'automatic',
    }).ok,
    true
  );
  assert.equal(
    decideOccurrenceProjectionEligibility({
      actorUserId: userA,
      occurrence: timed(),
      mode: 'automatic',
      sourceAllowsExternalCalendar: false,
    }).ok,
    false
  );
  assert.equal(
    decideOccurrenceProjectionEligibility({
      actorUserId: userA,
      occurrence: todoOcc(),
      mode: 'automatic',
      sourceAllowsExternalCalendar: false,
    }).ok,
    true
  );
  assert.equal(
    decideAutomaticReconcileAction({
      actorUserId: userA,
      occurrence: timed(),
      linkStatus: 'upserted',
      sourceAllowsExternalCalendar: false,
    }),
    'withdraw'
  );

  {
    const calendar = createMemoryCalendar();
    const harness = createHarness({
      occurrence: timed(),
      calendar,
      allowsExternalCalendar: true,
    });
    await scheduleCalendarReconcile({ actorUserId: userA, store: harness.store });
    assert.equal(calendar.inserts, 1);
    assert.ok(calendar.events.has(eventId));
  }

  {
    const calendar = createMemoryCalendar();
    const harness = createHarness({
      occurrence: timed(),
      calendar,
      allowsExternalCalendar: false,
    });
    await scheduleCalendarReconcile({ actorUserId: userA, store: harness.store });
    assert.equal(calendar.inserts, 0);
    assert.equal(calendar.events.size, 0);
    assert.equal(harness.planning.status, 'planned');
  }

  {
    const calendar = createMemoryCalendar();
    const harness = createHarness({
      occurrence: timed(),
      calendar,
      allowsExternalCalendar: true,
    });
    await scheduleCalendarReconcile({ actorUserId: userA, store: harness.store });
    harness.setAllows(false);
    await scheduleCalendarReconcile({ actorUserId: userA, store: harness.store });
    assert.equal(calendar.deletes, 1);
    assert.equal(calendar.events.size, 0);
    assert.equal(harness.planning.status, 'planned');
    harness.setAllows(true);
    await scheduleCalendarReconcile({ actorUserId: userA, store: harness.store });
    assert.equal(calendar.inserts, 2);
    assert.equal(calendar.events.size, 1);
    assert.ok(calendar.events.has(eventId));
  }

  {
    const calendar = createMemoryCalendar();
    const harness = createHarness({
      occurrence: timed(),
      calendar,
      connection: baseConnection({ sync_enabled: false }),
    });
    await scheduleCalendarReconcile({ actorUserId: userA, store: harness.store });
    assert.equal(calendar.inserts, 0);
  }

  {
    const calendar = createMemoryCalendar();
    const harness = createHarness({
      occurrence: timed({ scheduledTime: null }),
      calendar,
    });
    await scheduleCalendarReconcile({ actorUserId: userA, store: harness.store });
    assert.equal(calendar.inserts, 0);
  }

  for (const status of ['completed', 'skipped', 'rescheduled'] as const) {
    const calendar = createMemoryCalendar();
    const harness = createHarness({
      occurrence: timed({ status }),
      calendar,
    });
    await scheduleCalendarReconcile({ actorUserId: userA, store: harness.store });
    assert.equal(calendar.inserts, 0, status);
  }

  {
    const calendar = createMemoryCalendar();
    const harness = createHarness({
      occurrence: timed(),
      calendar,
    });
    await scheduleCalendarReconcile({ actorUserId: userA, store: harness.store });
    harness.occurrenceById.set(occTimed, timed({ status: 'skipped' }));
    harness.planning.status = 'skipped';
    calendar.failNext = 'delete';
    await scheduleCalendarReconcile({ actorUserId: userA, store: harness.store });
    assert.equal(harness.planning.status, 'skipped');
    assert.equal(harness.planning.xp, 7);
    assert.equal(harness.planning.logs, 2);
    assert.equal(harness.planning.discipline, 3);
  }

  {
    const calendar = createMemoryCalendar();
    const harness = createHarness({
      occurrence: todoOcc(),
      calendar,
      allowsExternalCalendar: false,
    });
    await scheduleCalendarReconcile({ actorUserId: userA, store: harness.store });
    assert.equal(calendar.inserts, 1);
    assert.ok(calendar.events.has(todoEventId));
  }

  {
    const calendar = createMemoryCalendar();
    const other = timed({ userId: userB, id: occTodo });
    const harness = createHarness({ occurrence: timed(), calendar });
    harness.occurrenceById.set(other.id, other);
    await scheduleCalendarReconcile({ actorUserId: userA, store: harness.store });
    assert.equal(calendar.events.size, 1);
    assert.ok(calendar.events.has(eventId));
  }

  const planningDir = join(root, 'lib/planning');
  const planningBundle = readdirSync(planningDir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => readFileSync(join(planningDir, name), 'utf8'))
    .join('\n');
  assert.ok(!planningBundle.includes('lib/calendar'));
  const calendarDir = join(root, 'lib/calendar');
  const calendarBundle = readdirSync(calendarDir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => readFileSync(join(calendarDir, name), 'utf8'))
    .join('\n');
  assert.ok(!calendarBundle.includes("from('../planning"));
  assert.ok(!/xp_points|awardXp|calculateDisciplineScore/.test(calendarBundle));
  assert.ok(calendarBundle.includes('allowsExternalCalendar'));
  assert.ok(calendarBundle.includes('CALENDAR_SOURCE_LOAD_ERROR'));

  console.log(
    JSON.stringify(
      {
        ok: true,
        slice: 'calendar-3.4.2',
        default: 'project',
        flagOff: 'withdraw',
        todos: 'unchanged',
      },
      null,
      2
    )
  );
}

void run();
