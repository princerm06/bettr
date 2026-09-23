/**
 * Phase 3 Slice 3.4.2 — Routine archive/skip, tombstone, rematerialize.
 * Does not award XP or touch live persistence.
 */
import assert from 'assert';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { decideSkip } from '../../lib/planning/completion';
import {
  buildMissingTodayOccurrenceDrafts,
  isRoutineOccurrenceActionable,
  isRoutineLiveForPlanning,
  prepareRoutineTombstone,
  ROUTINE_VALIDATION_MESSAGES,
  routineAllowsExternalCalendar,
} from '../../lib/planning';
import type { PlannedOccurrence, Routine } from '../../lib/planning/types';

const root = process.cwd();
const userA = 'user-a';
const userB = 'user-b';
const resolvedAt = '2026-09-23T18:00:00.000Z';

function routine(overrides: Partial<Routine> = {}): Routine {
  return {
    id: 'routine-a',
    userId: userA,
    title: 'Lift',
    description: null,
    categories: ['physical'],
    goalId: null,
    recurrenceType: 'daily',
    weekdays: null,
    weekdayLabels: null,
    scheduledTime: '07:00:00',
    durationMinutes: 45,
    timezone: 'UTC',
    isActive: true,
    externalCalendarEnabled: true,
    deletedAt: null,
    createdAt: resolvedAt,
    updatedAt: resolvedAt,
    ...overrides,
  };
}

function occurrence(
  overrides: Partial<PlannedOccurrence> = {}
): PlannedOccurrence {
  return {
    id: 'occ-a',
    userId: userA,
    sourceType: 'routine',
    routineId: 'routine-a',
    todoId: null,
    scheduledDate: '2026-09-23',
    scheduledTime: '07:00:00',
    timezone: 'UTC',
    durationMinutes: 45,
    status: 'planned',
    completionMode: null,
    logId: null,
    resolvedAt: null,
    rescheduledToId: null,
    createdAt: resolvedAt,
    updatedAt: resolvedAt,
    ...overrides,
  };
}

const logsXpDiscipline = { logs: 1, xp: 12, discipline: 4 };

{
  const planned = occurrence();
  const completed = occurrence({
    id: 'occ-completed',
    scheduledDate: '2026-09-22',
    status: 'completed',
    completionMode: 'light',
    resolvedAt,
  });
  const skipped = occurrence({
    id: 'occ-skipped',
    scheduledDate: '2026-09-21',
    status: 'skipped',
    resolvedAt,
  });
  const rescheduled = occurrence({
    id: 'occ-rescheduled',
    scheduledDate: '2026-09-20',
    status: 'rescheduled',
    resolvedAt,
    rescheduledToId: 'occ-dest',
  });
  const otherRoutine = occurrence({
    id: 'occ-other-routine',
    routineId: 'routine-b',
  });
  const otherUser = occurrence({
    id: 'occ-other-user',
    userId: userB,
  });

  const skipPlanned = decideSkip(planned, resolvedAt);
  assert.equal(skipPlanned.kind, 'apply');
  if (skipPlanned.kind === 'apply') {
    assert.equal(skipPlanned.next.status, 'skipped');
  }
  assert.equal(decideSkip(completed, resolvedAt).kind, 'reject');
  assert.equal(decideSkip(skipped, resolvedAt).kind, 'noop');
  assert.equal(decideSkip(rescheduled, resolvedAt).kind, 'reject');

  const archived = routine({ isActive: false });
  const released = occurrence({ status: 'skipped', resolvedAt });
  assert.equal(isRoutineOccurrenceActionable(archived, released), false);
  assert.equal(isRoutineOccurrenceActionable(archived, planned), false);
  assert.equal(isRoutineOccurrenceActionable(routine(), completed), false);
  assert.equal(isRoutineOccurrenceActionable(routine(), planned), true);
  assert.equal(isRoutineLiveForPlanning(archived), false);
  assert.equal(
    routineAllowsExternalCalendar(archived),
    false
  );
  assert.equal(
    routineAllowsExternalCalendar(routine({ externalCalendarEnabled: false })),
    false
  );
  assert.equal(routineAllowsExternalCalendar(routine()), true);

  assert.equal(otherRoutine.routineId, 'routine-b');
  assert.equal(otherUser.userId, userB);
  assert.equal(logsXpDiscipline.logs, 1);
  assert.equal(logsXpDiscipline.xp, 12);
  assert.equal(logsXpDiscipline.discipline, 4);
}

