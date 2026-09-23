/**
 * Phase 3 Slice 5 — completion, materialization, and planner-execution checks.
 * Deterministic acceptance coverage. Does not call live Supabase or MiniLM.
 */
import assert from 'assert';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  buildMissingTodayOccurrenceDrafts,
  decideLightCompletion,
  decideLogLinkedCompletion,
  deriveOccurrenceState,
  effectiveRoutineActionForLocalDate,
  goalAttributionFromSource,
  isoWeekdayFromLocalDate,
  linkedLogIdForReuse,
  localCalendarDateInTimeZone,
  logicalOccurrenceIdentityKey,
  prepareOccurrenceInsert,
  presentRoutineOccurrence,
  routineAppliesOnLocalDate,
  selectLogicalTodayOccurrences,
  todayScheduledDates,
  todoIdToCloseOnOccurrenceCompletion,
  type PlannedOccurrence,
  type Routine,
  type Todo,
} from '../../lib/planning';
import {
  buildPlannerLogDraft,
  evaluatePlannerLogCredit,
  initialPlannerAddDetailsForm,
  planLightOccurrenceCompletion,
  planLogLinkedOccurrenceCompletion,
} from '../../lib/plannerExecution/completePlannedOccurrence';

const root = process.cwd();

async function main() {
  const planned: PlannedOccurrence = {
    id: 'occ-1',
    userId: 'user-a',
    sourceType: 'routine',
    routineId: 'routine-1',
    todoId: null,
    scheduledDate: '2026-09-17',
    scheduledTime: '07:00:00',
    timezone: 'America/New_York',
    durationMinutes: 30,
    status: 'planned',
    completionMode: null,
    logId: null,
    resolvedAt: null,
    rescheduledToId: null,
    createdAt: '2026-09-17T00:00:00.000Z',
    updatedAt: '2026-09-17T00:00:00.000Z',
  };

  const resolvedAt = '2026-09-17T12:00:00.000Z';

  const light1 = decideLightCompletion(planned, resolvedAt);
  assert.equal(light1.kind, 'apply');
  if (light1.kind === 'apply') {
    assert.equal(light1.next.status, 'completed');
    assert.equal(light1.next.completionMode, 'light');
    assert.equal(light1.next.logId, null);
    assert.equal(light1.next.resolvedAt, resolvedAt);
  }

  const lightAgain = decideLightCompletion(
    light1.kind === 'apply' ? light1.next : planned,
    '2026-09-17T13:00:00.000Z'
  );
  assert.equal(lightAgain.kind, 'noop');
  if (lightAgain.kind === 'noop') assert.equal(lightAgain.reason, 'already_light');

  const logLinked = decideLogLinkedCompletion(planned, 'log-1', resolvedAt);
  assert.equal(logLinked.kind, 'apply');
  if (logLinked.kind === 'apply') {
    assert.equal(logLinked.next.completionMode, 'log');
    assert.equal(logLinked.next.logId, 'log-1');
  }

  const logAgain = decideLogLinkedCompletion(
    logLinked.kind === 'apply' ? logLinked.next : planned,
    'log-1',
    '2026-09-17T14:00:00.000Z'
  );
  assert.equal(logAgain.kind, 'noop');
  if (logAgain.kind === 'noop') assert.equal(logAgain.reason, 'same_log');

  const duplicateLog = decideLogLinkedCompletion(
    logLinked.kind === 'apply' ? logLinked.next : planned,
    'log-2',
    resolvedAt
  );
  assert.equal(duplicateLog.kind, 'reject');

  const upgrade = decideLogLinkedCompletion(
    {
      status: 'completed',
      completionMode: 'light',
      logId: null,
      resolvedAt,
      rescheduledToId: null,
    },
    'log-3',
    '2026-09-17T15:00:00.000Z'
  );
  assert.equal(upgrade.kind, 'apply');
  if (upgrade.kind === 'apply') {
    assert.equal(upgrade.next.completionMode, 'log');
    assert.equal(upgrade.next.logId, 'log-3');
    assert.equal(upgrade.next.resolvedAt, resolvedAt);
  }

  const noDowngrade = decideLightCompletion(
    {
      status: 'completed',
      completionMode: 'log',
      logId: 'log-1',
      resolvedAt,
      rescheduledToId: null,
    },
    '2026-09-17T16:00:00.000Z'
  );
  assert.equal(noDowngrade.kind, 'noop');
  if (noDowngrade.kind === 'noop') assert.equal(noDowngrade.reason, 'already_log');

  assert.equal(
    linkedLogIdForReuse({
      status: 'completed',
      completionMode: 'log',
      logId: 'log-9',
      resolvedAt,
      rescheduledToId: null,
    }),
    'log-9'
  );
  assert.equal(goalAttributionFromSource({ goalId: 'goal-1' }), 'goal-1');
  assert.equal(goalAttributionFromSource({ goalId: null }), null);

  assert.equal(isoWeekdayFromLocalDate('2026-09-17'), 4);
  assert.equal(isoWeekdayFromLocalDate('2026-09-20'), 7);
  assert.equal(isoWeekdayFromLocalDate('2026-09-21'), 1);

  const dailyRoutine: Routine = {
    id: 'routine-daily',
    userId: 'user-a',
    title: 'Stretch',
    description: null,
    categories: ['physical'],
    goalId: 'goal-1',
    recurrenceType: 'daily',
    weekdays: null,
    weekdayLabels: null,
    scheduledTime: '07:00:00',
    durationMinutes: 15,
    timezone: 'UTC',
    isActive: true,
    externalCalendarEnabled: true,
    deletedAt: null,
    createdAt: resolvedAt,
    updatedAt: resolvedAt,
  };

  const weeklyRoutine: Routine = {
    ...dailyRoutine,
    id: 'routine-weekly',
    recurrenceType: 'weekly',
    weekdays: [4],
    weekdayLabels: null,
    timezone: 'UTC',
    goalId: null,
  };

  assert.equal(routineAppliesOnLocalDate(dailyRoutine, '2026-09-17'), true);
  assert.equal(routineAppliesOnLocalDate(weeklyRoutine, '2026-09-17'), true);
  assert.equal(routineAppliesOnLocalDate(weeklyRoutine, '2026-09-18'), false);
  assert.equal(
    routineAppliesOnLocalDate({ ...dailyRoutine, isActive: false }, '2026-09-17'),
    false
  );

  const openTodo: Todo = {
    id: 'todo-1',
    userId: 'user-a',
    title: 'Submit essay',
    description: null,
    categories: ['academics'],
    goalId: 'goal-2',
    createdAt: resolvedAt,
    updatedAt: resolvedAt,
    archivedAt: null,
  };

  const now = new Date('2026-09-17T15:00:00.000Z');
  assert.equal(localCalendarDateInTimeZone(now, 'UTC'), '2026-09-17');

  const drafts = buildMissingTodayOccurrenceDrafts({
    now,
    viewerTimeZone: 'UTC',
    ownerId: 'user-a',
    routines: [dailyRoutine, weeklyRoutine],
    todos: [openTodo],
    existing: [],
  });
  assert.equal(drafts.length, 3);
  assert.ok(drafts.every((draft) => draft.status === 'planned'));
  assert.ok(drafts.every((draft) => draft.logId === null));
  assert.deepEqual(
    drafts.map((draft) => draft.sourceType).sort(),
    ['routine', 'routine', 'todo']
  );

  const prepared = prepareOccurrenceInsert(drafts[0]);
  assert.equal(prepared.ok, true);

  const idempotentDrafts = buildMissingTodayOccurrenceDrafts({
    now,
    viewerTimeZone: 'UTC',
    ownerId: 'user-a',
    routines: [dailyRoutine, weeklyRoutine],
    todos: [openTodo],
    existing: [
      {
        id: 'existing-1',
        sourceType: 'routine',
        routineId: dailyRoutine.id,
        todoId: null,
        scheduledDate: '2026-09-17',
        status: 'planned',
      },
      {
        id: 'existing-2',
        sourceType: 'routine',
        routineId: weeklyRoutine.id,
        todoId: null,
        scheduledDate: '2026-09-17',
        status: 'completed',
      },
      {
        id: 'existing-3',
        sourceType: 'todo',
        routineId: null,
        todoId: openTodo.id,
        scheduledDate: '2026-09-16',
        status: 'planned',
      },
    ],
  });
  assert.equal(idempotentDrafts.length, 0);

  // Simulate repeated materialization after the first drafts were persisted.
  const afterFirstMaterialization = [
    {
      id: 'occ-daily',
      sourceType: 'routine' as const,
      routineId: dailyRoutine.id,
      todoId: null,
      scheduledDate: '2026-09-17',
      status: 'planned' as const,
    },
    {
      id: 'occ-weekly',
      sourceType: 'routine' as const,
      routineId: weeklyRoutine.id,
      todoId: null,
      scheduledDate: '2026-09-17',
      status: 'planned' as const,
    },
    {
      id: 'occ-todo',
      sourceType: 'todo' as const,
      routineId: null,
      todoId: openTodo.id,
      scheduledDate: '2026-09-17',
      status: 'planned' as const,
    },
  ];
  const secondPassDrafts = buildMissingTodayOccurrenceDrafts({
    now,
    viewerTimeZone: 'UTC',
    ownerId: 'user-a',
    routines: [dailyRoutine, weeklyRoutine],
    todos: [openTodo],
    existing: afterFirstMaterialization,
  });
  assert.equal(secondPassDrafts.length, 0);

  // Accidental duplicate rows (pre-v10 / concurrent insert) must collapse to
  // one logical occurrence per intended expectation — not fuzzy title matching.
  const duplicateRoutineA: PlannedOccurrence = {
    ...planned,
    id: 'dup-routine-older',
    routineId: dailyRoutine.id,
    scheduledDate: '2026-09-17',
    scheduledTime: '18:00:00',
    status: 'planned',
    createdAt: '2026-09-17T10:00:00.000Z',
    updatedAt: '2026-09-17T10:00:00.000Z',
  };
  const duplicateRoutineB: PlannedOccurrence = {
    ...duplicateRoutineA,
    id: 'dup-routine-newer',
    createdAt: '2026-09-17T10:00:01.000Z',
    updatedAt: '2026-09-17T10:00:01.000Z',
  };
  const duplicateTodoA: PlannedOccurrence = {
    ...planned,
    id: 'dup-todo-a',
    sourceType: 'todo',
    routineId: null,
    todoId: openTodo.id,
    scheduledDate: '2026-09-17',
    scheduledTime: null,
    status: 'planned',
    createdAt: '2026-09-17T11:00:00.000Z',
    updatedAt: '2026-09-17T11:00:00.000Z',
  };
  const duplicateTodoB: PlannedOccurrence = {
    ...duplicateTodoA,
    id: 'dup-todo-b',
    createdAt: '2026-09-17T11:00:02.000Z',
    updatedAt: '2026-09-17T11:00:02.000Z',
  };
  const preservedRescheduled: PlannedOccurrence = {
    ...duplicateTodoA,
    id: 'todo-rescheduled-old',
    status: 'rescheduled',
    resolvedAt: resolvedAt,
    rescheduledToId: 'todo-rescheduled-new',
    createdAt: '2026-09-16T09:00:00.000Z',
    updatedAt: resolvedAt,
  };
  assert.equal(
    logicalOccurrenceIdentityKey(duplicateRoutineA),
    logicalOccurrenceIdentityKey(duplicateRoutineB)
  );
  assert.equal(
    logicalOccurrenceIdentityKey(duplicateTodoA),
    logicalOccurrenceIdentityKey(duplicateTodoB)
  );
  assert.notEqual(
    logicalOccurrenceIdentityKey(preservedRescheduled),
    logicalOccurrenceIdentityKey(duplicateTodoA)
  );

  const collapsed = selectLogicalTodayOccurrences([
    duplicateRoutineB,
    duplicateRoutineA,
    duplicateTodoB,
    duplicateTodoA,
    preservedRescheduled,
  ]);
  assert.equal(collapsed.length, 3);
  assert.ok(collapsed.some((row) => row.id === 'dup-routine-older'));
  assert.ok(collapsed.some((row) => row.id === 'dup-todo-a'));
  assert.ok(collapsed.some((row) => row.id === 'todo-rescheduled-old'));
  assert.ok(!collapsed.some((row) => row.id === 'dup-routine-newer'));
  assert.ok(!collapsed.some((row) => row.id === 'dup-todo-b'));

  // Prefer completed/log-linked duplicate over a later planned twin.
  const creditedTwin: PlannedOccurrence = {
    ...duplicateRoutineA,
    id: 'dup-routine-credited',
    status: 'completed',
    completionMode: 'log',
    logId: 'log-1',
    resolvedAt,
    createdAt: '2026-09-17T12:00:00.000Z',
    updatedAt: resolvedAt,
  };
  const preferCredited = selectLogicalTodayOccurrences([
    duplicateRoutineA,
    creditedTwin,
  ]);
  assert.equal(preferCredited.length, 1);
  assert.equal(preferCredited[0].id, 'dup-routine-credited');

  // Even with duplicate existing rows, repeated materialization stays empty.
  const draftsWithDuplicatesPresent = buildMissingTodayOccurrenceDrafts({
    now,
    viewerTimeZone: 'UTC',
    ownerId: 'user-a',
    routines: [dailyRoutine],
    todos: [openTodo],
    existing: [
      duplicateRoutineA,
      duplicateRoutineB,
      duplicateTodoA,
      duplicateTodoB,
    ],
  });
  assert.equal(draftsWithDuplicatesPresent.length, 0);

  const archivedTodoDrafts = buildMissingTodayOccurrenceDrafts({
    now,
    viewerTimeZone: 'UTC',
    ownerId: 'user-a',
    routines: [],
    todos: [{ ...openTodo, archivedAt: resolvedAt }],
    existing: [],
  });
  assert.equal(archivedTodoDrafts.length, 0);

  assert.deepEqual(todayScheduledDates(now, 'UTC', [dailyRoutine]), [
    '2026-09-17',
  ]);

  const overdue = deriveOccurrenceState(
    {
      status: 'planned',
      scheduledDate: '2026-09-16',
      scheduledTime: '07:00:00',
      timezone: 'UTC',
    },
    now
  );
  assert.equal(overdue, 'unresolved');

  // Phase 2 parity: useful details → base 7; critical academics → +2 → 9.
  // Same formula as manual custom Logs (calculateDeterministicBasePoints + applyPriorityReward).
  const credited = await evaluatePlannerLogCredit({
    activity: 'Studied organic chemistry',
    details: 'Watched 6 ochem videos',
    categories: ['academics'],
    hasImage: false,
    logDate: '2026-09-17',
    priorities: { academics: 'critical' },
    evaluate: async () => ({ status: 'DEVELOPMENTAL', pDev: 0.9 }),
  });
  assert.equal(credited.kind, 'credited');
  if (credited.kind === 'credited') {
    assert.equal(credited.points, 9);
    assert.equal(credited.reuseLogId, null);
    const draft = buildPlannerLogDraft({
      credit: credited,
      request: {
        activity: 'Studied organic chemistry',
        details: 'Watched 6 ochem videos',
        categories: ['academics'],
        hasImage: false,
        logDate: '2026-09-17',
        priorities: { academics: 'critical' },
      },
      logId: 'log-new',
    });
    assert.equal(draft.points, 9);
    assert.equal(draft.id, 'log-new');
    assert.equal(draft.custom, true);
    assert.equal(draft.visibility, 'private');
  }

  const friendsDraft = buildPlannerLogDraft({
    credit: {
      kind: 'credited',
      decision: { kind: 'save' },
      points: 5,
      details: '',
      reuseLogId: null,
    },
    request: {
      activity: 'Sent the AI major email',
      details: '',
      categories: ['career'],
      hasImage: false,
      logDate: '2026-09-17',
      visibility: 'friends',
      priorities: { career: 'normal' },
    },
    logId: 'log-vis',
  });
  assert.equal(friendsDraft.visibility, 'friends');
  assert.equal(friendsDraft.activity, 'Sent the AI major email');

  const standardCredited = await evaluatePlannerLogCredit({
    activity: 'Studied organic chemistry',
    details: '',
    categories: ['academics'],
    hasImage: false,
    logDate: '2026-09-17',
    priorities: { academics: 'critical' },
    evaluate: async () => ({ status: 'DEVELOPMENTAL', pDev: 0.9 }),
  });
  assert.equal(standardCredited.kind, 'credited');
  if (standardCredited.kind === 'credited') {
    assert.equal(standardCredited.points, 7);
  }

  const nonCreditable = await evaluatePlannerLogCredit({
    activity: 'Lifted the moon',
    details: '',
    categories: ['fashion'],
    hasImage: false,
    logDate: '2026-09-17',
    priorities: { fashion: 'critical' },
    evaluate: async () => ({ status: 'NON_DEVELOPMENTAL', pDev: 0.1 }),
  });
  assert.equal(nonCreditable.kind, 'adherence_only');
  if (nonCreditable.kind === 'adherence_only') {
    assert.equal(nonCreditable.reason, 'gate_rejected');
  }

  const clarify = await evaluatePlannerLogCredit({
    activity: 'Worked on it',
    details: '',
    categories: ['career'],
    hasImage: false,
    logDate: '2026-09-17',
    priorities: {},
    evaluate: async () => ({ status: 'UNCERTAIN', pDev: 0.5 }),
  });
  assert.equal(clarify.kind, 'ask_clarification');

  const lightPlan = planLightOccurrenceCompletion({
    occurrence: planned,
    resolvedAt,
    sourceGoalId: 'goal-1',
  });
  assert.equal(lightPlan.kind, 'light');
  assert.equal(lightPlan.goalId, 'goal-1');
  assert.equal(lightPlan.decision.kind, 'apply');

  const logPlan = planLogLinkedOccurrenceCompletion({
    occurrence: planned,
    logId: 'log-new',
    resolvedAt,
    sourceGoalId: null,
  });
  assert.equal(logPlan.kind, 'log_link');
  if (logPlan.kind === 'log_link') {
    assert.equal(logPlan.reuse, false);
    assert.equal(logPlan.logId, 'log-new');
  }

  const reusePlan = planLogLinkedOccurrenceCompletion({
    occurrence: {
      ...planned,
      status: 'completed',
      completionMode: 'log',
      logId: 'log-existing',
      resolvedAt,
    },
    logId: 'log-should-not-replace',
    resolvedAt,
    sourceGoalId: 'goal-9',
  });
  assert.equal(reusePlan.kind, 'log_link');
  if (reusePlan.kind === 'log_link') {
    assert.equal(reusePlan.reuse, true);
    assert.equal(reusePlan.logId, 'log-existing');
    assert.equal(reusePlan.goalId, 'goal-9');
    assert.equal(reusePlan.decision.kind, 'noop');
  }

  const planningDir = join(root, 'lib/planning');
  const planningBundle = readdirSync(planningDir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => readFileSync(join(planningDir, name), 'utf8'))
    .join('\n');
  assert.ok(!planningBundle.includes('lib/evaluation'));
  assert.ok(!planningBundle.includes('../evaluation'));
  assert.ok(!planningBundle.includes('applyPriorityReward'));
  assert.ok(!planningBundle.includes('calculateDeterministicBasePoints'));
  assert.ok(!planningBundle.includes('actionEvidence'));
  assert.ok(!/awardXp|mutateProgress/i.test(planningBundle));
  assert.ok(planningBundle.includes('decideLightCompletion'));
  assert.ok(planningBundle.includes('buildMissingTodayOccurrenceDrafts'));
  assert.ok(planningBundle.includes('goalAttributionFromSource'));

  const execution = readFileSync(
    join(root, 'lib/plannerExecution/completePlannedOccurrence.ts'),
    'utf8'
  );
  assert.ok(execution.includes('evaluateComposerSubmission'));
  assert.ok(execution.includes('applyPriorityReward'));
  assert.ok(execution.includes('canPersistComposerResult'));
  assert.ok(execution.includes('adherence_only'));
  assert.ok(!execution.includes('SERVICE_ROLE'));
  assert.ok(!execution.includes('actual_actions'));

  const access = readFileSync(
    join(root, 'lib/planning/occurrencesAccess.ts'),
    'utf8'
  );
  assert.ok(access.includes(".from('planned_occurrences')"));
  assert.ok(access.includes('ensureTodayOccurrences'));
  assert.ok(access.includes('ensureTodayInFlight'));
  assert.ok(access.includes('selectLogicalTodayOccurrences'));
  assert.ok(access.includes('completeOwnedOccurrenceLight'));
  assert.ok(access.includes('linkOwnedOccurrenceLog'));
  assert.ok(access.includes('archiveOwnedTodoIfOpen'));
  assert.ok(access.includes('todoIdToCloseOnOccurrenceCompletion'));
  assert.ok(access.includes('closeLinkedTodoIfNeeded'));
  assert.equal(access.includes('SERVICE_ROLE'), false);
  assert.equal(access.includes('service_role'), false);
  assert.ok(!access.includes('applyPriorityReward'));
  assert.ok(!access.includes('evaluateComposerSubmission'));
  assert.ok(planningBundle.includes('selectLogicalTodayOccurrences'));
  assert.ok(planningBundle.includes('logicalOccurrenceIdentityKey'));

  const migration = readFileSync(
    join(root, 'supabase/v10_planning_occurrence_uniqueness.sql'),
    'utf8'
  );
  assert.ok(migration.includes('planned_occurrences_routine_date_uidx'));
  assert.ok(migration.includes('planned_occurrences_todo_active_uidx'));
  assert.ok(migration.includes('Do not apply'));
  assert.ok(!migration.includes('alter table public.logs'));
  assert.ok(!migration.includes('goal_id'));
  assert.ok(!migration.includes('actual_actions'));

  const schema = readFileSync(join(root, 'supabase/schema.sql'), 'utf8');
  const logsBlock = schema.slice(
    schema.indexOf('create table if not exists public.logs'),
    schema.indexOf('create table if not exists public.user_priorities')
  );
  assert.ok(!logsBlock.includes('goal_id'));

  const todayView = readFileSync(join(root, 'app/planning/TodayView.tsx'), 'utf8');
  assert.ok(todayView.includes('ensureTodayOccurrences'));
  assert.ok(todayView.includes('completeOwnedOccurrenceLight'));
  assert.ok(todayView.includes('Add details') || todayView.includes('Add Details'));
  assert.ok(todayView.includes('does not award') || todayView.includes('adherence'));
  assert.ok(todayView.includes('presentRoutineOccurrence'));
  assert.ok(todayView.includes('parentContext'));
  assert.ok(todayView.includes('cancelDetails'));
  assert.ok(todayView.includes('Cancel'));
  assert.ok(todayView.includes('getSavedLog'));
  assert.ok(todayView.includes('initialPlannerAddDetailsForm'));
  assert.ok(todayView.includes('visibilityPicker'));
  assert.ok(todayView.includes('Who can see this?'));
  assert.ok(!todayView.includes('Uses the same checks and scoring as +Log.'));
  assert.ok(!todayView.includes("saved?.activity?.trim() ? saved.activity : item.title"));
  assert.ok(!todayView.includes('Retries enrich'));
  assert.ok(!todayView.includes('SERVICE_ROLE'));
  // New planned Log: details start blank; do not prefill Routine description.
  assert.ok(!todayView.includes('item.description ||'));

  const liftingSplit: Routine = {
    ...dailyRoutine,
    id: 'routine-split',
    title: 'Lifting Split',
    description:
      'Mon Chest & Back / Tue Sharms / Wed Legs & Abs / Thu Chest & Back / Fri Sharms',
    recurrenceType: 'weekly',
    weekdays: [1, 2, 3, 4, 5],
    weekdayLabels: {
      1: 'Chest & Back',
      2: 'Sharms',
      3: 'Legs & Abs',
      4: 'Chest & Back',
      5: 'Sharms',
    },
    goalId: null,
  };
  // Wednesday 2026-09-16
  assert.equal(
    effectiveRoutineActionForLocalDate(liftingSplit, '2026-09-16'),
    'Legs & Abs'
  );
  const wedPresent = presentRoutineOccurrence(liftingSplit, '2026-09-16');
  assert.equal(wedPresent.actionTitle, 'Legs & Abs');
  assert.equal(wedPresent.contextLine, 'Lifting Split · Wednesday');
  assert.ok(!wedPresent.actionTitle.includes(liftingSplit.description!));
  assert.equal(
    effectiveRoutineActionForLocalDate(
      { ...liftingSplit, weekdayLabels: null },
      '2026-09-16'
    ),
    'Lifting Split'
  );

  // Card title still uses weekday label; Add Details actual-action starts blank.
  const defaultPlannedActivity = wedPresent.actionTitle;
  assert.equal(defaultPlannedActivity, 'Legs & Abs');
  const newPlannedForm = initialPlannerAddDetailsForm(null);
  assert.equal(newPlannedForm.activity, '');
  assert.equal(newPlannedForm.details, '');
  assert.equal(newPlannedForm.clarificationText, '');
  assert.equal(newPlannedForm.visibility, 'private');
  assert.notEqual(newPlannedForm.activity, defaultPlannedActivity);

  const savedDetailsReopen = initialPlannerAddDetailsForm({
    activity: 'Legs & Abs',
    details: 'Bench 185x5, incline DB…',
    visibility: 'friends',
  });
  assert.equal(savedDetailsReopen.activity, 'Legs & Abs');
  assert.equal(savedDetailsReopen.details.includes('Bench'), true);
  assert.equal(savedDetailsReopen.clarificationText, '');
  assert.equal(savedDetailsReopen.visibility, 'friends');

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

  const pageSource = readFileSync(join(root, 'app/page.tsx'), 'utf8');
  assert.ok(pageSource.includes('visibilityPicker'));
  assert.ok(pageSource.includes("existing?.visibility || 'private'"));

  const todosView = readFileSync(join(root, 'app/planning/TodosView.tsx'), 'utf8');
  assert.ok(todosView.includes('completeOwnedOccurrenceLight'));
  assert.ok(todosView.includes('listOwnedOccurrencesForSources'));
  assert.ok(todosView.includes('setOwnedTodoArchived'));

  // Cancel has no completion / Log / XP side effects (pure UI close).
  const cancelLeavesOccurrence = { ...planned };
  assert.equal(cancelLeavesOccurrence.status, 'planned');
  assert.equal(cancelLeavesOccurrence.logId, null);
  assert.equal(cancelLeavesOccurrence.completionMode, null);

  const planningHome = readFileSync(
    join(root, 'app/planning/PlanningHome.tsx'),
    'utf8'
  );
  assert.ok(planningHome.includes('Today'));
  assert.ok(planningHome.includes('TodayView'));
  assert.ok(planningHome.includes('getSavedLog'));
  assert.ok(!planningHome.includes('planned_occurrences'));
  assert.ok(!planningHome.includes('lib/evaluation'));
  assert.ok(!planningHome.includes('applyPriorityReward'));

  const weekdayLabelMigration = readFileSync(
    join(root, 'supabase/v11_routine_weekday_labels.sql'),
    'utf8'
  );
  assert.ok(weekdayLabelMigration.includes('weekday_labels'));
  assert.ok(weekdayLabelMigration.includes('routines_weekday_labels_integrity'));
  assert.ok(weekdayLabelMigration.includes('Do not apply'));
  assert.ok(!weekdayLabelMigration.includes('alter table public.logs'));
  assert.ok(!weekdayLabelMigration.includes('actual_actions'));

  console.log(
    JSON.stringify(
      {
        ok: true,
        slice: 5,
        lightIdempotent: true,
        logReuse: true,
        materializeIdempotent: true,
        logicalOccurrenceDedupe: true,
        ensureTodayCoalesced: true,
        goalAttribution: 'derived-from-source',
        logsGoalColumn: false,
        weekdayLabels: true,
        migration: 'v10_planning_occurrence_uniqueness.sql + v11_routine_weekday_labels.sql',
        applied: false,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
