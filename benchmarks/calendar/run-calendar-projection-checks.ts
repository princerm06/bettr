/**
 * Phase 3 Google Calendar Slice 2 — projection primitive checks.
 * Mocked Google HTTP. Does not apply migrations or call live Google.
 */
import assert from 'assert';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { CalendarConnectionRow } from '../../lib/calendar/connections';
import type { CalendarEventLinkRow } from '../../lib/calendar/eventLinks';
import type { ProjectionOccurrence } from '../../lib/calendar/eligibility';
import {
  googleEventIdFromOccurrenceId,
  isGoogleEventIdShape,
} from '../../lib/calendar/eventIdentity';
import {
  BETTR_EVENT_DESCRIPTION,
  buildGoogleEventPayload,
  DEFAULT_TIMED_DURATION_MINUTES,
} from '../../lib/calendar/eventPayload';
import type {
  GoogleCalendarEventBody,
} from '../../lib/calendar/eventPayload';
import type {
  GoogleCalendarEventsClient,
  GoogleEventGetResult,
  GoogleEventWriteResult,
} from '../../lib/calendar/googleEvents';
import {
  projectOccurrence,
  type ProjectOccurrenceStore,
} from '../../lib/calendar/projection';

const root = process.cwd();
const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const occRoutine = '33333333-3333-4333-8333-333333333333';
const occTodo = '44444444-4444-4444-8444-444444444444';
const occAllDay = '55555555-5555-4555-8555-555555555555';

function plannedRoutine(overrides: Partial<ProjectionOccurrence> = {}): ProjectionOccurrence {
  return {
    id: occRoutine,
    userId: userA,
    sourceType: 'routine',
    routineId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    todoId: null,
    scheduledDate: '2026-09-23',
    scheduledTime: '07:00:00',
    timezone: 'America/New_York',
    durationMinutes: 45,
    status: 'planned',
    ...overrides,
  };
}

function plannedTodo(overrides: Partial<ProjectionOccurrence> = {}): ProjectionOccurrence {
  return {
    id: occTodo,
    userId: userA,
    sourceType: 'todo',
    routineId: null,
    todoId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    scheduledDate: '2026-09-24',
    scheduledTime: '18:30:00',
    timezone: 'America/Los_Angeles',
    durationMinutes: 30,
    status: 'planned',
    ...overrides,
  };
}

function dateOnlyTodo(overrides: Partial<ProjectionOccurrence> = {}): ProjectionOccurrence {
  return plannedTodo({
    id: occAllDay,
    scheduledDate: '2026-09-25',
    scheduledTime: null,
    durationMinutes: null,
    timezone: 'America/Chicago',
    ...overrides,
  });
}

const connection: CalendarConnectionRow = {
  user_id: userA,
  sync_enabled: false,
  google_sub: 'sub',
  google_email: 'user@example.com',
  calendar_id: 'primary',
  refresh_token_ciphertext: 'cipher',
  granted_scopes: 'https://www.googleapis.com/auth/calendar.events',
  connected_at: '2026-09-21T00:00:00.000Z',
  updated_at: '2026-09-21T00:00:00.000Z',
  last_reconcile_at: null,
  last_error: null,
};

type MemoryCalendar = GoogleCalendarEventsClient & {
  events: Map<string, GoogleCalendarEventBody & { status?: string }>;
  inserts: number;
  patches: number;
  gets: number;
  deletes: number;
  failNext: 'insert' | 'patch' | 'get' | 'delete' | 'none';
};

function createMemoryCalendar(): MemoryCalendar {
  const events = new Map<string, GoogleCalendarEventBody & { status?: string }>();
  const calendar: MemoryCalendar = {
    events,
    inserts: 0,
    patches: 0,
    gets: 0,
    deletes: 0,
    failNext: 'none',
    async getEvent({ eventId }): Promise<GoogleEventGetResult> {
      calendar.gets += 1;
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
      if (events.has(body.id)) {
        return { kind: 'exists', eventId: body.id };
      }
      events.set(body.id, body);
      return { kind: 'ok', event: { id: body.id } };
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
      if (!events.has(eventId)) return { kind: 'missing' };
      events.delete(eventId);
      return { kind: 'ok' };
    },
  };
  return calendar;
}

