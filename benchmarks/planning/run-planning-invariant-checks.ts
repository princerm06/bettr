/**
 * Deterministic Phase 3 planning invariants.
 * Does not load MiniLM, award XP, or touch persistence.
 */
import assert from 'assert';
import { CATEGORY_KEYS } from '../../lib/evaluation/priorityState';
import {
  deriveOccurrenceState,
  isEnteringLogBackedCompletion,
  isOccurrenceOverdue,
  isPersistedOccurrenceStatus,
  isPreservedLogBackedCompletion,
  isValidDurationMinutes,
  isValidGoal,
  isValidGoalStatusTransition,
  isValidLogBackedCompletionEntry,
  isValidOccurrenceCombination,
  isValidOccurrenceSource,
  isValidOccurrenceWrite,
  isValidPlannedOccurrence,
  isValidPlanningCategories,
  isValidRoutine,
  isValidRoutineRecurrence,
  isValidTodo,
  reinterpretsLogBackedAsLightweight,
  samePlanningOwner,
} from '../../lib/planning/invariants';
import {
  DERIVED_OCCURRENCE_STATE,
  PERSISTED_OCCURRENCE_STATUSES,
  PLANNING_CATEGORY_KEYS,
  PLANNING_GOAL_STATUSES,
  PLANNING_OCCURRENCE_SOURCES,
  PLANNING_RECURRENCE_TYPES,
  type PlannedOccurrence,
} from '../../lib/planning/types';

assert.deepEqual(PLANNING_CATEGORY_KEYS, CATEGORY_KEYS);
assert.equal(PLANNING_CATEGORY_KEYS.length, 11);
assert.ok(PLANNING_CATEGORY_KEYS.includes('inner'));
assert.deepEqual(PLANNING_GOAL_STATUSES, ['active', 'completed', 'archived']);
assert.deepEqual(PLANNING_RECURRENCE_TYPES, ['daily', 'weekly']);
assert.deepEqual(PLANNING_OCCURRENCE_SOURCES, ['routine', 'todo']);
assert.equal(
  (PERSISTED_OCCURRENCE_STATUSES as readonly string[]).includes('unresolved'),
  false
);
assert.equal(DERIVED_OCCURRENCE_STATE, 'unresolved');
assert.equal(isPersistedOccurrenceStatus('unresolved'), false);
assert.equal(isPersistedOccurrenceStatus('planned'), true);

assert.equal(isValidPlanningCategories(['career']), true);
assert.equal(isValidPlanningCategories(['career', 'academics', 'physical']), true);
assert.equal(isValidPlanningCategories([]), false);
assert.equal(isValidPlanningCategories(['career', 'academics', 'physical', 'mind']), false);
assert.equal(isValidPlanningCategories(['career', 'career']), false);
assert.equal(isValidPlanningCategories(['not-a-category']), false);
assert.equal(isValidPlanningCategories(['Fashion & Style']), false);

assert.equal(isValidRoutineRecurrence('daily', null), true);
assert.equal(isValidRoutineRecurrence('daily', []), false);
assert.equal(isValidRoutineRecurrence('daily', [1]), false);
assert.equal(isValidRoutineRecurrence('weekly', [1, 3, 5]), true);
assert.equal(isValidRoutineRecurrence('weekly', [1, 1]), false);
assert.equal(isValidRoutineRecurrence('weekly', null), false);
assert.equal(isValidRoutineRecurrence('weekly', [0, 1]), false);
assert.equal(isValidRoutineRecurrence('monthly', [1]), false);

assert.equal(isValidDurationMinutes(null), true);
assert.equal(isValidDurationMinutes(30), true);
assert.equal(isValidDurationMinutes(0), false);
assert.equal(isValidDurationMinutes(-5), false);
assert.equal(isValidDurationMinutes(1.5), false);

