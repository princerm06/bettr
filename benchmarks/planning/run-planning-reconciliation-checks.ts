/**
 * Phase 3 Slice 6 — skip, reschedule, reopen, and uniqueness checks.
 * Deterministic. Does not call live Supabase, MiniLM, or award XP.
 */
import assert from 'assert';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  buildMissingTodayOccurrenceDrafts,
  changeDateTerminalId,
  collapseTodayHistoryRows,
  decideReschedule,
  decideSkip,
  deriveOccurrenceState,
  formatMovedToLabel,
  isOccurrenceOverdue,
  isTodayHistoryOccurrence,
  logicalOccurrenceIdentityKey,
  RECONCILIATION_VALIDATION_MESSAGES,
  replacementForReschedule,
  resolveMoveChain,
  shiftLocalCalendarDate,
  todoIdToCloseOnOccurrenceCompletion,
  type PlannedOccurrence,
  type Routine,
  type Todo,
} from '../../lib/planning';
import { isValidOccurrenceWrite } from '../../lib/planning/invariants';

const root = process.cwd();
const resolvedAt = '2026-09-18T12:00:00.000Z';

const planned: PlannedOccurrence = {
  id: 'occ-1',
  userId: 'user-a',
  sourceType: 'todo',
  routineId: null,
  todoId: 'todo-1',
  scheduledDate: '2026-09-16',
  scheduledTime: null,
  timezone: 'UTC',
  durationMinutes: null,
  status: 'planned',
  completionMode: null,
  logId: null,
  resolvedAt: null,
  rescheduledToId: null,
  createdAt: '2026-09-16T08:00:00.000Z',
  updatedAt: '2026-09-16T08:00:00.000Z',
};

const skipped = decideSkip(planned, resolvedAt);
assert.equal(skipped.kind, 'apply');
if (skipped.kind === 'apply') {
  assert.equal(skipped.next.status, 'skipped');
  assert.equal(skipped.next.logId, null);
  assert.equal(skipped.next.completionMode, null);
  assert.equal(skipped.next.resolvedAt, resolvedAt);
}

const alreadySkipped = decideSkip(
  {
    status: 'skipped',
    completionMode: null,
    logId: null,
    resolvedAt,
    rescheduledToId: null,
  },
  resolvedAt
);
assert.equal(alreadySkipped.kind, 'noop');
if (alreadySkipped.kind === 'noop') {
  assert.equal(alreadySkipped.reason, 'already_skipped');
}

const skipLog = decideSkip(
  {
    status: 'completed',
    completionMode: 'log',
    logId: 'log-1',
    resolvedAt,
    rescheduledToId: null,
  },
  resolvedAt
);
assert.equal(skipLog.kind, 'reject');

assert.equal(
  todoIdToCloseOnOccurrenceCompletion({
    sourceType: 'todo',
    todoId: 'todo-1',
  }),
  'todo-1'
);
assert.equal(
  todoIdToCloseOnOccurrenceCompletion({
    sourceType: 'routine',
    todoId: null,
  }),
  null
);

const routinePlanned: PlannedOccurrence = {
  ...planned,
  id: 'occ-routine',
  sourceType: 'routine',
  routineId: 'routine-1',
  todoId: null,
  scheduledDate: '2026-09-16',
  scheduledTime: '07:00:00',
};

const moved = decideReschedule({
  source: routinePlanned,
  targetDate: '2026-09-18',
  replacementId: 'occ-repl',
  resolvedAt,
  existing: [routinePlanned],
});
assert.equal(moved.kind, 'apply');
if (moved.kind === 'apply') {
  assert.equal(moved.sourceNext.status, 'rescheduled');
  assert.equal(moved.sourceNext.rescheduledToId, 'occ-repl');
  assert.equal(moved.sourceNext.logId, null);
  assert.equal(moved.replacement.status, 'planned');
  assert.equal(moved.replacement.scheduledDate, '2026-09-18');
  assert.equal(moved.replacement.routineId, 'routine-1');
  assert.equal(moved.replacementId, 'occ-repl');
}