function createStore(options: {
  actorOccurrence?: ProjectionOccurrence | null;
  sourceTitle?: string;
  calendar: MemoryCalendar;
  refreshOk?: boolean;
  saveLinkFails?: number;
  connected?: boolean;
}): {
  store: ProjectOccurrenceStore;
  planningWrites: number;
  logWrites: number;
  links: Map<string, CalendarEventLinkRow>;
} {
  const occurrence = options.actorOccurrence === undefined
    ? plannedRoutine()
    : options.actorOccurrence;
  const links = new Map<string, CalendarEventLinkRow>();
  let saveFailuresLeft = options.saveLinkFails ?? 0;
  const store: ProjectOccurrenceStore = {
    loadConnection: async () => (options.connected === false ? null : connection),
    loadOccurrence: async () => occurrence,
    loadSource: async (row) =>
      row
        ? {
            title: options.sourceTitle ?? (row.sourceType === 'todo' ? 'Ship Slice 2' : 'Morning lift'),
          }
        : null,
    loadLink: async (occurrenceId) => links.get(occurrenceId) ?? null,
    saveLink: async (row) => {
      if (saveFailuresLeft > 0) {
        saveFailuresLeft -= 1;
        return { ok: false, error: 'link write failed' };
      }
      const existing = links.get(row.occurrenceId);
      links.set(row.occurrenceId, {
        id: existing?.id ?? 'link-1',
        user_id: row.userId,
        occurrence_id: row.occurrenceId,
        google_event_id: row.googleEventId,
        calendar_id: row.calendarId,
        sync_status: row.syncStatus,
        last_error: row.lastError,
        created_at: existing?.created_at ?? '2026-09-23T00:00:00.000Z',
        updated_at: '2026-09-23T00:00:00.000Z',
      });
      return { ok: true };
    },
    decryptRefreshToken: () => 'refresh-token-value',
    refreshAccessToken: async () =>
      options.refreshOk === false
        ? { ok: false, message: 'refresh failed' }
        : { ok: true, accessToken: 'access-token-value' },
    calendar: options.calendar,
  };
  return {
    store,
    planningWrites: 0,
    logWrites: 0,
    links,
  };
}

const encoded = googleEventIdFromOccurrenceId(occRoutine);
assert.equal(encoded, `bttr${occRoutine.replace(/-/g, '')}`);
assert.ok(isGoogleEventIdShape(encoded));
assert.equal(encoded.length, 36);

const routinePayload = buildGoogleEventPayload(plannedRoutine(), {
  title: 'Morning lift',
});
assert.equal(routinePayload.summary, 'Morning lift');
assert.equal(routinePayload.description, BETTR_EVENT_DESCRIPTION);
assert.ok(!JSON.stringify(routinePayload).toLowerCase().includes('xp'));
assert.ok(!JSON.stringify(routinePayload).includes('discipline'));
assert.deepEqual(routinePayload.start, {
  dateTime: '2026-09-23T07:00:00',
  timeZone: 'America/New_York',
});
assert.deepEqual(routinePayload.end, {
  dateTime: '2026-09-23T07:45:00',
  timeZone: 'America/New_York',
});

const todoPayload = buildGoogleEventPayload(plannedTodo(), { title: 'Ship Slice 2' });
assert.equal(todoPayload.summary, 'Ship Slice 2');
assert.deepEqual(todoPayload.start, {
  dateTime: '2026-09-24T18:30:00',
  timeZone: 'America/Los_Angeles',
});
assert.deepEqual(todoPayload.end, {
  dateTime: '2026-09-24T19:00:00',
  timeZone: 'America/Los_Angeles',
});

const allDayPayload = buildGoogleEventPayload(dateOnlyTodo(), { title: 'Read notes' });
assert.deepEqual(allDayPayload.start, { date: '2026-09-25' });
assert.deepEqual(allDayPayload.end, { date: '2026-09-26' });
assert.ok(!('dateTime' in allDayPayload.start));

const defaultDuration = buildGoogleEventPayload(
  plannedRoutine({ durationMinutes: null }),
  { title: 'Morning lift' }
);
assert.deepEqual(defaultDuration.end, {
  dateTime: `2026-09-23T07:${String(DEFAULT_TIMED_DURATION_MINUTES).padStart(2, '0')}:00`,
  timeZone: 'America/New_York',
});

