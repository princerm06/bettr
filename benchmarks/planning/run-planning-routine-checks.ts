/**
 * Phase 3 Slice 3 Routine write/mapping checks.
 * Does not load MiniLM, award XP, or touch live persistence.
 */
import assert from 'assert';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  ROUTINE_CREATE_IS_ACTIVE,
  ROUTINE_CREATE_EXTERNAL_CALENDAR_ENABLED,
  ROUTINE_DOMAIN_FIELDS,
  ROUTINE_TABLE_COLUMNS,
  ROUTINE_VALIDATION_MESSAGES,
  detectBrowserTimeZone,
  effectiveRoutineActionForLocalDate,
  filterTimeZoneOptions,
  formatRoutineRecurrence,
  formatTimeZoneLabel,
  listIanaTimeZoneOptions,
  composeLocalScheduledTimeFromPickerParts,
  localScheduledTimeToPickerParts,
  mapOwnedRoutineRows,
  normalizeRoutineCategories,
  normalizeRoutineWeekdayLabels,
  normalizeRoutineWeekdays,
  prepareRoutineActiveTransition,
  prepareRoutineCreate,
  prepareRoutineTombstone,
  prepareRoutineUpdate,
  presentRoutineOccurrence,
  routineFromRow,
  timeZoneShortAbbreviations,
  type RoutineInsertRow,
} from '../../lib/planning/routines';
import { PLANNING_CATEGORIES } from '../../lib/planning/categories';
import {
  isIanaTimeZone,
  isValidPlanningTitle,
  isValidRoutine,
  isValidRoutineRecurrence,
  isValidRoutineWeekdayLabels,
  samePlanningOwner,
} from '../../lib/planning/invariants';
import {
  PLANNING_CATEGORY_KEYS,
  PLANNING_RECURRENCE_TYPES,
  PLANNING_TITLE_MAX_LENGTH,
} from '../../lib/planning/types';

const root = process.cwd();

assert.equal(isValidPlanningTitle(''), false);
assert.equal(isValidPlanningTitle('   '), false);
assert.equal(isValidPlanningTitle('Morning lift'), true);
assert.equal(isValidPlanningTitle('x'.repeat(PLANNING_TITLE_MAX_LENGTH)), true);
assert.equal(isValidPlanningTitle('x'.repeat(PLANNING_TITLE_MAX_LENGTH + 1)), false);

const emptyTitle = prepareRoutineCreate('user-a', {
  title: '   ',
  categories: ['physical'],
  recurrenceType: 'daily',
  weekdays: null,
  timezone: 'America/New_York',
});
assert.equal(emptyTitle.ok, false);
if (!emptyTitle.ok) {
  assert.equal(emptyTitle.error, ROUTINE_VALIDATION_MESSAGES.title);
}

const longTitle = prepareRoutineCreate('user-a', {
  title: 'x'.repeat(PLANNING_TITLE_MAX_LENGTH + 1),
  categories: ['physical'],
  recurrenceType: 'daily',
  weekdays: null,
  timezone: 'America/New_York',
});
assert.equal(longTitle.ok, false);
if (!longTitle.ok) {
  assert.equal(longTitle.error, ROUTINE_VALIDATION_MESSAGES.titleTooLong);
}

const trimmedTitle = prepareRoutineCreate('user-a', {
  title: '  Morning lift  ',
  categories: ['physical'],
  recurrenceType: 'daily',
  weekdays: null,
  timezone: 'America/New_York',
});
assert.equal(trimmedTitle.ok, true);
if (trimmedTitle.ok) {
  assert.equal(trimmedTitle.value.title, 'Morning lift');
  assert.equal(
    trimmedTitle.value.external_calendar_enabled,
    ROUTINE_CREATE_EXTERNAL_CALENDAR_ENABLED
  );
}

const calendarOff = prepareRoutineCreate('user-a', {
  title: 'Private lift',
  categories: ['physical'],
  recurrenceType: 'daily',
  weekdays: null,
  timezone: 'America/New_York',
  externalCalendarEnabled: false,
});
assert.equal(calendarOff.ok, true);
if (calendarOff.ok) {
  assert.equal(calendarOff.value.external_calendar_enabled, false);
}

assert.equal(normalizeRoutineCategories(['career']).ok, true);
assert.equal(normalizeRoutineCategories(['career', 'academics', 'physical']).ok, true);
assert.equal(normalizeRoutineCategories([]).ok, false);
assert.equal(
  normalizeRoutineCategories(['career', 'academics', 'physical', 'mind']).ok,
  false
);
assert.equal(normalizeRoutineCategories(['not-a-category']).ok, false);
assert.equal(normalizeRoutineCategories(['Fashion & Style']).ok, false);