const alreadyMoved = decideReschedule({
  source: {
    ...routinePlanned,
    status: 'rescheduled',
    resolvedAt,
    rescheduledToId: 'occ-repl',
  },
  targetDate: '2026-09-19',
  replacementId: 'occ-other',
  resolvedAt,
  existing: [],
});
assert.equal(alreadyMoved.kind, 'noop');
if (alreadyMoved.kind === 'noop') {
  assert.equal(alreadyMoved.replacementId, 'occ-repl');
}

const collide = decideReschedule({
  source: routinePlanned,
  targetDate: '2026-09-18',
  replacementId: 'occ-repl',
  resolvedAt,
  existing: [
    routinePlanned,
    {
      ...routinePlanned,
      id: 'occ-other-day',
      scheduledDate: '2026-09-18',
    },
  ],
});
assert.equal(collide.kind, 'reject');
if (collide.kind === 'reject') {
  assert.equal(collide.error, RECONCILIATION_VALIDATION_MESSAGES.routineCollision);
}

const sameDayRoutine = decideReschedule({
  source: routinePlanned,
  targetDate: '2026-09-16',
  replacementId: 'occ-repl',
  resolvedAt,
  existing: [routinePlanned],
});
assert.equal(sameDayRoutine.kind, 'reject');

const now = new Date('2026-09-17T12:00:00.000Z');
assert.equal(
  isOccurrenceOverdue(
    { scheduledDate: '2026-09-17', scheduledTime: null, timezone: 'UTC' },
    now
  ),
  false
);
assert.equal(
  deriveOccurrenceState(
    {
      status: 'planned',
      scheduledDate: '2026-09-17',
      scheduledTime: null,
      timezone: 'UTC',
    },
    now
  ),
  'planned'
);
assert.equal(
  deriveOccurrenceState(
    {
      status: 'planned',
      scheduledDate: '2026-09-16',
      scheduledTime: null,
      timezone: 'UTC',
    },
    now
  ),
  'unresolved'
);
assert.equal(
  deriveOccurrenceState(
    {
      status: 'planned',
      scheduledDate: '2026-09-17',
      scheduledTime: '07:00:00',
      timezone: 'UTC',
    },
    now
  ),
  'unresolved'
);
assert.equal(
  deriveOccurrenceState(
    {
      status: 'completed',
      scheduledDate: '2026-09-16',
      scheduledTime: null,
      timezone: 'UTC',
    },
    now
  ),
  'completed'
);
assert.equal(
  deriveOccurrenceState(
    {
      status: 'skipped',
      scheduledDate: '2026-09-16',
      scheduledTime: null,
      timezone: 'UTC',
    },
    now
  ),
  'skipped'
);

const lightCompleted = {
  status: 'completed' as const,
  completionMode: 'light' as const,
  logId: null,
  resolvedAt,
  rescheduledToId: null,
};
const plannedCombo = {
  status: 'planned' as const,
  completionMode: null,
  logId: null,
  resolvedAt: null,
  rescheduledToId: null,
};
assert.equal(isValidOccurrenceWrite(lightCompleted, plannedCombo), false);

const openTodo: Todo = {
  id: 'todo-1',
  userId: 'user-a',
  title: 'Send email',
  description: null,
  categories: ['career'],
  goalId: null,
  createdAt: resolvedAt,
  updatedAt: resolvedAt,
  archivedAt: null,
};

const completedTodoOcc: PlannedOccurrence = {
  ...planned,
  status: 'completed',
  completionMode: 'light',
  resolvedAt,
};

const skippedTodoOcc: PlannedOccurrence = {
  ...planned,
  id: 'occ-skipped',
  status: 'skipped',
  resolvedAt,
};