async function runProjectionCases() {
async function project(
  occurrence: ProjectionOccurrence | null,
  extras: {
    actorUserId?: string;
    refreshOk?: boolean;
    saveLinkFails?: number;
    connected?: boolean;
    calendar?: MemoryCalendar;
    title?: string;
  } = {}
) {
  const calendar = extras.calendar ?? createMemoryCalendar();
  const memory = createStore({
    actorOccurrence: occurrence,
    calendar,
    refreshOk: extras.refreshOk,
    saveLinkFails: extras.saveLinkFails,
    connected: extras.connected,
    sourceTitle: extras.title,
  });
  const snapshot = occurrence ? { ...occurrence } : null;
  const first = await projectOccurrence({
    actorUserId: extras.actorUserId ?? userA,
    occurrenceId: occurrence?.id ?? occRoutine,
    store: memory.store,
  });
  return { first, memory, calendar, snapshot };
}

{
  const { first } = await project(plannedRoutine({ status: 'completed' }));
  assert.equal(first.result, 'ineligible');
}
{
  const { first } = await project(plannedRoutine({ status: 'skipped' }));
  assert.equal(first.result, 'ineligible');
}
{
  const { first } = await project(plannedRoutine({ status: 'rescheduled' }));
  assert.equal(first.result, 'ineligible');
}
{
  const { first, calendar } = await project(plannedRoutine({ userId: userB }), {
    actorUserId: userA,
  });
  assert.equal(first.result, 'denied');
  assert.equal(calendar.inserts, 0);
}
{
  const { first } = await project(plannedRoutine(), { connected: false });
  assert.equal(first.result, 'not_connected');
}

{
  const { first, memory, calendar, snapshot } = await project(plannedRoutine());
  assert.equal(first.result, 'created');
  assert.equal(first.googleEventId, googleEventIdFromOccurrenceId(occRoutine));
  assert.equal(calendar.events.size, 1);
  assert.equal(memory.links.size, 1);
  assert.equal(memory.links.get(occRoutine)?.sync_status, 'upserted');
  assert.deepEqual(snapshot, plannedRoutine());
  assert.equal(memory.planningWrites, 0);
  assert.equal(memory.logWrites, 0);

  const retry = await projectOccurrence({
    actorUserId: userA,
    occurrenceId: occRoutine,
    store: memory.store,
  });
  assert.equal(retry.result, 'updated');
  assert.equal(calendar.events.size, 1);
  assert.equal(calendar.inserts, 1);
  assert.ok(calendar.patches >= 1);
}

{
  const calendar = createMemoryCalendar();
  const memory = createStore({
    actorOccurrence: plannedTodo(),
    calendar,
    saveLinkFails: 1,
  });
  const first = await projectOccurrence({
    actorUserId: userA,
    occurrenceId: occTodo,
    store: memory.store,
  });
  assert.equal(first.result, 'error');
  assert.equal(calendar.events.size, 1);
  assert.equal(memory.links.size, 0);
  const retry = await projectOccurrence({
    actorUserId: userA,
    occurrenceId: occTodo,
    store: memory.store,
  });
  assert.ok(retry.result === 'updated' || retry.result === 'created');
  assert.equal(calendar.events.size, 1);
  assert.equal(memory.links.size, 1);
  assert.equal(memory.links.get(occTodo)?.google_event_id, googleEventIdFromOccurrenceId(occTodo));
}

{
  const calendar = createMemoryCalendar();
  const memory = createStore({
    actorOccurrence: dateOnlyTodo(),
    calendar,
  });
  const created = await projectOccurrence({
    actorUserId: userA,
    occurrenceId: occAllDay,
    store: memory.store,
  });
  assert.equal(created.result, 'created');
  calendar.events.delete(googleEventIdFromOccurrenceId(occAllDay));
  const recovered = await projectOccurrence({
    actorUserId: userA,
    occurrenceId: occAllDay,
    store: memory.store,
  });
  assert.equal(recovered.result, 'updated');
  assert.equal(calendar.events.size, 1);
  assert.equal(
    memory.links.get(occAllDay)?.google_event_id,
    googleEventIdFromOccurrenceId(occAllDay)
  );
}

{
  const calendar = createMemoryCalendar();
  const occurrence = plannedRoutine();
  const memory = createStore({
    actorOccurrence: occurrence,
    calendar,
    refreshOk: false,
  });
  const first = await projectOccurrence({
    actorUserId: userA,
    occurrenceId: occRoutine,
    store: memory.store,
  });
  assert.equal(first.result, 'error');
  assert.equal(calendar.inserts, 0);
  assert.equal(calendar.events.size, 0);
  assert.equal(occurrence.status, 'planned');
  assert.equal(memory.planningWrites, 0);
}

{
  const calendar = createMemoryCalendar();
  calendar.failNext = 'insert';
  const occurrence = plannedTodo();
  const memory = createStore({ actorOccurrence: occurrence, calendar });
  const first = await projectOccurrence({
    actorUserId: userA,
    occurrenceId: occTodo,
    store: memory.store,
  });
  assert.equal(first.result, 'error');
  assert.equal(calendar.events.size, 0);
  assert.equal(occurrence.status, 'planned');
  assert.equal(memory.planningWrites, 0);
  assert.equal(memory.logWrites, 0);
}

const calendarDir = join(root, 'lib/calendar');
const calendarFiles = readdirSync(calendarDir).filter((name) => name.endsWith('.ts'));
const calendarBundle = calendarFiles
  .map((name) => readFileSync(join(calendarDir, name), 'utf8'))
  .join('\n');
assert.ok(!calendarBundle.includes("from '../planning"));
assert.ok(!calendarBundle.includes("from '../../planning"));
assert.ok(!calendarBundle.includes("from 'lib/planning"));
assert.ok(!calendarBundle.includes("from 'googleapis'"));
assert.ok(!calendarBundle.includes('lib/evaluation'));
assert.ok(!calendarBundle.includes("from('logs')"));
assert.ok(!calendarBundle.includes("from('xp"));
assert.ok(!calendarBundle.includes('discipline'));
assert.ok(!calendarBundle.toLowerCase().includes('award xp'));

for (const name of calendarFiles) {
  if (name === 'googleEvents.ts' || name === 'googleCalendars.ts') continue;
  const text = readFileSync(join(calendarDir, name), 'utf8');
  assert.ok(
    !text.includes('/calendar/v3'),
    `${name} must not call Calendar HTTP directly`
  );
}

const googleEvents = readFileSync(join(calendarDir, 'googleEvents.ts'), 'utf8');
assert.ok(googleEvents.includes('/calendar/v3'));
assert.ok(googleEvents.includes('method: \'POST\''));
assert.ok(
  readFileSync(join(calendarDir, 'googleCalendars.ts'), 'utf8').includes('/calendar/v3')
);
assert.ok(googleEvents.includes('method: \'PATCH\''));
assert.ok(googleEvents.includes('method: \'DELETE\''));

const planningDir = join(root, 'lib/planning');
const planningBundle = readdirSync(planningDir)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => readFileSync(join(planningDir, name), 'utf8'))
  .join('\n');
