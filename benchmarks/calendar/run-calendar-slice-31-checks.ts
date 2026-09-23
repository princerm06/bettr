/**
 * Phase 3 Google Calendar Slice 3.1 — eligibility, DELETE, withdrawal,
 * cancelled-event recovery. Mocked transport. No reconcile/sync UI/hooks.
 */
import assert from 'assert';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { CalendarConnectionRow } from '../../lib/calendar/connections';
import type { CalendarEventLinkRow } from '../../lib/calendar/eventLinks';
import {
  decideOccurrenceProjectionEligibility,
  isTimedOccurrence,
  shouldWithdrawProjectedCopy,
  type ProjectionOccurrence,
} from '../../lib/calendar/eligibility';
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
  withdrawOccurrenceProjection,
  type WithdrawOccurrenceStore,
} from '../../lib/calendar/withdraw';

const root = process.cwd();
const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const occTimed = '33333333-3333-4333-8333-333333333333';
const occAllDay = '55555555-5555-4555-8555-555555555555';

function timedPlanned(
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

function dateOnlyPlanned(
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

assert.equal(isTimedOccurrence(timedPlanned()), true);
assert.equal(isTimedOccurrence(dateOnlyPlanned()), false);

assert.equal(
  decideOccurrenceProjectionEligibility({
    actorUserId: userA,
    occurrence: dateOnlyPlanned(),
    mode: 'manual',
  }).ok,
  true
);
assert.equal(
  decideOccurrenceProjectionEligibility({
    actorUserId: userA,
    occurrence: dateOnlyPlanned(),
    mode: 'automatic',
  }).ok,
  false
);
assert.equal(
  decideOccurrenceProjectionEligibility({
    actorUserId: userA,
    occurrence: timedPlanned(),
    mode: 'automatic',
  }).ok,
  true
);
assert.equal(
  decideOccurrenceProjectionEligibility({
    actorUserId: userA,
    occurrence: timedPlanned({ status: 'skipped' }),
    mode: 'automatic',
  }).ok,
  false
);
const deniedEligibility = decideOccurrenceProjectionEligibility({
  actorUserId: userA,
  occurrence: timedPlanned({ userId: userB }),
});
assert.equal(deniedEligibility.ok, false);
if (!deniedEligibility.ok) assert.equal(deniedEligibility.result, 'denied');

assert.equal(
  shouldWithdrawProjectedCopy({
    actorUserId: userA,
    occurrence: timedPlanned({ status: 'skipped' }),
  }).ok,
  true
);
assert.equal(
  shouldWithdrawProjectedCopy({
    actorUserId: userA,
    occurrence: timedPlanned({ status: 'completed' }),
  }).ok,
  true
);
assert.equal(
  shouldWithdrawProjectedCopy({
    actorUserId: userA,
    occurrence: timedPlanned({ status: 'rescheduled' }),
  }).ok,
  true
);
assert.equal(
  shouldWithdrawProjectedCopy({
    actorUserId: userA,
    occurrence: dateOnlyPlanned(),
    mode: 'automatic',
  }).ok,
  true
);
assert.equal(
  shouldWithdrawProjectedCopy({
    actorUserId: userA,
    occurrence: timedPlanned(),
    mode: 'automatic',
  }).ok,
  false
);

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
      if (events.has(body.id)) {
        return { kind: 'exists', eventId: body.id };
      }
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

function createStores(options: {
  occurrence: ProjectionOccurrence | null;
  calendar: MemoryCalendar;
  refreshOk?: boolean;
  connected?: boolean;
}): {
  project: ProjectOccurrenceStore;
  withdraw: WithdrawOccurrenceStore;
  links: Map<string, CalendarEventLinkRow>;
  occurrence: ProjectionOccurrence | null;
} {
  const links = new Map<string, CalendarEventLinkRow>();
  const occurrence = options.occurrence;
  const saveLink: ProjectOccurrenceStore['saveLink'] = async (row) => {
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
  };
  const shared = {
    loadConnection: async () => (options.connected === false ? null : connection),
    loadOccurrence: async () => occurrence,
    loadSource: async () => ({ title: 'BJJ training' }),
    loadLink: async (occurrenceId: string) => links.get(occurrenceId) ?? null,
    saveLink,
    decryptRefreshToken: () => 'refresh-token-value',
    refreshAccessToken: async () =>
      options.refreshOk === false
        ? { ok: false as const, message: 'refresh failed' }
        : { ok: true as const, accessToken: 'access-token-value' },
    calendar: options.calendar,
  };
  return { project: shared, withdraw: shared, links, occurrence };
}

async function run() {
  {
    const calendar = createMemoryCalendar();
    const memory = createStores({
      occurrence: dateOnlyPlanned(),
      calendar,
    });
    const automatic = await projectOccurrence({
      actorUserId: userA,
      occurrenceId: occAllDay,
      store: memory.project,
      mode: 'automatic',
    });
    assert.equal(automatic.result, 'ineligible');
    assert.equal(calendar.inserts, 0);
    const manual = await projectOccurrence({
      actorUserId: userA,
      occurrenceId: occAllDay,
      store: memory.project,
      mode: 'manual',
    });
    assert.equal(manual.result, 'created');
    assert.equal(calendar.events.size, 1);
  }

  {
    const calendar = createMemoryCalendar();
    const memory = createStores({ occurrence: timedPlanned(), calendar });
    const created = await projectOccurrence({
      actorUserId: userA,
      occurrenceId: occTimed,
      store: memory.project,
      mode: 'automatic',
    });
    assert.equal(created.result, 'created');
    const eventId = googleEventIdFromOccurrenceId(occTimed);
    const live = calendar.events.get(eventId);
    assert.ok(live);
    calendar.events.set(eventId, { ...live!, status: 'cancelled' });

    const recovered = await projectOccurrence({
      actorUserId: userA,
      occurrenceId: occTimed,
      store: memory.project,
      mode: 'automatic',
    });
    assert.equal(recovered.result, 'updated');
    assert.equal(calendar.events.size, 1);
    assert.equal(calendar.events.get(eventId)?.status, 'confirmed');
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
    const memory = createStores({ occurrence: timedPlanned(), calendar });
    const recovered = await projectOccurrence({
      actorUserId: userA,
      occurrenceId: occTimed,
      store: memory.project,
      mode: 'manual',
    });
    assert.equal(recovered.result, 'updated');
    assert.equal(calendar.inserts, 1);
    assert.equal(calendar.events.size, 1);
    assert.equal(calendar.events.get(eventId)?.status, 'confirmed');
  }

  {
    const calendar = createMemoryCalendar();
    const occurrence = timedPlanned();
    const memory = createStores({ occurrence, calendar });
    await projectOccurrence({
      actorUserId: userA,
      occurrenceId: occTimed,
      store: memory.project,
    });
    const snapshot = { ...occurrence };
    occurrence.status = 'skipped';
    const withdrawn = await withdrawOccurrenceProjection({
      actorUserId: userA,
      occurrenceId: occTimed,
      store: memory.withdraw,
    });
    assert.equal(withdrawn.result, 'withdrawn');
    assert.equal(calendar.events.size, 0);
    assert.equal(memory.links.get(occTimed)?.sync_status, 'deleted');
    assert.equal(snapshot.scheduledDate, '2026-09-23');
    assert.equal(occurrence.scheduledDate, snapshot.scheduledDate);
  }

  {
    const calendar = createMemoryCalendar();
    const occurrence = timedPlanned();
    const memory = createStores({ occurrence, calendar });
    await projectOccurrence({
      actorUserId: userA,
      occurrenceId: occTimed,
      store: memory.project,
      mode: 'manual',
    });
    assert.equal(calendar.events.size, 1);
    occurrence.status = 'completed';
    const withdrawn = await withdrawOccurrenceProjection({
      actorUserId: userA,
      occurrenceId: occTimed,
      store: memory.withdraw,
    });
    assert.equal(withdrawn.result, 'withdrawn');
    assert.equal(calendar.events.size, 0);
    assert.equal(occurrence.status, 'completed');
  }

  {
    const calendar = createMemoryCalendar();
    const occurrence = timedPlanned();
    const memory = createStores({ occurrence, calendar });
    await projectOccurrence({
      actorUserId: userA,
      occurrenceId: occTimed,
      store: memory.project,
    });
    occurrence.status = 'rescheduled';
    const withdrawn = await withdrawOccurrenceProjection({
      actorUserId: userA,
      occurrenceId: occTimed,
      store: memory.withdraw,
    });
    assert.equal(withdrawn.result, 'withdrawn');
    assert.equal(calendar.events.size, 0);
    assert.equal(occurrence.status, 'rescheduled');
  }

  {
    const calendar = createMemoryCalendar();
    const memory = createStores({
      occurrence: timedPlanned({ userId: userB }),
      calendar,
    });
    const denied = await withdrawOccurrenceProjection({
      actorUserId: userA,
      occurrenceId: occTimed,
      store: memory.withdraw,
    });
    assert.equal(denied.result, 'denied');
    assert.equal(calendar.deletes, 0);
  }

  {
    const calendar = createMemoryCalendar();
    const memory = createStores({
      occurrence: timedPlanned(),
      calendar,
    });
    const empty = await withdrawOccurrenceProjection({
      actorUserId: userA,
      occurrenceId: occTimed,
      store: memory.withdraw,
    });
    assert.equal(empty.result, 'noop');
    assert.equal(calendar.deletes, 1);
  }

  {
    const calendar = createMemoryCalendar();
    const occurrence = timedPlanned();
    const memory = createStores({ occurrence, calendar });
    await projectOccurrence({
      actorUserId: userA,
      occurrenceId: occTimed,
      store: memory.project,
    });
    calendar.failNext = 'delete';
    const failed = await withdrawOccurrenceProjection({
      actorUserId: userA,
      occurrenceId: occTimed,
      store: memory.withdraw,
    });
    assert.equal(failed.result, 'error');
    assert.equal(calendar.events.size, 1);
    assert.equal(memory.links.get(occTimed)?.sync_status, 'error');
    assert.equal(occurrence.status, 'planned');
  }

  {
    const calendar = createMemoryCalendar();
    const eventId = googleEventIdFromOccurrenceId(occTimed);
    const occurrence = timedPlanned();
    const memory = createStores({ occurrence, calendar });
    await projectOccurrence({
      actorUserId: userA,
      occurrenceId: occTimed,
      store: memory.project,
    });
    const live = calendar.events.get(eventId)!;
    calendar.events.set(eventId, { ...live, status: 'cancelled' });
    const withdrawn = await withdrawOccurrenceProjection({
      actorUserId: userA,
      occurrenceId: occTimed,
      store: memory.withdraw,
    });
    assert.equal(withdrawn.result, 'withdrawn');
    assert.equal(calendar.events.size, 0);
    assert.equal(occurrence.status, 'planned');
  }

  {
    const calendar = createMemoryCalendar();
    const memory = createStores({
      occurrence: timedPlanned(),
      calendar,
      refreshOk: false,
    });
    await memory.project.saveLink({
      userId: userA,
      occurrenceId: occTimed,
      googleEventId: googleEventIdFromOccurrenceId(occTimed),
      calendarId: 'primary',
      syncStatus: 'upserted',
      lastError: null,
    });
    const failed = await withdrawOccurrenceProjection({
      actorUserId: userA,
      occurrenceId: occTimed,
      store: memory.withdraw,
    });
    assert.equal(failed.result, 'error');
    assert.equal(calendar.deletes, 0);
  }

  const calendarDir = join(root, 'lib/calendar');
  const calendarFiles = readdirSync(calendarDir).filter((name) => name.endsWith('.ts'));
  const calendarBundle = calendarFiles
    .map((name) => readFileSync(join(calendarDir, name), 'utf8'))
    .join('\n');
  assert.ok(!calendarBundle.includes("from '../planning"));
  assert.ok(!calendarBundle.includes("from 'lib/planning"));
  assert.ok(!calendarBundle.includes("from('logs')"));
  assert.ok(!readFileSync(join(calendarDir, 'eligibility.ts'), 'utf8').includes('googleapis'));
  assert.ok(
    !readFileSync(join(calendarDir, 'eligibility.ts'), 'utf8').includes('/calendar/v3')
  );
  assert.ok(
    readFileSync(join(calendarDir, 'googleEvents.ts'), 'utf8').includes("method: 'DELETE'")
  );
  assert.ok(
    readFileSync(join(calendarDir, 'googleEvents.ts'), 'utf8').includes('showDeleted')
  );
  assert.ok(
    readFileSync(join(calendarDir, 'googleEvents.ts'), 'utf8').includes("'confirmed'")
  );

  const planningBundle = readdirSync(join(root, 'lib/planning'))
    .filter((name) => name.endsWith('.ts'))
    .map((name) => readFileSync(join(root, 'lib/planning', name), 'utf8'))
    .join('\n');
  assert.ok(!planningBundle.includes('lib/calendar'));
  assert.ok(!planningBundle.includes('withdrawOccurrenceProjection'));
  assert.ok(!planningBundle.includes('google_calendar'));

  const access = readFileSync(join(root, 'lib/planning/occurrencesAccess.ts'), 'utf8');
  assert.ok(!access.includes('withdrawOccurrence'));
  assert.ok(!access.includes('projectOccurrence'));

  console.log(
    JSON.stringify(
      {
        ok: true,
        slice: 'calendar-3.1',
        automatic: 'timed-only',
        withdraw: true,
        cancelledRecovery: true,
        reconcile: false,
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