const retryAfterComplete = buildMissingTodayOccurrenceDrafts({
  now,
  viewerTimeZone: 'UTC',
  ownerId: 'user-a',
  routines: [],
  todos: [openTodo],
  existing: [completedTodoOcc],
});
assert.equal(retryAfterComplete.length, 1);
assert.equal(retryAfterComplete[0].todoId, 'todo-1');
assert.equal(retryAfterComplete[0].status, 'planned');

const retryAfterSkip = buildMissingTodayOccurrenceDrafts({
  now,
  viewerTimeZone: 'UTC',
  ownerId: 'user-a',
  routines: [],
  todos: [openTodo],
  existing: [skippedTodoOcc],
});
assert.equal(retryAfterSkip.length, 1);

const twoPlannedBlocked = buildMissingTodayOccurrenceDrafts({
  now,
  viewerTimeZone: 'UTC',
  ownerId: 'user-a',
  routines: [],
  todos: [openTodo],
  existing: [planned],
});
assert.equal(twoPlannedBlocked.length, 0);

assert.notEqual(
  logicalOccurrenceIdentityKey(completedTodoOcc),
  logicalOccurrenceIdentityKey(planned)
);
assert.notEqual(
  logicalOccurrenceIdentityKey(skippedTodoOcc),
  logicalOccurrenceIdentityKey(planned)
);

const dailyRoutine: Routine = {
  id: 'routine-1',
  userId: 'user-a',
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
  createdAt: resolvedAt,
  updatedAt: resolvedAt,
};

const skipSameDateBlocksRoutine = buildMissingTodayOccurrenceDrafts({
  now,
  viewerTimeZone: 'UTC',
  ownerId: 'user-a',
  routines: [{ ...dailyRoutine, isActive: true }],
  todos: [],
  existing: [
    {
      ...routinePlanned,
      scheduledDate: '2026-09-17',
      status: 'skipped',
    },
  ],
});
assert.equal(skipSameDateBlocksRoutine.length, 0);

const todayView = readFileSync(join(root, 'app/planning/TodayView.tsx'), 'utf8');
assert.ok(todayView.includes('What happened?'));
assert.ok(todayView.includes('Catch up'));
assert.ok(todayView.includes('Resolved today'));
assert.ok(todayView.includes('collapseTodayHistoryRows'));
assert.ok(todayView.includes('Change date'));
assert.ok(todayView.includes('resolveMoveChain'));
assert.ok(todayView.includes('changeDateTerminalId'));
assert.ok(todayView.includes('listOwnedOccurrencesByIds'));
assert.ok(todayView.includes('actionableItems'));
assert.ok(todayView.includes('skipOwnedOccurrence'));
assert.ok(todayView.includes('rescheduleOwnedOccurrence'));
assert.ok(todayView.includes('Skipped'));
assert.ok(todayView.includes('Moved'));
assert.ok(!todayView.includes('failed the plan'));
assert.ok(!todayView.includes('streak'));

assert.equal(isTodayHistoryOccurrence('skipped'), true);
assert.equal(isTodayHistoryOccurrence('rescheduled'), true);
assert.equal(isTodayHistoryOccurrence('planned'), false);
assert.equal(isTodayHistoryOccurrence('completed'), false);

const collapsedSkipMove = collapseTodayHistoryRows([
  { title: 'Slice 6 skip test', sourceLabel: 'To-Do', status: 'skipped' },
  { title: 'Slice 6 skip test', sourceLabel: 'To-Do', status: 'rescheduled' },
  { title: 'Slice 6 skip test', sourceLabel: 'To-Do', status: 'planned' },
]);
assert.equal(collapsedSkipMove.length, 1);
assert.deepEqual(collapsedSkipMove[0].labels, ['Skipped', 'Moved']);

assert.equal(collapsedSkipMove[0].changeDateTerminalId, null);