assert.equal(
  isValidGoal({
    userId: 'user-a',
    title: 'Pass orgo',
    description: null,
    categories: ['academics'],
    targetDate: '2026-12-15',
    status: 'active',
  }),
  true
);
assert.equal(
  isValidGoal({
    userId: 'user-a',
    title: '   ',
    description: null,
    categories: ['academics'],
    targetDate: null,
    status: 'active',
  }),
  false
);
assert.equal(
  isValidGoal({
    userId: 'user-a',
    title: 'Pass orgo',
    description: 'Finish the course',
    categories: ['academics'],
    targetDate: '2026-13-01',
    status: 'active',
  }),
  false
);
assert.equal(
  isValidGoal({
    userId: 'user-a',
    title: 'Pass orgo',
    description: null,
    categories: ['academics'],
    targetDate: null,
    status: 'paused',
  } as never),
  false
);

assert.equal(isValidGoalStatusTransition('active', 'completed'), true);
assert.equal(isValidGoalStatusTransition('active', 'archived'), true);
assert.equal(isValidGoalStatusTransition('active', 'active'), true);
assert.equal(isValidGoalStatusTransition('completed', 'active'), true);
assert.equal(isValidGoalStatusTransition('completed', 'archived'), true);
assert.equal(isValidGoalStatusTransition('archived', 'active'), true);
assert.equal(isValidGoalStatusTransition('archived', 'completed'), false);
assert.equal(isValidGoalStatusTransition('active', 'paused'), false);

assert.equal(
  isValidRoutine({
    userId: 'user-a',
    title: 'Lift',
    description: null,
    categories: ['physical'],
    goalId: 'goal-1',
    recurrenceType: 'weekly',
    weekdays: [1, 3, 5],
    scheduledTime: '07:00',
    durationMinutes: 45,
    timezone: 'America/New_York',
    isActive: true,
  }),
  true
);
assert.equal(
  isValidRoutine({
    userId: 'user-a',
    title: 'Read',
    description: 'Night reading',
    categories: ['mind'],
    goalId: null,
    recurrenceType: 'daily',
    weekdays: null,
    scheduledTime: null,
    durationMinutes: null,
    timezone: 'America/New_York',
    isActive: true,
  }),
  true
);
assert.equal(
  isValidRoutine({
    userId: 'user-a',
    title: 'Read',
    description: null,
    categories: ['mind'],
    goalId: null,
    recurrenceType: 'daily',
    weekdays: [1],
    scheduledTime: null,
    durationMinutes: null,
    timezone: 'America/New_York',
    isActive: true,
  }),
  false
);
assert.equal(
  isValidRoutine({
    userId: 'user-a',
    title: 'Read',
    description: null,
    categories: ['mind'],
    goalId: null,
    recurrenceType: 'daily',
    weekdays: null,
    scheduledTime: null,
    durationMinutes: 0,
    timezone: 'America/New_York',
    isActive: true,
  }),
  false
);
assert.equal(
  isValidRoutine({
    userId: 'user-a',
    title: 'Read',
    description: null,
    categories: ['mind'],
    goalId: null,
    recurrenceType: 'daily',
    weekdays: null,
    scheduledTime: null,
    durationMinutes: null,
    timezone: 'Not/AZone',
    isActive: true,
  }),
  false
);

assert.equal(
  isValidTodo({
    userId: 'user-a',
    title: 'File taxes',
    description: null,
    categories: ['finance'],
    goalId: null,
    archivedAt: null,
  }),
  true
);
assert.equal(
  isValidTodo({
    userId: 'user-a',
    title: 'File taxes',
    description: 'Deadline April',
    categories: ['finance', 'career'],
    goalId: 'goal-1',
    archivedAt: null,
  }),
  true
);
assert.equal(
  isValidTodo({
    userId: 'user-a',
    title: 'File taxes',
    description: null,
    categories: ['finance'],
    goalId: null,
    archivedAt: '2026-09-12T12:00:00.000Z',
  }),
  true
);

