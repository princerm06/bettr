/**
 * Phase 3 Slice 2 Goal write/mapping checks.
 * Does not load MiniLM, award XP, or touch persistence.
 */
import assert from 'assert';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  GOAL_CREATE_STATUS,
  GOAL_DOMAIN_FIELDS,
  GOAL_TABLE_COLUMNS,
  GOAL_VALIDATION_MESSAGES,
  goalFromRow,
  mapOwnedGoalRows,
  normalizeGoalCategories,
  prepareGoalCreate,
  prepareGoalStatusTransition,
  prepareGoalUpdate,
  type GoalInsertRow,
} from '../../lib/planning/goals';
import { PLANNING_CATEGORIES } from '../../lib/planning/categories';
import {
  isValidGoal,
  isValidGoalStatusTransition,
  isValidPlanningTitle,
  samePlanningOwner,
} from '../../lib/planning/invariants';
import {
  GOAL_STATUS_TRANSITIONS,
  PLANNING_CATEGORY_KEYS,
  PLANNING_GOAL_STATUSES,
  PLANNING_TITLE_MAX_LENGTH,
} from '../../lib/planning/types';

const root = process.cwd();

assert.equal(isValidPlanningTitle(''), false);
assert.equal(isValidPlanningTitle('   '), false);
assert.equal(isValidPlanningTitle('Pass orgo'), true);
assert.equal(isValidPlanningTitle('x'.repeat(PLANNING_TITLE_MAX_LENGTH)), true);
assert.equal(isValidPlanningTitle('x'.repeat(PLANNING_TITLE_MAX_LENGTH + 1)), false);

const emptyTitle = prepareGoalCreate('user-a', {
  title: '   ',
  categories: ['academics'],
});
assert.equal(emptyTitle.ok, false);
if (!emptyTitle.ok) {
  assert.equal(emptyTitle.error, GOAL_VALIDATION_MESSAGES.title);
}

const longTitle = prepareGoalCreate('user-a', {
  title: 'x'.repeat(PLANNING_TITLE_MAX_LENGTH + 1),
  categories: ['academics'],
});
assert.equal(longTitle.ok, false);
if (!longTitle.ok) {
  assert.equal(longTitle.error, GOAL_VALIDATION_MESSAGES.titleTooLong);
}

const trimmedTitle = prepareGoalCreate('user-a', {
  title: '  Pass orgo  ',
  categories: ['academics'],
});
assert.equal(trimmedTitle.ok, true);
if (trimmedTitle.ok) {
  assert.equal(trimmedTitle.value.title, 'Pass orgo');
}

assert.equal(normalizeGoalCategories(['career']).ok, true);
assert.equal(normalizeGoalCategories(['career', 'academics', 'physical']).ok, true);
assert.equal(normalizeGoalCategories([]).ok, false);
assert.equal(normalizeGoalCategories(['career', 'academics', 'physical', 'mind']).ok, false);
assert.equal(normalizeGoalCategories(['not-a-category']).ok, false);
assert.equal(normalizeGoalCategories(['Fashion & Style']).ok, false);
assert.equal(normalizeGoalCategories(['Academics']).ok, false);

const deduped = normalizeGoalCategories(['career', 'career', 'academics']);
assert.equal(deduped.ok, true);
if (deduped.ok) {
  assert.deepEqual(deduped.value, ['career', 'academics']);
}

const duplicateOnly = normalizeGoalCategories(['inner', 'inner']);
assert.equal(duplicateOnly.ok, true);
if (duplicateOnly.ok) {
  assert.deepEqual(duplicateOnly.value, ['inner']);
}

const tooManyUnique = prepareGoalCreate('user-a', {
  title: 'Split focus',
  categories: ['career', 'academics', 'physical', 'mind'],
});
assert.equal(tooManyUnique.ok, false);
if (!tooManyUnique.ok) {
  assert.equal(tooManyUnique.error, GOAL_VALIDATION_MESSAGES.categories);
}

const unknownCategory = prepareGoalCreate('user-a', {
  title: 'Look sharp',
  categories: ['Fashion & Style'],
});
assert.equal(unknownCategory.ok, false);
if (!unknownCategory.ok) {
  assert.equal(unknownCategory.error, GOAL_VALIDATION_MESSAGES.categoriesUnknown);
}

