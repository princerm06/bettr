/**
 * Phase 3 Slice 4 To-Do write/mapping checks.
 * Does not load MiniLM, award XP, or touch live persistence.
 */
import assert from 'assert';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  TODO_CREATE_ARCHIVED_AT,
  TODO_DOMAIN_FIELDS,
  TODO_TABLE_COLUMNS,
  TODO_VALIDATION_MESSAGES,
  isTodoOpen,
  mapOwnedTodoRows,
  normalizeTodoCategories,
  prepareTodoArchiveTransition,
  prepareTodoCreate,
  prepareTodoUpdate,
  todoFromRow,
  type TodoInsertRow,
} from '../../lib/planning/todos';
import { PLANNING_CATEGORIES } from '../../lib/planning/categories';
import {
  isValidPlanningTitle,
  isValidTodo,
  samePlanningOwner,
} from '../../lib/planning/invariants';
import {
  PLANNING_CATEGORY_KEYS,
  PLANNING_TITLE_MAX_LENGTH,
} from '../../lib/planning/types';

const root = process.cwd();

assert.equal(isValidPlanningTitle(''), false);
assert.equal(isValidPlanningTitle('   '), false);
assert.equal(isValidPlanningTitle('Submit lab report'), true);
assert.equal(isValidPlanningTitle('x'.repeat(PLANNING_TITLE_MAX_LENGTH)), true);
assert.equal(isValidPlanningTitle('x'.repeat(PLANNING_TITLE_MAX_LENGTH + 1)), false);

const emptyTitle = prepareTodoCreate('user-a', {
  title: '   ',
  categories: ['academics'],
});
assert.equal(emptyTitle.ok, false);
if (!emptyTitle.ok) {
  assert.equal(emptyTitle.error, TODO_VALIDATION_MESSAGES.title);
}

const longTitle = prepareTodoCreate('user-a', {
  title: 'x'.repeat(PLANNING_TITLE_MAX_LENGTH + 1),
  categories: ['academics'],
});
assert.equal(longTitle.ok, false);
if (!longTitle.ok) {
  assert.equal(longTitle.error, TODO_VALIDATION_MESSAGES.titleTooLong);
}

const trimmedTitle = prepareTodoCreate('user-a', {
  title: '  Submit lab report  ',
  categories: ['academics'],
});
assert.equal(trimmedTitle.ok, true);
if (trimmedTitle.ok) {
  assert.equal(trimmedTitle.value.title, 'Submit lab report');
}

assert.equal(normalizeTodoCategories(['career']).ok, true);
assert.equal(normalizeTodoCategories(['career', 'academics', 'physical']).ok, true);
assert.equal(normalizeTodoCategories([]).ok, false);
assert.equal(
  normalizeTodoCategories(['career', 'academics', 'physical', 'mind']).ok,
  false
);
assert.equal(normalizeTodoCategories(['not-a-category']).ok, false);
assert.equal(normalizeTodoCategories(['Fashion & Style']).ok, false);
assert.equal(normalizeTodoCategories(['Academics']).ok, false);

const deduped = normalizeTodoCategories(['career', 'career', 'academics']);
assert.equal(deduped.ok, true);
if (deduped.ok) {
  assert.deepEqual(deduped.value, ['career', 'academics']);
}

const duplicateOnly = normalizeTodoCategories(['inner', 'inner']);
assert.equal(duplicateOnly.ok, true);
if (duplicateOnly.ok) {
  assert.deepEqual(duplicateOnly.value, ['inner']);
}

const tooManyUnique = prepareTodoCreate('user-a', {
  title: 'Split focus',
  categories: ['career', 'academics', 'physical', 'mind'],
});
assert.equal(tooManyUnique.ok, false);
if (!tooManyUnique.ok) {
  assert.equal(tooManyUnique.error, TODO_VALIDATION_MESSAGES.categories);
}

const unknownCategory = prepareTodoCreate('user-a', {
  title: 'Look sharp',
  categories: ['Fashion & Style'],
});
assert.equal(unknownCategory.ok, false);
if (!unknownCategory.ok) {
  assert.equal(unknownCategory.error, TODO_VALIDATION_MESSAGES.categoriesUnknown);
}

assert.deepEqual(
  PLANNING_CATEGORIES.map((item) => item.key),
  [...PLANNING_CATEGORY_KEYS]
);

assert.equal(TODO_CREATE_ARCHIVED_AT, null);

const createdArchived = prepareTodoCreate('user-a', {
  title: 'Submit lab report',
  categories: ['academics'],
  archived_at: '2026-09-14T12:00:00.000Z',
} as never);
assert.equal(createdArchived.ok, true);
if (createdArchived.ok) {
  assert.equal(createdArchived.value.archived_at, null);
}