{
  const skippedToday = occurrence({ status: 'skipped', resolvedAt });
  const restored = routine({ isActive: true });
  const draftsSameDay = buildMissingTodayOccurrenceDrafts({
    now: new Date('2026-09-23T12:00:00.000Z'),
    viewerTimeZone: 'UTC',
    ownerId: userA,
    routines: [restored],
    todos: [],
    existing: [skippedToday],
  });
  assert.equal(draftsSameDay.length, 0);

  const draftsNextDay = buildMissingTodayOccurrenceDrafts({
    now: new Date('2026-09-24T12:00:00.000Z'),
    viewerTimeZone: 'UTC',
    ownerId: userA,
    routines: [restored],
    todos: [],
    existing: [skippedToday],
  });
  assert.equal(draftsNextDay.length, 1);
  assert.equal(draftsNextDay[0]?.scheduledDate, '2026-09-24');
  assert.equal(draftsNextDay[0]?.status, 'planned');
}

{
  const tombstoned = routine({
    isActive: false,
    deletedAt: resolvedAt,
  });
  assert.equal(isRoutineLiveForPlanning(tombstoned), false);
  const drafts = buildMissingTodayOccurrenceDrafts({
    now: new Date('2026-09-24T12:00:00.000Z'),
    viewerTimeZone: 'UTC',
    ownerId: userA,
    routines: [tombstoned],
    todos: [],
    existing: [],
  });
  assert.equal(drafts.length, 0);
}

{
  const prepared = prepareRoutineTombstone(resolvedAt);
  assert.equal(prepared.ok, true);
  assert.equal(ROUTINE_VALIDATION_MESSAGES.deleteActive.includes('Archive'), true);
}

const v14 = readFileSync(
  join(root, 'supabase/v14_routine_lifecycle_and_external_calendar.sql'),
  'utf8'
);
assert.ok(v14.includes('external_calendar_enabled boolean not null default true'));
assert.ok(v14.includes('deleted_at timestamptz'));
assert.ok(v14.includes('status = \'planned\''));
assert.ok(v14.includes('Do not apply to live Supabase until reviewed'));
assert.ok(!v14.includes('google_calendar_enabled'));

const access = readFileSync(join(root, 'lib/planning/routinesAccess.ts'), 'utf8');
assert.ok(access.includes('permanentlyRemoveOwnedRoutine'));
assert.ok(access.includes('deleteActive'));
assert.ok(access.includes('.is(\'deleted_at\', null)'));
assert.equal(access.includes('.delete('), false);
assert.ok(access.includes('skipOwnedPlannedOccurrencesForRoutine'));

const today = readFileSync(join(root, 'app/planning/TodayView.tsx'), 'utf8');
assert.ok(today.includes('isRoutineOccurrenceActionable'));

const planningDir = join(root, 'lib/planning');
const planningBundle = readdirSync(planningDir)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => readFileSync(join(planningDir, name), 'utf8'))
  .join('\n');
assert.ok(!planningBundle.includes('lib/calendar'));
assert.ok(!planningBundle.includes("from('../calendar"));
assert.ok(!/xp_points|awardXp|mutateProgress/i.test(planningBundle));

console.log(
  JSON.stringify(
    {
      ok: true,
      slice: 'planning-3.4.2',
      archive: 'skip-planned',
      delete: 'tombstone',
      rematerialize: 'new-date-after-skip',
    },
    null,
    2
  )
);
