/**
 * Static Phase 3 Slice 1 schema/contract checks.
 * Reads checked-in SQL and planning sources. Does not apply migrations.
 */
import assert from 'assert';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const supabaseDir = join(root, 'supabase');
const migrationName = 'v8_planning_contract.sql';
const sql = readFileSync(join(supabaseDir, migrationName), 'utf8');
const compact = sql.replace(/\s+/g, ' ').toLowerCase();

const supabaseFiles = readdirSync(supabaseDir);
const planningMigrations = supabaseFiles.filter((name) => /^v8_/.test(name));
assert.deepEqual(planningMigrations, [migrationName]);
assert.ok(supabaseFiles.includes('v7_inner_wellbeing_category.sql'));
assert.equal(supabaseFiles.filter((name) => /^v9_/.test(name)).length, 0);

const requiredTables = ['goals', 'routines', 'todos', 'planned_occurrences'] as const;
for (const table of requiredTables) {
  assert.ok(
    compact.includes(`create table if not exists public.${table}`),
    `missing table ${table}`
  );
  assert.ok(
    compact.includes(`alter table public.${table} enable row level security`),
    `missing RLS on ${table}`
  );
}

assert.ok(compact.includes("status in ('planned', 'completed', 'skipped', 'rescheduled')"));
assert.ok(compact.includes("status in ('active', 'completed', 'archived')"));
assert.ok(compact.includes("status text not null default 'active'"));
assert.ok(!/status in \([^)]*unresolved/.test(compact));
assert.ok(compact.includes('do not persist unresolved') || compact.includes('derived'));

assert.ok(compact.includes("completion_mode in ('light', 'log')"));
assert.ok(compact.includes("source_type in ('routine', 'todo')"));
assert.ok(!/\bsource in \('routine', 'todo'\)/.test(compact));
assert.ok(compact.includes("recurrence_type in ('daily', 'weekly')"));
assert.ok(!compact.includes('recurrence_frequency'));
assert.ok(compact.includes('cardinality(categories) between 1 and 3'));
assert.ok(compact.includes("'inner'"));
assert.ok(compact.includes('scheduled_date date not null'));
assert.ok(compact.includes('scheduled_time time'));
assert.ok(compact.includes('timezone text not null'));
assert.ok(compact.includes('target_date date'));
assert.ok(compact.includes('archived_at timestamptz'));
assert.ok(compact.includes('is_active boolean not null default true'));
assert.ok((compact.match(/description text/g) || []).length >= 3);
assert.ok((compact.match(/duration_minutes integer/g) || []).length >= 2);
assert.ok(compact.includes('duration_minutes is null or duration_minutes > 0'));
assert.ok(compact.includes('char_length(timezone) between 1 and 64'));

assert.match(
  compact,
  /log_id uuid unique references public\.logs\(id\) on delete set null/
);
assert.ok(compact.includes('on delete set null'));
assert.ok(compact.includes('planned_occurrences_routine_owner_fk'));
assert.ok(compact.includes('planned_occurrences_todo_owner_fk'));
assert.ok(compact.includes('planning goal must belong to the same owner'));
assert.ok(compact.includes('planning log_id must belong to the same owner'));
assert.ok(compact.includes('log-backed completion cannot be reinterpreted'));
assert.ok(compact.includes('log-backed completion requires a log_id'));
assert.ok(compact.includes('remaining completed/log after on delete set null'));

assert.ok(!compact.includes('planned_occurrence_id'));
assert.ok(!compact.includes('alter table public.logs'));
assert.ok(!compact.includes('start_time'));
assert.ok(!compact.includes('google'));
assert.ok(!compact.includes('gcal'));
assert.ok(!compact.includes('calendar_id'));
assert.ok(!compact.includes('event_id'));
assert.ok(!compact.includes('rrule'));
assert.ok(!compact.includes('cron'));
assert.ok(!compact.includes('goal_routines'));
assert.ok(!compact.includes('goal_todos'));
assert.ok(!compact.includes('routine_todos'));
assert.ok(!compact.includes('materializ'));
assert.ok(!compact.includes('priority_level'));
assert.ok(!compact.includes(' visibility'));
assert.ok(!compact.includes('xp_points'));