assert.equal(formatMovedToLabel(null), 'Moved');
assert.equal(
  formatMovedToLabel({ scheduledDate: '2026-09-23', scheduledTime: null }),
  'Moved to Sep 23'
);
assert.equal(
  formatMovedToLabel({
    scheduledDate: '2026-09-23',
    scheduledTime: '18:00:00',
  }),
  'Moved to Sep 23 at 6:00 PM'
);
assert.equal(
  formatMovedToLabel({ scheduledDate: 'not-a-date', scheduledTime: null }),
  'Moved'
);

const replacement: PlannedOccurrence = {
  ...planned,
  id: 'occ-replacement',
  scheduledDate: '2026-09-23',
  scheduledTime: null,
  status: 'planned',
};
const movedSource: PlannedOccurrence = {
  ...planned,
  status: 'rescheduled',
  rescheduledToId: 'occ-replacement',
};
assert.equal(
  replacementForReschedule(movedSource, new Map([[replacement.id, replacement]]))
    ?.id,
  'occ-replacement'
);
assert.equal(
  replacementForReschedule(movedSource, new Map()),
  null
);
assert.equal(
  replacementForReschedule(
    { ...planned, status: 'skipped', rescheduledToId: 'occ-replacement' },
    new Map([[replacement.id, replacement]])
  ),
  null
);

const collapsedMovedTo = collapseTodayHistoryRows([
  {
    title: 'Update portfolio project section',
    sourceLabel: 'To-Do',
    status: 'rescheduled',
    movedToLabel: formatMovedToLabel(replacement),
  },
]);
assert.deepEqual(collapsedMovedTo[0].labels, ['Moved to Sep 23']);

const collapsedSkipThenMove = collapseTodayHistoryRows([
  { title: 'Slice 6 skip test', sourceLabel: 'To-Do', status: 'skipped' },
  {
    title: 'Slice 6 skip test',
    sourceLabel: 'To-Do',
    status: 'rescheduled',
    movedToLabel: formatMovedToLabel(replacement),
  },
]);
assert.deepEqual(collapsedSkipThenMove[0].labels, [
  'Skipped',
  'Moved to Sep 23',
]);

const collapsedRoutineMove = collapseTodayHistoryRows([
  {
    title: 'Lift',
    sourceLabel: 'Routine',
    status: 'rescheduled',
    movedToLabel: formatMovedToLabel({
      scheduledDate: '2026-09-23',
      scheduledTime: '18:00:00',
    }),
  },
]);
assert.deepEqual(collapsedRoutineMove[0].labels, [
  'Moved to Sep 23 at 6:00 PM',
]);

const occA: PlannedOccurrence = {
  ...planned,
  id: 'occ-A',
  scheduledDate: '2026-09-21',
};
const moveAtoB = decideReschedule({
  source: occA,
  targetDate: '2026-09-23',
  replacementId: 'occ-B',
  resolvedAt,
  existing: [occA],
});
assert.equal(moveAtoB.kind, 'apply');
const aMoved: PlannedOccurrence = {
  ...occA,
  status: 'rescheduled',
  resolvedAt,
  rescheduledToId: 'occ-B',
};
const occB: PlannedOccurrence = {
  ...occA,
  id: 'occ-B',
  scheduledDate: '2026-09-23',
  status: 'planned',
  rescheduledToId: null,
};
const chainAfterFirst = new Map<string, PlannedOccurrence>([
  [aMoved.id, aMoved],
  [occB.id, occB],
]);
const resolvedFromA = resolveMoveChain(aMoved, chainAfterFirst);
assert.equal(resolvedFromA.ok, true);
if (resolvedFromA.ok) {
  assert.equal(resolvedFromA.terminal.id, 'occ-B');
  assert.equal(resolvedFromA.terminal.status, 'planned');
}
assert.equal(changeDateTerminalId(resolvedFromA), 'occ-B');

const changeDateOnHistory = decideReschedule({
  source: aMoved,
  targetDate: '2026-09-25',
  replacementId: 'occ-C',
  resolvedAt,
  existing: [aMoved, occB],
});
assert.equal(changeDateOnHistory.kind, 'noop');