const deduped = normalizeRoutineCategories(['career', 'career', 'academics']);
assert.equal(deduped.ok, true);
if (deduped.ok) {
  assert.deepEqual(deduped.value, ['career', 'academics']);
}

const tooManyUnique = prepareRoutineCreate('user-a', {
  title: 'Split focus',
  categories: ['career', 'academics', 'physical', 'mind'],
  recurrenceType: 'daily',
  weekdays: null,
  timezone: 'America/New_York',
});
assert.equal(tooManyUnique.ok, false);
if (!tooManyUnique.ok) {
  assert.equal(tooManyUnique.error, ROUTINE_VALIDATION_MESSAGES.categories);
}

const unknownCategory = prepareRoutineCreate('user-a', {
  title: 'Look sharp',
  categories: ['Fashion & Style'],
  recurrenceType: 'daily',
  weekdays: null,
  timezone: 'America/New_York',
});
assert.equal(unknownCategory.ok, false);
if (!unknownCategory.ok) {
  assert.equal(unknownCategory.error, ROUTINE_VALIDATION_MESSAGES.categoriesUnknown);
}

assert.deepEqual(
  PLANNING_CATEGORIES.map((item) => item.key),
  [...PLANNING_CATEGORY_KEYS]
);
assert.deepEqual(PLANNING_RECURRENCE_TYPES, ['daily', 'weekly']);
assert.equal(ROUTINE_CREATE_IS_ACTIVE, true);

assert.equal(isValidRoutineRecurrence('daily', null), true);
assert.equal(isValidRoutineRecurrence('weekly', [1, 3, 5]), true);
assert.equal(isValidRoutineRecurrence('weekly', null), false);
assert.equal(isValidRoutineRecurrence('daily', [1]), false);

const dailyOk = prepareRoutineCreate('user-a', {
  title: 'Read',
  categories: ['mind'],
  recurrenceType: 'daily',
  weekdays: null,
  timezone: 'America/New_York',
});
assert.equal(dailyOk.ok, true);
if (dailyOk.ok) {
  assert.equal(dailyOk.value.recurrence_type, 'daily');
  assert.equal(dailyOk.value.weekdays, null);
  assert.equal(dailyOk.value.is_active, true);
  assert.equal(dailyOk.value.goal_id, null);
}

const dailyWithWeekdays = prepareRoutineCreate('user-a', {
  title: 'Read',
  categories: ['mind'],
  recurrenceType: 'daily',
  weekdays: [1],
  timezone: 'America/New_York',
});
assert.equal(dailyWithWeekdays.ok, false);
if (!dailyWithWeekdays.ok) {
  assert.equal(dailyWithWeekdays.error, ROUTINE_VALIDATION_MESSAGES.weekdaysDaily);
}

const weeklyMissing = prepareRoutineCreate('user-a', {
  title: 'Lift',
  categories: ['physical'],
  recurrenceType: 'weekly',
  weekdays: null,
  timezone: 'America/New_York',
});
assert.equal(weeklyMissing.ok, false);
if (!weeklyMissing.ok) {
  assert.equal(weeklyMissing.error, ROUTINE_VALIDATION_MESSAGES.weekdays);
}

const weeklyEmpty = prepareRoutineCreate('user-a', {
  title: 'Lift',
  categories: ['physical'],
  recurrenceType: 'weekly',
  weekdays: [],
  timezone: 'America/New_York',
});
assert.equal(weeklyEmpty.ok, false);
if (!weeklyEmpty.ok) {
  assert.equal(weeklyEmpty.error, ROUTINE_VALIDATION_MESSAGES.weekdays);
}

const weeklyOk = prepareRoutineCreate('user-a', {
  title: 'Lift',
  categories: ['physical'],
  recurrenceType: 'weekly',
  weekdays: [5, 1, 1, 3],
  timezone: 'America/New_York',
});
assert.equal(weeklyOk.ok, true);
if (weeklyOk.ok) {
  assert.deepEqual(weeklyOk.value.weekdays, [1, 3, 5]);
}

const weekdayNorm = normalizeRoutineWeekdays('weekly', [7, 2, 2]);
assert.equal(weekdayNorm.ok, true);
if (weekdayNorm.ok) {
  assert.deepEqual(weekdayNorm.value, [2, 7]);
}

const badRecurrence = prepareRoutineCreate('user-a', {
  title: 'Lift',
  categories: ['physical'],
  recurrenceType: 'monthly',
  weekdays: [1],
  timezone: 'America/New_York',
});
assert.equal(badRecurrence.ok, false);
if (!badRecurrence.ok) {
  assert.equal(badRecurrence.error, ROUTINE_VALIDATION_MESSAGES.recurrence);
}