for (const table of requiredTables) {
  assert.ok(
    compact.includes(`${table}_select_own`),
    `missing owner select policy for ${table}`
  );
  assert.ok(
    new RegExp(
      `create policy "${table}_select_own" on public.${table} for select to authenticated using \\(\\(select auth.uid\\(\\)\\) = user_id\\)`
    ).test(compact),
    `select policy for ${table} is not owner-only`
  );
  assert.ok(
    new RegExp(
      `create policy "${table}_insert_own" on public.${table} for insert to authenticated with check \\(\\(select auth.uid\\(\\)\\) = user_id\\)`
    ).test(compact),
    `insert policy for ${table} is not owner-only`
  );
  assert.ok(
    new RegExp(
      `create policy "${table}_update_own" on public.${table} for update to authenticated using \\(\\(select auth.uid\\(\\)\\) = user_id\\) with check \\(\\(select auth.uid\\(\\)\\) = user_id\\)`
    ).test(compact),
    `update policy for ${table} is not owner-only`
  );
  assert.ok(
    new RegExp(
      `create policy "${table}_delete_own" on public.${table} for delete to authenticated using \\(\\(select auth.uid\\(\\)\\) = user_id\\)`
    ).test(compact),
    `delete policy for ${table} is not owner-only`
  );
}

assert.ok(!compact.includes('friendships'));
assert.ok(!compact.includes("visibility = 'friends'"));

const planningDir = join(root, 'lib/planning');
const planningFiles = readdirSync(planningDir).filter((name) => name.endsWith('.ts'));
assert.ok(planningFiles.includes('index.ts'));
assert.ok(planningFiles.includes('types.ts'));
assert.ok(planningFiles.includes('invariants.ts'));
assert.ok(planningFiles.includes('goals.ts'));
assert.ok(planningFiles.includes('goalsAccess.ts'));
assert.ok(planningFiles.includes('categories.ts'));

const planningSources = planningFiles.map((name) =>
  readFileSync(join(planningDir, name), 'utf8')
);
const planningBundle = planningSources.join('\n');
assert.ok(planningBundle.includes('recurrenceType'));
assert.ok(planningBundle.includes('sourceType'));
assert.ok(planningBundle.includes('targetDate'));
assert.ok(planningBundle.includes('isActive'));
assert.ok(planningBundle.includes('durationMinutes'));
assert.ok(planningBundle.includes('archivedAt'));
assert.ok(planningBundle.includes('isValidOccurrenceWrite'));
assert.ok(planningBundle.includes('isValidLogBackedCompletionEntry'));
assert.ok(planningBundle.includes('isEnteringLogBackedCompletion'));
assert.ok(planningBundle.includes('isValidGoalStatusTransition'));
assert.ok(planningBundle.includes('prepareGoalCreate'));
assert.ok(planningBundle.includes('goalFromRow'));
assert.ok(!planningBundle.includes('recurrenceFrequency'));
assert.ok(!planningBundle.includes('PLANNING_RECURRENCE_FREQUENCIES'));
assert.ok(!planningBundle.includes('lib/evaluation'));
assert.ok(!planningBundle.includes('../evaluation'));
assert.ok(!planningBundle.includes('priorityReward'));
assert.ok(!planningBundle.includes('priorityState'));
assert.ok(!planningBundle.includes('progressCredit'));
assert.ok(!planningBundle.includes('legacyEvaluator'));
assert.ok(!planningBundle.includes('applyPriorityReward'));
assert.ok(!planningBundle.includes('calculateDeterministicBasePoints'));
assert.ok(!planningBundle.includes('actionEvidence'));
assert.ok(!planningBundle.includes('SERVICE_ROLE'));
assert.ok(!planningBundle.includes('service_role'));
assert.ok(!planningBundle.includes('SUPABASE_SERVICE_ROLE_KEY'));

const goalsAccess = readFileSync(join(planningDir, 'goalsAccess.ts'), 'utf8');
assert.ok(goalsAccess.includes(".from('goals')"));
assert.ok(goalsAccess.includes(".eq('user_id', ownerId)"));
assert.equal(goalsAccess.includes('.delete('), false);

console.log(
  JSON.stringify(
    {
      ok: true,
      migration: migrationName,
      tables: requiredTables,
      fieldNames: {
        recurrence: 'recurrence_type',
        source: 'source_type',
      },
      logDelete: 'on delete set null',
      applied: false,
    },
    null,
    2
  )
);
