/**
 * Slice 3.4.1 — Routine schedule → planned occurrence propagation.
 * Pure planning policy. Does not call Google or award XP.
 */
import assert from 'assert';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  ROUTINE_SCHEDULE_PROPAGATION_ERROR,
  isEligibleRoutineSchedulePropagation,
  isMoveDestinationOccurrence,
  occurrenceScheduleMatchesTemplate,
  prepareOccurrenceRoutineScheduleUpdate,
  routineAppliesOnLocalDate,
  routineScheduleTemplateFromRoutine,
  selectOccurrencesForRoutineScheduleSync,
} from '../../lib/planning';
import type { PlannedOccurrence, Routine } from '../../lib/planning/types';

const root = process.cwd();
const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const routineA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const routineB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const occPlanned = '33333333-3333-4333-8333-333333333333';
const occCompleted = '44444444-4444-4444-8444-444444444444';
const occSkipped = '55555555-5555-4555-8555-555555555555';
const occRescheduled = '66666666-6666-4666-8666-666666666666';
const occMoved = '77777777-7777-4777-8777-777777777777';
const occOtherRoutine = '88888888-8888-4888-8888-888888888888';
const occOtherUser = '99999999-9999-4999-8999-999999999999';

function routine(overrides: Partial<Routine> = {}): Routine {
  return {
    id: routineA,
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

function occurrence(
  id: string,
  overrides: Partial<PlannedOccurrence> = {}
): PlannedOccurrence {
  return {
    id,
    userId: userA,
    sourceType: 'routine',
    routineId: routineA,
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

function applyPropagation(
  rows: PlannedOccurrence[],
  nextRoutine: Routine,
  ownerId = userA
): PlannedOccurrence[] {
  const template = routineScheduleTemplateFromRoutine(nextRoutine);
  const selected = new Set(
    selectOccurrencesForRoutineScheduleSync(rows, {
      ownerId,
      routineId: nextRoutine.id,
      template,
    }).map((row) => row.id)
  );
  return rows.map((row) => {
    if (!selected.has(row.id)) return { ...row };
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
      updatedAt: prepared.value.updated_at,
    };
  });
}

{
  const dateOnly = occurrence(occPlanned);
  const next = applyPropagation([dateOnly], routine({ scheduledTime: '15:00:00' }));
  assert.equal(next[0].scheduledTime, '15:00:00');
  assert.equal(next[0].status, 'planned');
  assert.equal(next[0].scheduledDate, '2026-09-23');
}

{
  const timed = occurrence(occPlanned, { scheduledTime: '15:00:00' });
  const next = applyPropagation([timed], routine({ scheduledTime: '16:00:00' }));
  assert.equal(next[0].scheduledTime, '16:00:00');
  assert.equal(next[0].id, occPlanned);
}

{
  const timed = occurrence(occPlanned, { scheduledTime: '15:00:00' });
  const next = applyPropagation([timed], routine({ scheduledTime: null }));
  assert.equal(next[0].scheduledTime, null);
}

{
  const timed = occurrence(occPlanned, {
    scheduledTime: '15:00:00',
    durationMinutes: 30,
  });
  const next = applyPropagation(
    [timed],
    routine({ scheduledTime: '15:00:00', durationMinutes: 60 })
  );
  assert.equal(next[0].durationMinutes, 60);
  assert.equal(next[0].scheduledTime, '15:00:00');
}

{
  const completed = occurrence(occCompleted, {
    status: 'completed',
    completionMode: 'light',
    resolvedAt: '2026-09-23T12:00:00.000Z',
    scheduledTime: null,
  });
  const skipped = occurrence(occSkipped, {
    status: 'skipped',
    resolvedAt: '2026-09-23T12:00:00.000Z',
    scheduledTime: null,
  });
  const source = occurrence(occRescheduled, {
    status: 'rescheduled',
    resolvedAt: '2026-09-23T12:00:00.000Z',
    rescheduledToId: occMoved,
    scheduledTime: null,
  });
  const otherRoutine = occurrence(occOtherRoutine, {
    routineId: routineB,
    scheduledTime: null,
  });
  const otherUser = occurrence(occOtherUser, {
    userId: userB,
    scheduledTime: null,
  });
  const next = applyPropagation(
    [completed, skipped, source, otherRoutine, otherUser],
    routine({ scheduledTime: '15:00:00' })
  );
  assert.equal(next[0].scheduledTime, null);
  assert.equal(next[1].scheduledTime, null);
  assert.equal(next[2].scheduledTime, null);
  assert.equal(next[2].status, 'rescheduled');
  assert.equal(next[3].scheduledTime, null);
  assert.equal(next[4].scheduledTime, null);
  assert.equal(next[4].userId, userB);
}

{
  const moved = occurrence(occMoved, {
    scheduledDate: '2026-09-25',
    scheduledTime: null,
  });
  const source = occurrence(occRescheduled, {
    status: 'rescheduled',
    resolvedAt: '2026-09-23T12:00:00.000Z',
    rescheduledToId: occMoved,
    scheduledTime: '10:00:00',
  });
  assert.equal(isMoveDestinationOccurrence(occMoved, [source, moved]), true);
  const next = applyPropagation(
    [source, moved],
    routine({ scheduledTime: '15:00:00' })
  );
  assert.equal(next[0].scheduledTime, '10:00:00');
  assert.equal(next[1].scheduledTime, '15:00:00');
  assert.equal(next[1].scheduledDate, '2026-09-25');
}

{
  const wednesday = occurrence(occPlanned, {
    scheduledDate: '2026-09-23',
    scheduledTime: null,
  });
  assert.equal(routineAppliesOnLocalDate(routine({ recurrenceType: 'weekly', weekdays: [1, 3] }), '2026-09-23'), true);
  const afterWeekdays = routine({
    recurrenceType: 'weekly',
    weekdays: [1, 5],
    scheduledTime: '15:00:00',
  });
  assert.equal(routineAppliesOnLocalDate(afterWeekdays, '2026-09-23'), false);
  const next = applyPropagation([wednesday], afterWeekdays);
  assert.equal(next[0].status, 'planned');
  assert.equal(next[0].scheduledDate, '2026-09-23');
  assert.equal(next[0].scheduledTime, '15:00:00');
}

{
  const prepared = prepareOccurrenceRoutineScheduleUpdate(
    occurrence(occPlanned),
    { scheduledTime: 'not-a-time', durationMinutes: 30, timezone: 'America/New_York' },
    '2026-09-23T18:00:00.000Z'
  );
  assert.equal(prepared.ok, false);
}

{
  assert.equal(
    isEligibleRoutineSchedulePropagation(occurrence(occPlanned), {
      ownerId: userA,
      routineId: routineA,
    }),
    true
  );
  assert.equal(
    isEligibleRoutineSchedulePropagation(occurrence(occPlanned), {
      ownerId: userB,
      routineId: routineA,
    }),
    false
  );
  const matching = occurrence(occPlanned, { scheduledTime: '15:00:00' });
  assert.equal(
    occurrenceScheduleMatchesTemplate(
      matching,
      routineScheduleTemplateFromRoutine(routine())
    ),
    true
  );
}

const access = readFileSync(join(root, 'lib/planning/occurrencesAccess.ts'), 'utf8');
assert.ok(access.includes('propagateOwnedRoutineScheduleToPlannedOccurrences'));
assert.ok(access.includes(".eq('status', 'planned')"));
assert.ok(!access.includes('lib/calendar'));
assert.ok(!access.includes("from('logs')"));

const routinesAccess = readFileSync(
  join(root, 'lib/planning/routinesAccess.ts'),
  'utf8'
);
assert.ok(routinesAccess.includes('propagateOwnedRoutineScheduleToPlannedOccurrences'));
assert.ok(routinesAccess.includes('ROUTINE_SCHEDULE_PROPAGATION_ERROR'));
assert.ok(routinesAccess.includes('updateOwnedRoutine'));

assert.equal(
  ROUTINE_SCHEDULE_PROPAGATION_ERROR.includes('Try saving again'),
  true
);

const planningDir = join(root, 'lib/planning');
const planningBundle = readdirSync(planningDir)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => readFileSync(join(planningDir, name), 'utf8'))
  .join('\n');
assert.ok(!planningBundle.includes('lib/calendar'));
assert.ok(!planningBundle.includes('requestCalendarReconcileAfterPlanning'));
assert.ok(
  !readFileSync(join(planningDir, 'routineSchedulePropagation.ts'), 'utf8').includes(
    "from('logs')"
  )
);

console.log(
  JSON.stringify(
    {
      ok: true,
      slice: 'planning-3.4.1',
      weekdayDates: 'unchanged',
      moveDestinations: 'time-only',
    },
    null,
    2
  )
);