const withGoal = prepareRoutineCreate('user-a', {
  title: 'Lift',
  categories: ['physical'],
  goalId: 'goal-1',
  recurrenceType: 'weekly',
  weekdays: [1, 3, 5],
  timezone: 'America/New_York',
});
assert.equal(withGoal.ok, true);
if (withGoal.ok) {
  assert.equal(withGoal.value.goal_id, 'goal-1');
}

const badGoal = prepareRoutineCreate('user-a', {
  title: 'Lift',
  categories: ['physical'],
  goalId: 42,
  recurrenceType: 'daily',
  weekdays: null,
  timezone: 'America/New_York',
});
assert.equal(badGoal.ok, false);
if (!badGoal.ok) {
  assert.equal(badGoal.error, ROUTINE_VALIDATION_MESSAGES.goal);
}

const badTimezone = prepareRoutineCreate('user-a', {
  title: 'Lift',
  categories: ['physical'],
  recurrenceType: 'daily',
  weekdays: null,
  timezone: 'Not/AZone',
});
assert.equal(badTimezone.ok, false);

const browserZone = detectBrowserTimeZone();
assert.equal(isIanaTimeZone(browserZone), true);
assert.ok(browserZone.length <= 64);

const zoneOptions = listIanaTimeZoneOptions(browserZone);
assert.ok(zoneOptions.length > 1);
assert.ok(zoneOptions.every((option) => isIanaTimeZone(option.value)));
assert.ok(zoneOptions.every((option) => option.label.trim().length > 0));
assert.ok(zoneOptions.some((option) => option.value === browserZone));
assert.ok(zoneOptions.some((option) => option.value === 'UTC'));
assert.equal(
  zoneOptions.every((option) => !/\s{2,}/.test(option.label)),
  true
);
assert.ok(formatTimeZoneLabel('America/New_York').includes('New York'));
assert.ok(!formatTimeZoneLabel('America/New_York').includes('_'));
assert.ok(formatTimeZoneLabel('UTC').length > 0);

const easternAbbrs = timeZoneShortAbbreviations('America/New_York');
assert.ok(easternAbbrs.includes('EST'));
assert.ok(easternAbbrs.includes('EDT'));
assert.ok(formatTimeZoneLabel('America/New_York').includes('EST'));
assert.ok(formatTimeZoneLabel('America/New_York').includes('EDT'));

const centralAbbrs = timeZoneShortAbbreviations('America/Chicago');
assert.ok(centralAbbrs.includes('CST'));
assert.ok(centralAbbrs.includes('CDT'));
const mountainAbbrs = timeZoneShortAbbreviations('America/Denver');
assert.ok(mountainAbbrs.includes('MST'));
assert.ok(mountainAbbrs.includes('MDT'));
const pacificAbbrs = timeZoneShortAbbreviations('America/Los_Angeles');
assert.ok(pacificAbbrs.includes('PST'));
assert.ok(pacificAbbrs.includes('PDT'));

const estLower = filterTimeZoneOptions(zoneOptions, 'est');
const estUpper = filterTimeZoneOptions(zoneOptions, 'EST');
assert.ok(estLower.some((option) => option.value === 'America/New_York'));
assert.deepEqual(
  estLower.map((option) => option.value),
  estUpper.map((option) => option.value)
);

const indyLower = filterTimeZoneOptions(zoneOptions, 'indianapolis');
const indyMixed = filterTimeZoneOptions(zoneOptions, 'Indianapolis');
assert.deepEqual(
  indyLower.map((option) => option.value),
  indyMixed.map((option) => option.value)
);
assert.ok(
  zoneOptions.some((option) => option.value.includes('Indianapolis')),
  'expected America/Indiana/Indianapolis (or similar) in timezone list'
);
assert.ok(indyLower.some((option) => option.value.includes('Indianapolis')));

assert.ok(
  zoneOptions.every((option) =>
    option.abbreviations.every((abbr) => /^[A-Z]{2,5}$/.test(abbr))
  )
);

const ianaPersisted = prepareRoutineCreate('user-a', {
  title: 'Lift',
  categories: ['physical'],
  recurrenceType: 'daily',
  weekdays: null,
  timezone: 'America/New_York',
});
assert.equal(ianaPersisted.ok, true);
if (ianaPersisted.ok) {
  assert.equal(ianaPersisted.value.timezone, 'America/New_York');
  assert.equal(ianaPersisted.value.timezone.includes('EST'), false);
}