assert.deepEqual(
  PLANNING_CATEGORIES.map((item) => item.key),
  [...PLANNING_CATEGORY_KEYS]
);
assert.equal(PLANNING_CATEGORIES.length, 11);
assert.equal(
  PLANNING_CATEGORIES.find((item) => item.key === 'fashion')?.label,
  'Fashion & Style'
);
assert.equal(
  PLANNING_CATEGORIES.find((item) => item.key === 'inner')?.label,
  'Inner Wellbeing'
);

assert.deepEqual(PLANNING_GOAL_STATUSES, ['active', 'completed', 'archived']);
assert.equal(GOAL_CREATE_STATUS, 'active');
const insertStatuses: GoalInsertRow['status'][] = [
  'active',
  'completed',
  'archived',
];
assert.deepEqual(insertStatuses, [...PLANNING_GOAL_STATUSES]);
assert.deepEqual(GOAL_STATUS_TRANSITIONS.active, ['completed', 'archived']);
assert.deepEqual(GOAL_STATUS_TRANSITIONS.completed, ['active', 'archived']);
assert.deepEqual(GOAL_STATUS_TRANSITIONS.archived, ['active']);

assert.equal(isValidGoalStatusTransition('active', 'completed'), true);
assert.equal(isValidGoalStatusTransition('archived', 'completed'), false);

const createdCompleted = prepareGoalCreate('user-a', {
  title: 'Pass orgo',
  categories: ['academics'],
  status: 'completed',
} as never);
assert.equal(createdCompleted.ok, true);
if (createdCompleted.ok) {
  assert.equal(createdCompleted.value.status, 'active');
}

const validTransition = prepareGoalStatusTransition('active', 'archived');
assert.equal(validTransition.ok, true);
if (validTransition.ok) {
  assert.equal(validTransition.value.status, 'archived');
  assert.ok(validTransition.value.updated_at);
}

const invalidTransition = prepareGoalStatusTransition('archived', 'completed');
assert.equal(invalidTransition.ok, false);
if (!invalidTransition.ok) {
  assert.equal(invalidTransition.error, GOAL_VALIDATION_MESSAGES.transition);
}

const unknownStatus = prepareGoalStatusTransition('active', 'paused');
assert.equal(unknownStatus.ok, false);
if (!unknownStatus.ok) {
  assert.equal(unknownStatus.error, GOAL_VALIDATION_MESSAGES.status);
}

const ownerIgnored = prepareGoalCreate('session-user', {
  title: 'Keep ownership',
  categories: ['career'],
  userId: 'attacker',
  user_id: 'attacker',
} as never);
assert.equal(ownerIgnored.ok, true);
if (ownerIgnored.ok) {
  assert.equal(ownerIgnored.value.user_id, 'session-user');
  assert.equal(
    samePlanningOwner('session-user', ownerIgnored.value.user_id),
    true
  );
}

const missingOwner = prepareGoalCreate('', {
  title: 'No owner',
  categories: ['career'],
});
assert.equal(missingOwner.ok, false);
if (!missingOwner.ok) {
  assert.equal(missingOwner.error, GOAL_VALIDATION_MESSAGES.signedIn);
}

const insertRow = prepareGoalCreate('user-a', {
  title: 'Pass orgo',
  description: '  Finish the course.  ',
  categories: ['academics', 'career'],
  targetDate: '2026-12-15',
});
assert.equal(insertRow.ok, true);
if (insertRow.ok) {
  assert.deepEqual(Object.keys(insertRow.value).sort(), [
    'categories',
    'description',
    'status',
    'target_date',
    'title',
    'user_id',
  ]);
  assert.equal(insertRow.value.description, 'Finish the course.');
  assert.equal(insertRow.value.target_date, '2026-12-15');
  assert.ok(!('points' in insertRow.value));
  assert.ok(!('xp' in insertRow.value));
  assert.ok(!('priority' in insertRow.value));
  assert.ok(
    isValidGoal({
      userId: insertRow.value.user_id,
      title: insertRow.value.title,
      description: insertRow.value.description,
      categories: insertRow.value.categories,
      targetDate: insertRow.value.target_date,
      status: insertRow.value.status,
    })
  );
}

const badDate = prepareGoalCreate('user-a', {
  title: 'Pass orgo',
  categories: ['academics'],
  targetDate: '2026-13-01',
});
assert.equal(badDate.ok, false);

const updateRow = prepareGoalUpdate('user-a', {
  title: 'Pass orgo',
  categories: ['academics'],
});
assert.equal(updateRow.ok, true);
if (updateRow.ok) {
  assert.deepEqual(Object.keys(updateRow.value).sort(), [
    'categories',
    'description',
    'target_date',
    'title',
    'updated_at',
  ]);
  assert.ok(!('user_id' in updateRow.value));
  assert.ok(!('status' in updateRow.value));
}