assert.equal(
  isValidOccurrenceSource({ sourceType: 'routine', routineId: 'routine-1', todoId: null }),
  true
);
assert.equal(
  isValidOccurrenceSource({ sourceType: 'todo', routineId: null, todoId: 'todo-1' }),
  true
);
assert.equal(
  isValidOccurrenceSource({ sourceType: 'routine', routineId: 'routine-1', todoId: 'todo-1' }),
  false
);
assert.equal(
  isValidOccurrenceSource({ sourceType: 'todo', routineId: 'routine-1', todoId: 'todo-1' }),
  false
);
assert.equal(
  isValidOccurrenceSource({ sourceType: 'routine', routineId: null, todoId: null }),
  false
);

const plannedCombo = {
  status: 'planned' as const,
  completionMode: null,
  logId: null,
  resolvedAt: null,
  rescheduledToId: null,
};
const lightCompleted = {
  status: 'completed' as const,
  completionMode: 'light' as const,
  logId: null,
  resolvedAt: '2026-09-12T12:00:00.000Z',
  rescheduledToId: null,
};
const logCompleted = {
  status: 'completed' as const,
  completionMode: 'log' as const,
  logId: 'log-1',
  resolvedAt: '2026-09-12T12:00:00.000Z',
  rescheduledToId: null,
};
const afterLogDelete = {
  status: 'completed' as const,
  completionMode: 'log' as const,
  logId: null,
  resolvedAt: '2026-09-12T12:00:00.000Z',
  rescheduledToId: null,
};

assert.equal(isValidOccurrenceCombination(plannedCombo), true);
assert.equal(
  isValidOccurrenceCombination({
    ...plannedCombo,
    completionMode: 'light',
  }),
  false
);
assert.equal(isValidOccurrenceCombination(lightCompleted), true);
assert.equal(
  isValidOccurrenceCombination({
    ...lightCompleted,
    logId: 'log-1',
  }),
  false
);
assert.equal(isValidOccurrenceCombination(logCompleted), true);
assert.equal(isValidOccurrenceCombination(afterLogDelete), true);
assert.equal(
  isValidOccurrenceCombination({
    status: 'skipped',
    completionMode: null,
    logId: null,
    resolvedAt: '2026-09-12T12:00:00.000Z',
    rescheduledToId: null,
  }),
  true
);
assert.equal(
  isValidOccurrenceCombination({
    status: 'rescheduled',
    completionMode: null,
    logId: null,
    resolvedAt: '2026-09-12T12:00:00.000Z',
    rescheduledToId: 'occ-2',
  }),
  true
);
assert.equal(
  isValidOccurrenceCombination({
    status: 'rescheduled',
    completionMode: null,
    logId: null,
    resolvedAt: '2026-09-12T12:00:00.000Z',
    rescheduledToId: null,
  }),
  false
);
assert.equal(
  isValidOccurrenceCombination({
    status: 'completed',
    completionMode: null,
    logId: null,
    resolvedAt: '2026-09-12T12:00:00.000Z',
    rescheduledToId: null,
  }),
  false
);

assert.equal(isPreservedLogBackedCompletion(afterLogDelete), true);
assert.equal(isPreservedLogBackedCompletion(logCompleted), false);
assert.equal(isValidLogBackedCompletionEntry(logCompleted), true);
assert.equal(isValidLogBackedCompletionEntry(afterLogDelete), false);
assert.equal(isEnteringLogBackedCompletion(null, afterLogDelete), true);
assert.equal(isEnteringLogBackedCompletion(null, logCompleted), true);
assert.equal(isEnteringLogBackedCompletion(plannedCombo, logCompleted), true);
assert.equal(isEnteringLogBackedCompletion(logCompleted, afterLogDelete), false);

assert.equal(isValidOccurrenceWrite(null, afterLogDelete), false);
assert.equal(isValidOccurrenceWrite(plannedCombo, afterLogDelete), false);
assert.equal(isValidOccurrenceWrite(lightCompleted, afterLogDelete), false);
assert.equal(isValidOccurrenceWrite(null, logCompleted), true);
assert.equal(isValidOccurrenceWrite(plannedCombo, logCompleted), true);
assert.equal(isValidOccurrenceWrite(logCompleted, afterLogDelete), true);
assert.equal(isValidOccurrenceWrite(afterLogDelete, afterLogDelete), true);
assert.equal(
  reinterpretsLogBackedAsLightweight(afterLogDelete, lightCompleted),
  true
);
assert.equal(isValidOccurrenceWrite(afterLogDelete, lightCompleted), false);
assert.equal(isValidOccurrenceCombination(lightCompleted), true);