const ownerIgnored = prepareTodoCreate('session-user', {
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

const missingOwner = prepareTodoCreate('', {
  title: 'No owner',
  categories: ['career'],
});
assert.equal(missingOwner.ok, false);
if (!missingOwner.ok) {
  assert.equal(missingOwner.error, TODO_VALIDATION_MESSAGES.signedIn);
}

const insertRow = prepareTodoCreate('user-a', {
  title: 'Submit lab report',
  description: '  Due Friday.  ',
  categories: ['academics', 'career'],
  goalId: 'goal-1',
});
assert.equal(insertRow.ok, true);
if (insertRow.ok) {
  assert.deepEqual(Object.keys(insertRow.value).sort(), [
    'archived_at',
    'categories',
    'description',
    'goal_id',
    'title',
    'user_id',
  ]);
  assert.equal(insertRow.value.description, 'Due Friday.');
  assert.equal(insertRow.value.goal_id, 'goal-1');
  assert.equal(insertRow.value.archived_at, null);
  assert.ok(!('points' in insertRow.value));
  assert.ok(!('xp' in insertRow.value));
  assert.ok(!('priority' in insertRow.value));
  assert.ok(!('due_date' in insertRow.value));
  assert.ok(!('scheduled_time' in insertRow.value));
  assert.ok(!('timezone' in insertRow.value));
  assert.ok(
    isValidTodo({
      userId: insertRow.value.user_id,
      title: insertRow.value.title,
      description: insertRow.value.description,
      categories: insertRow.value.categories,
      goalId: insertRow.value.goal_id,
      archivedAt: insertRow.value.archived_at,
    })
  );
}

const emptyGoal = prepareTodoCreate('user-a', {
  title: 'Standalone',
  categories: ['mind'],
  goalId: '',
});
assert.equal(emptyGoal.ok, true);
if (emptyGoal.ok) {
  assert.equal(emptyGoal.value.goal_id, null);
}

const badGoal = prepareTodoCreate('user-a', {
  title: 'Bad link',
  categories: ['mind'],
  goalId: 42,
});
assert.equal(badGoal.ok, false);
if (!badGoal.ok) {
  assert.equal(badGoal.error, TODO_VALIDATION_MESSAGES.goal);
}

const updateRow = prepareTodoUpdate('user-a', {
  title: 'Submit lab report',
  categories: ['academics'],
});
assert.equal(updateRow.ok, true);
if (updateRow.ok) {
  assert.deepEqual(Object.keys(updateRow.value).sort(), [
    'categories',
    'description',
    'goal_id',
    'title',
    'updated_at',
  ]);
  assert.ok(!('user_id' in updateRow.value));
  assert.ok(!('archived_at' in updateRow.value));
}

const complete = prepareTodoArchiveTransition(true);
assert.equal(complete.ok, true);
if (complete.ok) {
  assert.ok(typeof complete.value.archived_at === 'string');
  assert.ok(complete.value.archived_at!.length > 0);
  assert.ok(complete.value.updated_at);
}

const reopen = prepareTodoArchiveTransition(false);
assert.equal(reopen.ok, true);
if (reopen.ok) {
  assert.equal(reopen.value.archived_at, null);
}

const badArchive = prepareTodoArchiveTransition('archived');
assert.equal(badArchive.ok, false);
if (!badArchive.ok) {
  assert.equal(badArchive.error, TODO_VALIDATION_MESSAGES.archive);
}

const badArchiveNull = prepareTodoArchiveTransition(null);
assert.equal(badArchiveNull.ok, false);

assert.equal(isTodoOpen({ archivedAt: null }), true);
assert.equal(isTodoOpen({ archivedAt: '2026-09-16T12:00:00.000Z' }), false);
assert.equal(isTodoOpen({ archived_at: null }), true);
assert.equal(isTodoOpen({ archived_at: '2026-09-16T12:00:00.000Z' }), false);

const row = {
  id: 'todo-1',
  user_id: 'user-a',
  title: '  Submit lab report  ',
  description: null,
  categories: ['academics'],
  goal_id: 'goal-1',
  created_at: '2026-09-14T12:00:00.000Z',
  updated_at: '2026-09-14T12:00:00.000Z',
  archived_at: null,
};

const mapped = todoFromRow(row, 'user-a');
assert.ok(mapped);
assert.deepEqual(Object.keys(mapped!).sort(), [...TODO_DOMAIN_FIELDS].sort());
assert.equal(mapped!.userId, 'user-a');
assert.equal(mapped!.title, 'Submit lab report');
assert.equal(mapped!.goalId, 'goal-1');
assert.deepEqual(mapped!.categories, ['academics']);
assert.equal(mapped!.archivedAt, null);
assert.equal(isTodoOpen(mapped!), true);

assert.equal(todoFromRow(row, 'user-b'), null);
assert.equal(
  todoFromRow({ ...row, categories: ['career', 'career'] }, 'user-a'),
  null
);
assert.equal(
  todoFromRow({ ...row, categories: ['Fashion & Style'] }, 'user-a'),
  null
);
assert.equal(
  todoFromRow({ ...row, archived_at: 123 }, 'user-a'),
  null
);

const mixed = mapOwnedTodoRows(
  [row, { ...row, id: 'todo-2', user_id: 'user-b' }, { ...row, id: 'todo-3' }],
  'user-a'
);
assert.deepEqual(
  mixed.map((todo) => todo.id),
  ['todo-1', 'todo-3']
);

assert.deepEqual(TODO_TABLE_COLUMNS, [
  'id',
  'user_id',
  'title',
  'description',
  'categories',
  'goal_id',
  'created_at',
  'updated_at',
  'archived_at',
]);

const sql = readFileSync(join(root, 'supabase/v8_planning_contract.sql'), 'utf8');
for (const column of TODO_TABLE_COLUMNS) {
  assert.ok(sql.includes(column), `schema missing ${column}`);
}
assert.ok(sql.includes('todos_categories_valid'));
assert.ok(sql.includes('planned_occurrences_todo_owner_fk'));
assert.ok(sql.includes('on delete restrict'));
assert.ok(sql.includes('todos_delete_own'));
assert.ok(sql.includes('todos_owner_integrity'));

const insertArchived: TodoInsertRow['archived_at'][] = [null];
assert.ok(insertArchived.includes(TODO_CREATE_ARCHIVED_AT));

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

const todosAccess = readFileSync(join(planningDir, 'todosAccess.ts'), 'utf8');
assert.ok(todosAccess.includes(".from('todos')"));
assert.ok(todosAccess.includes(".eq('user_id', ownerId)"));
assert.ok(todosAccess.includes('prepareTodoCreate'));
assert.ok(todosAccess.includes('setOwnedTodoArchived'));
assert.ok(todosAccess.includes('archiveOwnedTodoIfOpen'));
assert.ok(todosAccess.includes(".is('archived_at', null)"));
assert.ok(todosAccess.includes('ON DELETE RESTRICT'));
assert.equal(todosAccess.includes('.delete('), false);
assert.equal(todosAccess.includes('SERVICE_ROLE'), false);
assert.equal(todosAccess.includes('service_role'), false);
assert.equal(todosAccess.includes('SUPABASE_SERVICE_ROLE_KEY'), false);
assert.ok(!todosAccess.includes(".from('logs')"));
assert.ok(!todosAccess.includes('completion_mode'));
assert.ok(!todosAccess.includes('log_id'));

const uiFiles = [
  'TodosView.tsx',
  'TodoForm.tsx',
  'PlanningHome.tsx',
].map((name) => readFileSync(join(root, 'app/planning', name), 'utf8'));
const uiBundle = uiFiles.join('\n');
assert.ok(!uiBundle.includes('lib/evaluation'));
assert.ok(!uiBundle.includes('applyPriorityReward'));
assert.ok(!uiBundle.includes('progressCredit'));
assert.ok(!uiBundle.includes('actionEvidence'));
assert.ok(!uiBundle.includes('calculateDisciplineScore'));
assert.ok(!uiBundle.includes(".from('logs')"));
assert.ok(
  uiBundle.includes('does not award XP') ||
    uiBundle.includes('do not award XP') ||
    uiBundle.includes('does not award') ||
    uiBundle.includes('planning status')
);
assert.ok(uiBundle.includes("setSection('todos')") || uiBundle.includes("'todos'"));
assert.ok(uiBundle.includes('To-Dos') || uiBundle.includes('To-dos'));

const page = readFileSync(join(root, 'app/page.tsx'), 'utf8');
assert.ok(page.includes('<span>Plan</span>'));
assert.ok(page.includes('/> Plan</button>') || page.includes('/> Plan'));
assert.equal((page.match(/> Goals</g) || []).length, 0);
assert.equal((page.match(/<span>Goals<\/span>/g) || []).length, 0);

const todoForm = readFileSync(join(root, 'app/planning/TodoForm.tsx'), 'utf8');
assert.ok(todoForm.includes('No active goals to link yet'));
assert.ok(todoForm.includes('Notes'));
assert.ok(!todoForm.includes('due date') && !todoForm.includes('Due date'));
assert.ok(!todoForm.includes('timezone'));
assert.ok(!todoForm.includes('scheduledTime'));
assert.ok(!todoForm.includes('type="time"'));
assert.ok(!todoForm.includes('type="date"'));

const todosView = readFileSync(join(root, 'app/planning/TodosView.tsx'), 'utf8');
assert.ok(todosView.includes('Mark done') || todosView.includes('Mark Done'));
assert.ok(todosView.includes('Reopen'));
assert.ok(todosView.includes('completeOwnedOccurrenceLight'));
assert.ok(todosView.includes('listOwnedOccurrencesForSources'));
assert.ok(
  todosView.includes('planning status') ||
    todosView.includes('does not award') ||
    todosView.includes('do not award')
);
assert.ok(!todosView.includes('earned XP') && !todosView.includes('+XP'));

console.log(
  JSON.stringify(
    {
      ok: true,
      slice: 'todos',
      categoryCount: PLANNING_CATEGORY_KEYS.length,
      createArchivedAt: TODO_CREATE_ARCHIVED_AT,
      columns: TODO_TABLE_COLUMNS,
      deletion: 'omitted-restrict',
      dueFields: 'omitted-not-on-todos-table',
      lifecycle: 'archived_at',
    },
    null,
    2
  )
);