const row = {
  id: 'goal-1',
  user_id: 'user-a',
  title: '  Pass orgo  ',
  description: null,
  categories: ['academics'],
  target_date: '2026-12-15',
  status: 'active',
  created_at: '2026-09-14T12:00:00.000Z',
  updated_at: '2026-09-14T12:00:00.000Z',
};

const mapped = goalFromRow(row, 'user-a');
assert.ok(mapped);
assert.deepEqual(Object.keys(mapped!).sort(), [...GOAL_DOMAIN_FIELDS].sort());
assert.equal(mapped!.userId, 'user-a');
assert.equal(mapped!.title, 'Pass orgo');
assert.equal(mapped!.targetDate, '2026-12-15');
assert.deepEqual(mapped!.categories, ['academics']);
assert.equal(mapped!.status, 'active');

assert.equal(goalFromRow(row, 'user-b'), null);
assert.equal(
  goalFromRow({ ...row, status: 'paused' }, 'user-a'),
  null
);
assert.equal(
  goalFromRow({ ...row, categories: ['career', 'career'] }, 'user-a'),
  null
);
assert.equal(
  goalFromRow({ ...row, categories: ['Fashion & Style'] }, 'user-a'),
  null
);

const mixed = mapOwnedGoalRows(
  [row, { ...row, id: 'goal-2', user_id: 'user-b' }, { ...row, id: 'goal-3' }],
  'user-a'
);
assert.deepEqual(
  mixed.map((goal) => goal.id),
  ['goal-1', 'goal-3']
);

assert.deepEqual(GOAL_TABLE_COLUMNS, [
  'id',
  'user_id',
  'title',
  'description',
  'categories',
  'target_date',
  'status',
  'created_at',
  'updated_at',
]);

const sql = readFileSync(join(root, 'supabase/v8_planning_contract.sql'), 'utf8');
for (const column of GOAL_TABLE_COLUMNS) {
  assert.ok(sql.includes(column), `schema missing ${column}`);
}

const planningDir = join(root, 'lib/planning');
const planningBundle = readdirSync(planningDir)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => readFileSync(join(planningDir, name), 'utf8'))
  .join('\n');

assert.ok(!planningBundle.includes('lib/evaluation'));
assert.ok(!planningBundle.includes('../evaluation'));
assert.ok(!planningBundle.includes('priorityReward'));
assert.ok(!planningBundle.includes('progressCredit'));
assert.ok(!planningBundle.includes('actionEvidence'));
assert.ok(!planningBundle.includes('applyPriorityReward'));
assert.ok(!planningBundle.includes('calculateDeterministicBasePoints'));
assert.ok(!planningBundle.includes('calculateDisciplineScore'));
assert.ok(!planningBundle.includes('countCreditedActiveDays'));
assert.ok(!/xp_points|awardXp|mutateProgress/i.test(planningBundle));

const goalsAccess = readFileSync(join(planningDir, 'goalsAccess.ts'), 'utf8');
assert.ok(goalsAccess.includes(".eq('user_id', ownerId)"));
assert.ok(goalsAccess.includes('prepareGoalCreate'));
assert.ok(goalsAccess.includes('transitionOwnedGoalStatus'));
assert.equal(goalsAccess.includes('.delete('), false);
assert.equal(goalsAccess.includes('SERVICE_ROLE'), false);
assert.equal(goalsAccess.includes('service_role'), false);
assert.equal(goalsAccess.includes('SUPABASE_SERVICE_ROLE_KEY'), false);

const uiFiles = ['GoalsView.tsx', 'GoalForm.tsx'].map((name) =>
  readFileSync(join(root, 'app/planning', name), 'utf8')
);
const uiBundle = uiFiles.join('\n');
assert.ok(!uiBundle.includes('lib/evaluation'));
assert.ok(!uiBundle.includes('applyPriorityReward'));
assert.ok(!uiBundle.includes('progressCredit'));
assert.ok(!uiBundle.includes('actionEvidence'));
assert.ok(uiBundle.includes('does not award XP') || uiBundle.includes('do not award progress'));

console.log(
  JSON.stringify(
    {
      ok: true,
      slice: 'goals',
      categoryCount: PLANNING_CATEGORY_KEYS.length,
      statuses: PLANNING_GOAL_STATUSES,
      createStatus: GOAL_CREATE_STATUS,
      columns: GOAL_TABLE_COLUMNS,
    },
    null,
    2
  )
);
