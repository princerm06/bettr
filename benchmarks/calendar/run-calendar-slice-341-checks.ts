/**
 * Slice 3.4.1 Calendar: after Routine schedule propagation, existing reconcile.
 * Planning mutation is simulated; Calendar remains downstream.
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
import {
  prepareOccurrenceRoutineScheduleUpdate,
  routineScheduleTemplateFromRoutine,
  selectOccurrencesForRoutineScheduleSync,
} from '../../lib/planning/routineSchedulePropagation';
import type { PlannedOccurrence, Routine } from '../../lib/planning/types';

const root = process.cwd();
const userA = '11111111-1111-4111-8111-111111111111';
const occId = '48fae0ad-4ac0-4097-a067-76b024448e21';
const routineId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function asProjection(row: PlannedOccurrence): ProjectionOccurrence {
  return {
    id: row.id,
    userId: row.userId,
    sourceType: row.sourceType,
    routineId: row.routineId,
    todoId: row.todoId,
    scheduledDate: row.scheduledDate,
    scheduledTime: row.scheduledTime,
    timezone: row.timezone,
    durationMinutes: row.durationMinutes,
    status: row.status,
  };
}

function baseRoutine(overrides: Partial<Routine> = {}): Routine {
  return {
    id: routineId,
    userId: userA,
    title: 'Calendar Done Test',
    description: null,
    categories: ['physical'],
    goalId: null,
    recurrenceType: 'daily',
    weekdays: null,
    weekdayLabels: null,
    scheduledTime: '15:00:00',
    durationMinutes: 30,
    timezone: 'America/New_York',
    isActive: true,
    externalCalendarEnabled: true,
    deletedAt: null,
    createdAt: '2026-09-21T00:00:00.000Z',
    updatedAt: '2026-09-21T00:00:00.000Z',
    ...overrides,
  };
}

function plannedRow(overrides: Partial<PlannedOccurrence> = {}): PlannedOccurrence {
  return {
    id: occId,
    userId: userA,
    sourceType: 'routine',
    routineId,
    todoId: null,
    scheduledDate: '2026-09-23',
    scheduledTime: null,
    timezone: 'America/New_York',
    durationMinutes: 30,
    status: 'planned',
    completionMode: null,
    logId: null,
    resolvedAt: null,
    rescheduledToId: null,
    createdAt: '2026-09-23T00:00:00.000Z',
    updatedAt: '2026-09-23T00:00:00.000Z',
    ...overrides,
  };
}

function propagate(row: PlannedOccurrence, routine: Routine): PlannedOccurrence {
  const template = routineScheduleTemplateFromRoutine(routine);
  const selected = selectOccurrencesForRoutineScheduleSync([row], {
    ownerId: userA,
    routineId: routine.id,
    template,
  });
  if (selected.length === 0) return row;
  const prepared = prepareOccurrenceRoutineScheduleUpdate(
    row,
    template,
    '2026-09-23T18:00:00.000Z'
  );
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return row;
  return {
    ...row,
    scheduledTime: prepared.value.scheduled_time,
    durationMinutes: prepared.value.duration_minutes,
    timezone: prepared.value.timezone,
  };
}

function connection(): CalendarConnectionRow {
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
      events.set(eventId, { ...existing, ...body, id: eventId, status: 'confirmed' });
      return { kind: 'ok', event: { id: eventId, status: 'confirmed' } };
    },
    async deleteEvent() {
      calendar.deletes += 1;
      if (calendar.failNext === 'delete') {
        calendar.failNext = 'none';
        return { kind: 'error', message: 'Google Calendar is unavailable.' };
      }
      events.clear();
      return { kind: 'ok' };
    },
  };
  return calendar;
}

function createHarness(occurrence: PlannedOccurrence, calendar: MemoryCalendar, refreshFails = false) {
  const occurrenceById = new Map([[occurrence.id, asProjection(occurrence)]]);
  const links = new Map<string, CalendarEventLinkRow>();
  const conn = connection();
  const planning = { xp: 0, logs: 0, discipline: 0, occurrence: { ...occurrence } };
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
    loadSource: async () => ({ title: 'Calendar Done Test' }),
    loadLink: async (id) => links.get(id) ?? null,
    saveLink,
    decryptRefreshToken: () => 'refresh-token-value',
    refreshAccessToken: async () =>
      refreshFails
        ? { ok: false, message: 'refresh failed' }
        : { ok: true, accessToken: 'access-token-value' },
    calendar,
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
  return { store, occurrenceById, planning };
}

async function run() {
  const eventId = googleEventIdFromOccurrenceId(occId);

  {
    const calendar = createMemoryCalendar();
    const mutated = propagate(plannedRow(), baseRoutine({ scheduledTime: '15:00:00' }));
    assert.equal(mutated.scheduledTime, '15:00:00');
    const harness = createHarness(mutated, calendar);
    harness.planning.occurrence = mutated;
    await scheduleCalendarReconcile({ actorUserId: userA, store: harness.store });
    assert.equal(calendar.inserts, 1);
    assert.ok(calendar.events.has(eventId));
    assert.equal(calendar.events.size, 1);
    assert.equal(harness.planning.xp, 0);
    assert.equal(harness.planning.logs, 0);
  }

  {
    const calendar = createMemoryCalendar();
    const timed = propagate(plannedRow(), baseRoutine({ scheduledTime: '15:00:00' }));
    const harness = createHarness(timed, calendar);
    await scheduleCalendarReconcile({ actorUserId: userA, store: harness.store });
    const later = propagate(timed, baseRoutine({ scheduledTime: '16:00:00' }));
    harness.occurrenceById.set(occId, asProjection(later));
    await scheduleCalendarReconcile({ actorUserId: userA, store: harness.store });
    assert.equal(calendar.inserts, 1);
    assert.equal(calendar.patches, 1);
    assert.equal(calendar.events.size, 1);
    assert.ok(calendar.events.has(eventId));
  }

  {
    const calendar = createMemoryCalendar();
    const timed = propagate(plannedRow(), baseRoutine({ scheduledTime: '15:00:00' }));
    const harness = createHarness(timed, calendar);
    await scheduleCalendarReconcile({ actorUserId: userA, store: harness.store });
    const dateOnly = propagate(timed, baseRoutine({ scheduledTime: null }));
    harness.occurrenceById.set(occId, asProjection(dateOnly));
    await scheduleCalendarReconcile({ actorUserId: userA, store: harness.store });
    assert.equal(calendar.deletes, 1);
    assert.equal(calendar.events.size, 0);
  }

  {
    const calendar = createMemoryCalendar();
    const timed = propagate(
      plannedRow({ durationMinutes: 30, scheduledTime: '15:00:00' }),
      baseRoutine({ scheduledTime: '15:00:00', durationMinutes: 30 })
    );
    const harness = createHarness(timed, calendar);
    await scheduleCalendarReconcile({ actorUserId: userA, store: harness.store });
    const longer = propagate(
      timed,
      baseRoutine({ scheduledTime: '15:00:00', durationMinutes: 60 })
    );
    harness.occurrenceById.set(occId, asProjection(longer));
    await scheduleCalendarReconcile({ actorUserId: userA, store: harness.store });
    assert.equal(calendar.patches, 1);
    assert.equal(calendar.inserts, 1);
    assert.equal(calendar.events.size, 1);
  }

  {
    const calendar = createMemoryCalendar();
    const mutated = propagate(plannedRow(), baseRoutine({ scheduledTime: '15:00:00' }));
    const harness = createHarness(mutated, calendar, true);
    harness.planning.occurrence = mutated;
    harness.planning.xp = 0;
    await scheduleCalendarReconcile({ actorUserId: userA, store: harness.store });
    assert.equal(harness.planning.occurrence.scheduledTime, '15:00:00');
    assert.equal(harness.planning.xp, 0);
    assert.equal(calendar.inserts, 0);
  }

  const planningDir = join(root, 'lib/planning');
  const planningBundle = readdirSync(planningDir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => readFileSync(join(planningDir, name), 'utf8'))
    .join('\n');
  assert.ok(!planningBundle.includes('lib/calendar'));
  assert.ok(
    readFileSync(join(root, 'app/planning/RoutinesView.tsx'), 'utf8').includes(
      'requestCalendarReconcileAfterPlanning'
    )
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        slice: 'calendar-3.4.1',
        identity: 'bttr+uuid-hex',
        liveRowUntouched: occId,
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