assert.ok(!planningBundle.includes('lib/calendar'));
assert.ok(!planningBundle.includes('projectOccurrence'));
assert.ok(!planningBundle.includes('google_calendar_event_links'));

const route = readFileSync(
  join(root, 'app/api/calendar/project-occurrence/route.ts'),
  'utf8'
);
assert.ok(route.includes('calendarUserFromBearer'));
assert.ok(route.includes("mode: 'manual'"));
assert.ok(!route.includes('syncEnabled'));
assert.ok(!route.includes('connection.sync'));
assert.ok(route.includes('actorUserId: user.id'));
assert.ok(!route.includes('body.userId'));
assert.ok(!route.includes("body.user_id"));

const settings = readFileSync(
  join(root, 'app/calendar/GoogleCalendarSettings.tsx'),
  'utf8'
);
assert.ok(settings.includes('Sync:'));
assert.ok(settings.includes("process.env.NODE_ENV !== 'production'"));
assert.ok(settings.includes('Test occurrence projection'));
assert.ok(settings.includes('/api/calendar/project-occurrence'));
assert.ok(!settings.includes('Sync now'));

console.log(
  JSON.stringify(
    {
      ok: true,
      slice: 'calendar-2',
      events: 'manual-projection-only',
      syncEnabled: false,
      identity: 'bttr+uuid-hex',
    },
    null,
    2
  )
);
}

void runProjectionCases().catch((error) => {
  console.error(error);
  process.exit(1);
});