const validTimezoneCreate = prepareRoutineCreate('user-a', {
  title: 'Lift',
  categories: ['physical'],
  recurrenceType: 'daily',
  weekdays: null,
  timezone: browserZone,
});
assert.equal(validTimezoneCreate.ok, true);
if (validTimezoneCreate.ok) {
  assert.equal(validTimezoneCreate.value.timezone, browserZone);
}

const badDuration = prepareRoutineCreate('user-a', {
  title: 'Lift',
  categories: ['physical'],
  recurrenceType: 'daily',
  weekdays: null,
  durationMinutes: 0,
  timezone: 'America/New_York',
});
assert.equal(badDuration.ok, false);

const badTime = prepareRoutineCreate('user-a', {
  title: 'Lift',
  categories: ['physical'],
  recurrenceType: 'daily',
  weekdays: null,
  scheduledTime: '25:00',
  timezone: 'America/New_York',
});
assert.equal(badTime.ok, false);

const ownerIgnored = prepareRoutineCreate('session-user', {
  title: 'Keep ownership',
  categories: ['career'],
  recurrenceType: 'daily',
  weekdays: null,
  timezone: 'America/New_York',
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

const missingOwner = prepareRoutineCreate('', {
  title: 'No owner',
  categories: ['career'],
  recurrenceType: 'daily',
  weekdays: null,
  timezone: 'America/New_York',
});
assert.equal(missingOwner.ok, false);
if (!missingOwner.ok) {
  assert.equal(missingOwner.error, ROUTINE_VALIDATION_MESSAGES.signedIn);
}

const insertRow = prepareRoutineCreate('user-a', {
  title: 'Morning lift',
  description: '  Heavy compounds.  ',
  categories: ['physical', 'nutrition'],
  goalId: 'goal-1',
  recurrenceType: 'weekly',
  weekdays: [1, 3, 5],
  scheduledTime: '07:00',
  durationMinutes: 45,
  timezone: 'America/New_York',
});
assert.equal(insertRow.ok, true);
if (insertRow.ok) {
  assert.deepEqual(Object.keys(insertRow.value).sort(), [
    'categories',
    'description',
    'duration_minutes',
    'external_calendar_enabled',
    'goal_id',
    'is_active',
    'recurrence_type',
    'scheduled_time',
    'timezone',
    'title',
    'user_id',
    'weekday_labels',
    'weekdays',
  ]);
  assert.equal(insertRow.value.description, 'Heavy compounds.');
  assert.equal(insertRow.value.scheduled_time, '07:00:00');
  assert.equal(insertRow.value.duration_minutes, 45);
  assert.equal(insertRow.value.weekday_labels, null);
  assert.ok(!('points' in insertRow.value));
  assert.ok(!('xp' in insertRow.value));
  assert.ok(!('priority' in insertRow.value));
  assert.ok(
    isValidRoutine({
      userId: insertRow.value.user_id,
      title: insertRow.value.title,
      description: insertRow.value.description,
      categories: insertRow.value.categories,
      goalId: insertRow.value.goal_id,
      recurrenceType: insertRow.value.recurrence_type,
      weekdays: insertRow.value.weekdays,
      weekdayLabels: null,
      scheduledTime: insertRow.value.scheduled_time,
      durationMinutes: insertRow.value.duration_minutes,
      timezone: insertRow.value.timezone,
      isActive: insertRow.value.is_active,
    })
  );
}

// AM/PM picker conversion + persistence/reload (6:00 AM → 6:00 PM).
assert.deepEqual(localScheduledTimeToPickerParts('06:00'), {
  hour12: '06',
  minute: '00',
  period: 'AM',
});
assert.deepEqual(localScheduledTimeToPickerParts('06:00:00'), {
  hour12: '06',
  minute: '00',
  period: 'AM',
});
assert.equal(
  composeLocalScheduledTimeFromPickerParts('06', '00', 'AM'),
  '06:00'
);
assert.equal(
  composeLocalScheduledTimeFromPickerParts('06', '00', 'PM'),
  '18:00'
);
assert.deepEqual(localScheduledTimeToPickerParts('18:00:00'), {
  hour12: '06',
  minute: '00',
  period: 'PM',
});
assert.equal(
  composeLocalScheduledTimeFromPickerParts('12', '00', 'AM'),
  '00:00'
);
assert.equal(
  composeLocalScheduledTimeFromPickerParts('12', '00', 'PM'),
  '12:00'
);
assert.deepEqual(localScheduledTimeToPickerParts('00:30'), {
  hour12: '12',
  minute: '30',
  period: 'AM',
});
assert.deepEqual(localScheduledTimeToPickerParts('12:15'), {
  hour12: '12',
  minute: '15',
  period: 'PM',
});

const amParts = localScheduledTimeToPickerParts('06:00:00');
const switchedToPm = composeLocalScheduledTimeFromPickerParts(
  amParts.hour12,
  amParts.minute,
  'PM'
);
assert.equal(switchedToPm, '18:00');

const amToPmUpdate = prepareRoutineUpdate('user-a', {
  title: 'Evening lift',
  categories: ['physical'],
  recurrenceType: 'daily',
  weekdays: null,
  scheduledTime: switchedToPm,
  timezone: 'America/New_York',
});
assert.equal(amToPmUpdate.ok, true);
if (amToPmUpdate.ok) {
  assert.equal(amToPmUpdate.value.scheduled_time, '18:00:00');
}

const reloadedAfterPm = routineFromRow(
  {
    id: 'routine-pm',
    user_id: 'user-a',
    title: 'Evening lift',
    description: null,
    categories: ['physical'],
    goal_id: null,
    recurrence_type: 'daily',
    weekdays: null,
    scheduled_time: amToPmUpdate.ok
      ? amToPmUpdate.value.scheduled_time
      : null,
    duration_minutes: null,
    timezone: 'America/New_York',
    is_active: true,
    created_at: '2026-09-14T12:00:00.000Z',
    updated_at: '2026-09-14T12:00:00.000Z',
  },
  'user-a'
);
assert.ok(reloadedAfterPm);
assert.equal(reloadedAfterPm!.scheduledTime, '18:00:00');
assert.deepEqual(
  localScheduledTimeToPickerParts(reloadedAfterPm!.scheduledTime),
  { hour12: '06', minute: '00', period: 'PM' }
);

const createdInactive = prepareRoutineCreate('user-a', {
  title: 'Morning lift',
  categories: ['physical'],
  recurrenceType: 'daily',
  weekdays: null,
  timezone: 'America/New_York',
  is_active: false,
} as never);
assert.equal(createdInactive.ok, true);
if (createdInactive.ok) {
  assert.equal(createdInactive.value.is_active, true);
}

const updateRow = prepareRoutineUpdate('user-a', {
  title: 'Morning lift',
  categories: ['physical'],
  recurrenceType: 'daily',
  weekdays: null,
  timezone: 'America/New_York',
});
assert.equal(updateRow.ok, true);
if (updateRow.ok) {
  assert.deepEqual(Object.keys(updateRow.value).sort(), [
    'categories',
    'description',
    'duration_minutes',
    'external_calendar_enabled',
    'goal_id',
    'recurrence_type',
    'scheduled_time',
    'timezone',
    'title',
    'updated_at',
    'weekday_labels',
    'weekdays',
  ]);
  assert.ok(!('user_id' in updateRow.value));
  assert.ok(!('is_active' in updateRow.value));
}

const archive = prepareRoutineActiveTransition(false);
assert.equal(archive.ok, true);
if (archive.ok) {
  assert.equal(archive.value.is_active, false);
  assert.ok(archive.value.updated_at);
}

const tombstone = prepareRoutineTombstone('2026-09-23T18:00:00.000Z');
assert.equal(tombstone.ok, true);
if (tombstone.ok) {
  assert.equal(tombstone.value.is_active, false);
  assert.equal(tombstone.value.deleted_at, '2026-09-23T18:00:00.000Z');
}

const reactivate = prepareRoutineActiveTransition(true);
assert.equal(reactivate.ok, true);
if (reactivate.ok) {
  assert.equal(reactivate.value.is_active, true);
}

const badActive = prepareRoutineActiveTransition('archived');
assert.equal(badActive.ok, false);
if (!badActive.ok) {
  assert.equal(badActive.error, ROUTINE_VALIDATION_MESSAGES.active);
}

const row = {
  id: 'routine-1',
  user_id: 'user-a',
  title: '  Morning lift  ',
  description: null,
  categories: ['physical'],
  goal_id: 'goal-1',
  recurrence_type: 'weekly',
  weekdays: [1, 3, 5],
  scheduled_time: '07:00:00',
  duration_minutes: 45,
  timezone: 'America/New_York',
  is_active: true,
  created_at: '2026-09-14T12:00:00.000Z',
  updated_at: '2026-09-14T12:00:00.000Z',
};

const mapped = routineFromRow(row, 'user-a');
assert.ok(mapped);
assert.deepEqual(Object.keys(mapped!).sort(), [...ROUTINE_DOMAIN_FIELDS].sort());
assert.equal(mapped!.userId, 'user-a');
assert.equal(mapped!.title, 'Morning lift');
assert.equal(mapped!.goalId, 'goal-1');
assert.deepEqual(mapped!.weekdays, [1, 3, 5]);
assert.equal(mapped!.weekdayLabels, null);
assert.equal(mapped!.isActive, true);
assert.equal(mapped!.externalCalendarEnabled, true);
assert.equal(mapped!.deletedAt, null);
assert.equal(formatRoutineRecurrence(mapped!), 'Weekly · Mon, Wed, Fri');

const mappedDeleted = mapOwnedRoutineRows(
  [{ ...row, id: 'routine-gone', deleted_at: '2026-09-23T18:00:00.000Z' }],
  'user-a'
);
assert.deepEqual(mappedDeleted, []);

assert.equal(routineFromRow(row, 'user-b'), null);
assert.equal(
  routineFromRow({ ...row, recurrence_type: 'monthly' }, 'user-a'),
  null
);
assert.equal(
  routineFromRow({ ...row, categories: ['career', 'career'] }, 'user-a'),
  null
);
assert.equal(
  routineFromRow(
    { ...row, recurrence_type: 'daily', weekdays: [1] },
    'user-a'
  ),
  null
);

const mixed = mapOwnedRoutineRows(
  [
    row,
    { ...row, id: 'routine-2', user_id: 'user-b' },
    { ...row, id: 'routine-3' },
  ],
  'user-a'
);
assert.deepEqual(
  mixed.map((routine) => routine.id),
  ['routine-1', 'routine-3']
);

assert.deepEqual(ROUTINE_TABLE_COLUMNS, [
  'id',
  'user_id',
  'title',
  'description',
  'categories',
  'goal_id',
  'recurrence_type',
  'weekdays',
  'weekday_labels',
  'scheduled_time',
  'duration_minutes',
  'timezone',
  'is_active',
  'external_calendar_enabled',
  'deleted_at',
  'created_at',
  'updated_at',
]);

const sql = readFileSync(join(root, 'supabase/v8_planning_contract.sql'), 'utf8');
const weekdayLabelMigration = readFileSync(
  join(root, 'supabase/v11_routine_weekday_labels.sql'),
  'utf8'
);
const lifecycleMigration = readFileSync(
  join(root, 'supabase/v14_routine_lifecycle_and_external_calendar.sql'),
  'utf8'
);
for (const column of ROUTINE_TABLE_COLUMNS) {
  if (column === 'weekday_labels') {
    assert.ok(
      weekdayLabelMigration.includes(column),
      `v11 missing ${column}`
    );
    continue;
  }
  if (column === 'external_calendar_enabled' || column === 'deleted_at') {
    assert.ok(
      lifecycleMigration.includes(column),
      `v14 missing ${column}`
    );
    continue;
  }
  assert.ok(sql.includes(column), `schema missing ${column}`);
}
assert.ok(weekdayLabelMigration.includes('routines_weekday_labels_integrity'));
assert.ok(weekdayLabelMigration.includes('Do not apply'));
assert.ok(sql.includes('routines_recurrence_integrity'));
assert.ok(sql.includes('on delete set null'));
assert.ok(sql.includes('planned_occurrences_routine_owner_fk'));
assert.ok(sql.includes('on delete restrict'));
assert.ok(sql.includes('routines_delete_own'));

const insertStatuses: RoutineInsertRow['is_active'][] = [true, false];
assert.ok(insertStatuses.includes(ROUTINE_CREATE_IS_ACTIVE));

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

const routinesAccess = readFileSync(join(planningDir, 'routinesAccess.ts'), 'utf8');
assert.ok(routinesAccess.includes(".from('routines')"));
assert.ok(routinesAccess.includes(".eq('user_id', ownerId)"));
assert.ok(routinesAccess.includes('prepareRoutineCreate'));
assert.ok(routinesAccess.includes('setOwnedRoutineActive'));
assert.ok(routinesAccess.includes('ON DELETE RESTRICT'));
assert.ok(routinesAccess.includes('permanentlyRemoveOwnedRoutine'));
assert.ok(routinesAccess.includes('deleted_at'));
assert.ok(routinesAccess.includes('skipOwnedPlannedOccurrencesForRoutine'));
assert.equal(routinesAccess.includes('.delete('), false);
assert.equal(routinesAccess.includes('SERVICE_ROLE'), false);
assert.equal(routinesAccess.includes('service_role'), false);
assert.equal(routinesAccess.includes('SUPABASE_SERVICE_ROLE_KEY'), false);
assert.ok(!routinesAccess.includes('planned_occurrences'));
assert.ok(!routinesAccess.includes(".from('logs')"));

const uiFiles = [
  'RoutinesView.tsx',
  'RoutineForm.tsx',
  'PlanningHome.tsx',
].map((name) => readFileSync(join(root, 'app/planning', name), 'utf8'));
const uiBundle = uiFiles.join('\n');
assert.ok(!uiBundle.includes('lib/evaluation'));
assert.ok(!uiBundle.includes('applyPriorityReward'));
assert.ok(!uiBundle.includes('progressCredit'));
assert.ok(!uiBundle.includes('actionEvidence'));
assert.ok(!uiBundle.includes('calculateDisciplineScore'));
assert.ok(!uiBundle.includes('planned_occurrences'));
assert.ok(!uiBundle.includes('check off') && !uiBundle.includes('checkoff'));
assert.ok(uiBundle.includes('Delete permanently'));
assert.ok(uiBundle.includes('Yes, delete permanently'));
assert.ok(uiBundle.includes('permanentlyRemoveOwnedRoutine'));

const routineForm = readFileSync(
  join(root, 'app/planning/RoutineForm.tsx'),
  'utf8'
);
assert.ok(routineForm.includes("chooseRecurrence('daily')"));
assert.ok(routineForm.includes("chooseRecurrence('weekly')"));
assert.ok(routineForm.includes('aria-pressed'));
assert.ok(routineForm.includes('choiceSelected'));
assert.ok(routineForm.includes('Add to calendar'));
assert.ok(routineForm.includes('connected calendar'));
assert.ok(!routineForm.includes('google_calendar_enabled'));
assert.ok(routineForm.includes('Hide schedule details'));
assert.ok(routineForm.includes('No active goals to link yet'));
assert.ok(routineForm.includes('listIanaTimeZoneOptions'));
assert.ok(routineForm.includes('filterTimeZoneOptions'));
assert.ok(routineForm.includes('customTimePicker'));
assert.ok(routineForm.includes('periodToggle'));
assert.ok(routineForm.includes("setPeriod('AM')"));
assert.ok(routineForm.includes("setPeriod('PM')"));
assert.ok(routineForm.includes('composeLocalScheduledTimeFromPickerParts'));
assert.ok(routineForm.includes('localScheduledTimeToPickerParts'));
assert.ok(routineForm.includes('routine-time-hour'));
assert.ok(routineForm.includes('routine-time-minute'));
assert.ok(routineForm.includes('detectBrowserTimeZone'));
assert.ok(routineForm.includes('styles.formSelect'));
assert.ok(routineForm.includes('id="routine-timezone"'));
assert.ok(routineForm.includes('+ Different action on some days?'));
assert.ok(routineForm.includes('Hide day-specific actions'));
assert.ok(routineForm.includes('weekdayLabels'));
assert.ok(routineForm.includes('WEEKDAY_FULL_LABELS'));
assert.ok(!routineForm.includes('monthly'));
assert.ok(!routineForm.includes('RRULE'));
assert.ok(!routineForm.includes('type="time"'));
assert.ok(!routineForm.includes('HOUR_OPTIONS'));
assert.ok(routineForm.includes('HOUR_12_OPTIONS'));
assert.equal(
  /id="routine-timezone"[\s\S]*?className="textInput"/.test(routineForm),
  false
);

const routineCss = readFileSync(
  join(root, 'app/planning/routines.module.css'),
  'utf8'
);
assert.ok(routineCss.includes('.choiceSelected'));
assert.ok(routineCss.includes('color: var(--accent)'));
assert.ok(routineCss.includes('color-scheme: dark'));
assert.ok(routineCss.includes('.dayLabelBlock'));

// Same-action weekly fallback + per-weekday labels.
assert.equal(
  isValidRoutineWeekdayLabels('weekly', [1, 2, 3], null),
  true
);
assert.equal(
  isValidRoutineWeekdayLabels('daily', null, { 1: 'Chest' }),
  false
);
assert.equal(
  isValidRoutineWeekdayLabels(
    'weekly',
    [1, 2, 3, 4, 5],
    {
      1: 'Chest & Back',
      2: 'Sharms',
      3: 'Legs & Abs',
      4: 'Chest & Back',
      5: 'Sharms',
    }
  ),
  true
);
assert.equal(
  isValidRoutineWeekdayLabels('weekly', [2, 4], { 3: 'Legs' }),
  false
);

const sameActionWeekly = prepareRoutineCreate('user-a', {
  title: 'BJJ',
  categories: ['physical'],
  recurrenceType: 'weekly',
  weekdays: [2, 4],
  weekdayLabels: null,
  timezone: 'America/New_York',
});
assert.equal(sameActionWeekly.ok, true);
if (sameActionWeekly.ok) {
  assert.equal(sameActionWeekly.value.weekday_labels, null);
}

const splitWeekly = prepareRoutineCreate('user-a', {
  title: 'Lifting Split',
  description: 'Mon Chest & Back / Tue Sharms / Wed Legs & Abs…',
  categories: ['physical'],
  recurrenceType: 'weekly',
  weekdays: [1, 2, 3, 4, 5],
  weekdayLabels: {
    1: 'Chest & Back',
    2: 'Sharms',
    3: 'Legs & Abs',
    4: 'Chest & Back',
    5: 'Sharms',
  },
  timezone: 'America/New_York',
});
assert.equal(splitWeekly.ok, true);
if (splitWeekly.ok) {
  assert.deepEqual(splitWeekly.value.weekday_labels, {
    '1': 'Chest & Back',
    '2': 'Sharms',
    '3': 'Legs & Abs',
    '4': 'Chest & Back',
    '5': 'Sharms',
  });
}

const splitRoutine = {
  title: 'Lifting Split',
  recurrenceType: 'weekly' as const,
  weekdayLabels: {
    1: 'Chest & Back',
    2: 'Sharms',
    3: 'Legs & Abs',
    4: 'Chest & Back',
    5: 'Sharms',
  },
};
// 2026-09-16 = Wednesday (3), 2026-09-17 = Thursday (4)
assert.equal(
  effectiveRoutineActionForLocalDate(splitRoutine, '2026-09-16'),
  'Legs & Abs'
);
assert.equal(
  effectiveRoutineActionForLocalDate(splitRoutine, '2026-09-17'),
  'Chest & Back'
);
assert.equal(
  effectiveRoutineActionForLocalDate(
    { title: 'BJJ', recurrenceType: 'weekly', weekdayLabels: null },
    '2026-09-17'
  ),
  'BJJ'
);

const wedPresentation = presentRoutineOccurrence(splitRoutine, '2026-09-16');
assert.equal(wedPresentation.actionTitle, 'Legs & Abs');
assert.equal(wedPresentation.contextLine, 'Lifting Split · Wednesday');
assert.equal(wedPresentation.usesWeekdayLabel, true);
assert.ok(!wedPresentation.actionTitle.includes('Mon Chest'));

const bjjPresentation = presentRoutineOccurrence(
  { title: 'BJJ', recurrenceType: 'weekly', weekdayLabels: null },
  '2026-09-17'
);
assert.equal(bjjPresentation.actionTitle, 'BJJ');
assert.equal(bjjPresentation.contextLine, null);
assert.equal(bjjPresentation.usesWeekdayLabel, false);

const trimmedLabels = normalizeRoutineWeekdayLabels(
  'weekly',
  [1, 3],
  { 1: '  Push  ', 3: '   ' }
);
assert.equal(trimmedLabels.ok, true);
if (trimmedLabels.ok) {
  assert.deepEqual(trimmedLabels.value, { '1': 'Push' });
}

const mappedSplit = routineFromRow(
  {
    id: 'routine-split',
    user_id: 'user-a',
    title: 'Lifting Split',
    description: 'Weekly plan notes — not today\'s action',
    categories: ['physical'],
    goal_id: null,
    recurrence_type: 'weekly',
    weekdays: [1, 2, 3, 4, 5],
    weekday_labels: {
      '1': 'Chest & Back',
      '3': 'Legs & Abs',
    },
    scheduled_time: null,
    duration_minutes: null,
    timezone: 'America/New_York',
    is_active: true,
    created_at: '2026-09-14T12:00:00.000Z',
    updated_at: '2026-09-14T12:00:00.000Z',
  },
  'user-a'
);
assert.ok(mappedSplit);
assert.deepEqual(mappedSplit!.weekdayLabels, {
  1: 'Chest & Back',
  3: 'Legs & Abs',
});
assert.equal(
  effectiveRoutineActionForLocalDate(mappedSplit!, '2026-09-16'),
  'Legs & Abs'
);
assert.equal(
  effectiveRoutineActionForLocalDate(mappedSplit!, '2026-09-15'),
  'Lifting Split'
); // Tuesday without label falls back to title

console.log(
  JSON.stringify(
    {
      ok: true,
      slice: 'routines',
      categoryCount: PLANNING_CATEGORY_KEYS.length,
      recurrenceTypes: PLANNING_RECURRENCE_TYPES,
      createIsActive: ROUTINE_CREATE_IS_ACTIVE,
      columns: ROUTINE_TABLE_COLUMNS,
      deletion: 'tombstone-restrict',
      timezoneOptions: zoneOptions.length,
      browserTimeZone: browserZone,
      weekdayLabels: true,
    },
    null,
    2
  )
);