const moveBtoC = decideReschedule({
  source: occB,
  targetDate: '2026-09-25',
  replacementId: 'occ-C',
  resolvedAt,
  existing: [aMoved, occB],
});
assert.equal(moveBtoC.kind, 'apply');
const bMoved: PlannedOccurrence = {
  ...occB,
  status: 'rescheduled',
  resolvedAt,
  rescheduledToId: 'occ-C',
};
const occC: PlannedOccurrence = {
  ...occB,
  id: 'occ-C',
  scheduledDate: '2026-09-25',
  status: 'planned',
  rescheduledToId: null,
};
assert.equal(aMoved.status, 'rescheduled');
assert.equal(aMoved.rescheduledToId, 'occ-B');
assert.equal(bMoved.status, 'rescheduled');
assert.equal(bMoved.rescheduledToId, 'occ-C');
const chainAfterSecond = new Map<string, PlannedOccurrence>([
  [aMoved.id, aMoved],
  [bMoved.id, bMoved],
  [occC.id, occC],
]);
const plannedInChain = [...chainAfterSecond.values()].filter(
  (row) => row.status === 'planned'
);
assert.equal(plannedInChain.length, 1);
assert.equal(plannedInChain[0].id, 'occ-C');
const resolvedAfterSecond = resolveMoveChain(aMoved, chainAfterSecond);
assert.equal(resolvedAfterSecond.ok, true);
if (resolvedAfterSecond.ok) {
  assert.equal(resolvedAfterSecond.terminal.id, 'occ-C');
}
assert.equal(
  formatMovedToLabel(
    resolvedAfterSecond.ok ? resolvedAfterSecond.terminal : null
  ),
  'Moved to Sep 25'
);
const skipThenMovedPresentation = collapseTodayHistoryRows([
  { title: 'Slice 6 skip test', sourceLabel: 'To-Do', status: 'skipped' },
  {
    title: 'Slice 6 skip test',
    sourceLabel: 'To-Do',
    status: 'rescheduled',
    movedToLabel: formatMovedToLabel(
      resolvedAfterSecond.ok ? resolvedAfterSecond.terminal : null
    ),
    changeDateTerminalId: changeDateTerminalId(resolvedAfterSecond),
  },
]);
assert.deepEqual(skipThenMovedPresentation[0].labels, [
  'Skipped',
  'Moved to Sep 25',
]);
assert.equal(skipThenMovedPresentation[0].changeDateTerminalId, 'occ-C');

const moveCtoToday = decideReschedule({
  source: occC,
  targetDate: '2026-09-21',
  replacementId: 'occ-D',
  resolvedAt,
  existing: [aMoved, bMoved, occC],
});
assert.equal(moveCtoToday.kind, 'apply');
if (moveCtoToday.kind === 'apply') {
  assert.equal(moveCtoToday.replacement.scheduledDate, '2026-09-21');
  assert.equal(moveCtoToday.replacement.status, 'planned');
  assert.equal(isTodayHistoryOccurrence(moveCtoToday.replacement.status), false);
}
assert.equal(isTodayHistoryOccurrence(aMoved.status), true);
assert.equal(isTodayHistoryOccurrence(bMoved.status), true);