const plannedOccurrence: PlannedOccurrence = {
  id: 'occ-1',
  userId: 'user-a',
  sourceType: 'todo',
  routineId: null,
  todoId: 'todo-1',
  scheduledDate: '2026-09-12',
  scheduledTime: '18:00',
  timezone: 'America/New_York',
  durationMinutes: 30,
  status: 'planned',
  completionMode: null,
  logId: null,
  resolvedAt: null,
  rescheduledToId: null,
  createdAt: '2026-09-11T12:00:00.000Z',
  updatedAt: '2026-09-11T12:00:00.000Z',
};
assert.equal(isValidPlannedOccurrence(plannedOccurrence), true);
assert.equal(
  isValidPlannedOccurrence({
    ...plannedOccurrence,
    status: 'rescheduled',
    resolvedAt: '2026-09-12T12:00:00.000Z',
    rescheduledToId: 'occ-1',
  }),
  false
);
assert.equal(
  isValidPlannedOccurrence({
    ...plannedOccurrence,
    status: 'completed',
    completionMode: 'log',
    logId: 'log-1',
    resolvedAt: '2026-09-12T12:00:00.000Z',
  }),
  true
);
assert.equal(
  isValidPlannedOccurrence({
    ...plannedOccurrence,
    status: 'completed',
    completionMode: 'log',
    logId: null,
    resolvedAt: '2026-09-12T12:00:00.000Z',
  }),
  true
);
assert.equal(
  isValidPlannedOccurrence({
    ...plannedOccurrence,
    durationMinutes: 0,
  }),
  false
);

const beforeDue = new Date('2026-09-12T21:00:00.000Z'); // 17:00 America/New_York (EDT)
const afterDue = new Date('2026-09-12T22:30:00.000Z'); // 18:30 America/New_York
const nextLocalDay = new Date('2026-09-13T04:00:00.000Z'); // 00:00 America/New_York

assert.equal(isOccurrenceOverdue(plannedOccurrence, beforeDue), false);
assert.equal(deriveOccurrenceState(plannedOccurrence, beforeDue), 'planned');
assert.equal(isOccurrenceOverdue(plannedOccurrence, afterDue), true);
assert.equal(deriveOccurrenceState(plannedOccurrence, afterDue), 'unresolved');

const dateOnly: PlannedOccurrence = {
  ...plannedOccurrence,
  scheduledTime: null,
};
assert.equal(isOccurrenceOverdue(dateOnly, afterDue), false);
assert.equal(deriveOccurrenceState(dateOnly, afterDue), 'planned');
assert.equal(isOccurrenceOverdue(dateOnly, nextLocalDay), true);
assert.equal(deriveOccurrenceState(dateOnly, nextLocalDay), 'unresolved');
assert.equal(
  deriveOccurrenceState({ ...dateOnly, status: 'completed' }, nextLocalDay),
  'completed'
);

assert.equal(samePlanningOwner('user-a', 'user-a'), true);
assert.equal(samePlanningOwner('user-a', 'user-b'), false);
assert.equal(samePlanningOwner('user-a', null), false);

console.log(
  JSON.stringify(
    {
      ok: true,
      persistedStatuses: PERSISTED_OCCURRENCE_STATUSES,
      derivedOnly: DERIVED_OCCURRENCE_STATE,
      categoryCount: PLANNING_CATEGORY_KEYS.length,
      recurrenceTypes: PLANNING_RECURRENCE_TYPES,
      sourceTypes: PLANNING_OCCURRENCE_SOURCES,
    },
    null,
    2
  )
);