const completedTerminal: PlannedOccurrence = {
  ...occC,
  status: 'completed',
  completionMode: 'light',
  resolvedAt,
};
const skippedTerminal: PlannedOccurrence = {
  ...occC,
  status: 'skipped',
  resolvedAt,
};
assert.equal(
  changeDateTerminalId(
    resolveMoveChain(
      aMoved,
      new Map([
        [aMoved.id, aMoved],
        [bMoved.id, bMoved],
        [completedTerminal.id, completedTerminal],
      ])
    )
  ),
  null
);
assert.equal(
  changeDateTerminalId(
    resolveMoveChain(
      aMoved,
      new Map([
        [aMoved.id, aMoved],
        [bMoved.id, bMoved],
        [skippedTerminal.id, skippedTerminal],
      ])
    )
  ),
  null
);
assert.equal(
  resolveMoveChain(aMoved, new Map([[aMoved.id, aMoved]])).ok,
  false
);
const cyclicA: PlannedOccurrence = {
  ...aMoved,
  id: 'cyc-A',
  rescheduledToId: 'cyc-B',
};
const cyclicB: PlannedOccurrence = {
  ...bMoved,
  id: 'cyc-B',
  rescheduledToId: 'cyc-A',
};
const cyclic = resolveMoveChain(
  cyclicA,
  new Map([
    [cyclicA.id, cyclicA],
    [cyclicB.id, cyclicB],
  ])
);
assert.equal(cyclic.ok, false);
if (!cyclic.ok) {
  assert.equal(cyclic.reason, 'cycle');
}
assert.equal(changeDateTerminalId(cyclic), null);
assert.equal(formatMovedToLabel(cyclic.ok ? cyclic.terminal : null), 'Moved');

const todosView = readFileSync(join(root, 'app/planning/TodosView.tsx'), 'utf8');
assert.ok(todosView.includes('reopenOwnedTodoForAnotherAttempt'));
assert.ok(todosView.includes('another attempt'));

const access = readFileSync(
  join(root, 'lib/planning/occurrencesAccess.ts'),
  'utf8'
);
assert.ok(access.includes('listOwnedOccurrencesByIds'));
assert.ok(access.includes('skipOwnedOccurrence'));
assert.ok(access.includes('rescheduleOwnedOccurrence'));
assert.ok(access.includes('reopenOwnedTodoForAnotherAttempt'));
assert.ok(access.includes('planning_reschedule_occurrence'));
assert.ok(access.includes("row.status === 'planned'"));
assert.ok(!access.includes('applyPriorityReward'));
assert.ok(!access.includes('evaluateComposerSubmission'));

const v12 = readFileSync(
  join(root, 'supabase/v12_todo_occurrence_planned_uidx.sql'),
  'utf8'
);
assert.ok(v12.includes('planned_occurrences_todo_planned_uidx'));
assert.ok(v12.includes("status = 'planned'"));
assert.ok(v12.includes('drop index if exists public.planned_occurrences_todo_active_uidx'));
assert.ok(v12.includes('planning_reschedule_occurrence'));
assert.ok(v12.includes('deferrable initially deferred'));
assert.ok(v12.includes('Do not apply'));
assert.ok(!v12.includes('alter table public.logs'));
assert.ok(!v12.includes('skip_reason'));
assert.ok(!v12.includes('actual_actions'));
assert.ok(!v10TouchesV12());

function v10TouchesV12() {
  const v10 = readFileSync(
    join(root, 'supabase/v10_planning_occurrence_uniqueness.sql'),
    'utf8'
  );
  return v10.includes('todo_planned_uidx');
}

assert.equal(shiftLocalCalendarDate('2026-09-17', 1), '2026-09-18');

const planningDir = join(root, 'lib/planning');
const planningBundle = readdirSync(planningDir)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => readFileSync(join(planningDir, name), 'utf8'))
  .join('\n');
assert.ok(!planningBundle.includes('lib/evaluation'));
assert.ok(!planningBundle.includes('../evaluation'));
assert.ok(!planningBundle.includes('applyPriorityReward'));
assert.ok(!planningBundle.includes('calculateDisciplineScore'));
assert.ok(!planningBundle.includes('calculateDeterministicBasePoints'));
assert.ok(planningBundle.includes('decideSkip'));
assert.ok(planningBundle.includes('decideReschedule'));

console.log(
  JSON.stringify(
    {
      ok: true,
      slice: 6,
      skipIdempotent: true,
      rescheduleIdempotent: true,
      reopenPreservesHistory: true,
      migration: 'v12_todo_occurrence_planned_uidx.sql',
      applied: false,
    },
    null,
    2
  )
);
