/**
 * Interim Phase 2 Discipline: derived alignment score, not XP.
 * Does not load MiniLM.
 */
import assert from 'assert';
import { isSelectableProgressCategory } from '../../lib/evaluation/categoryAttribution';
import {
  calculateDisciplineScore,
  DISCIPLINE_PRIORITY_TARGETS,
  DISCIPLINE_PRIORITY_WEIGHTS,
  DISCIPLINE_WINDOW_DAYS,
  isDateInDisciplineWindow,
  isDisciplineCategoryKey,
  shiftIsoDate,
  type DisciplineLog,
} from '../../lib/evaluation/discipline';
import { categories, type CategoryKey } from '../../lib/evaluation/legacyEvaluator';
import { createDefaultPriorityMap } from '../../lib/evaluation/priorityState';
import { TRUSTED_QUICK_ACTIVITIES } from '../../lib/evaluation/trustedQuickActivities';

assert.equal(DISCIPLINE_WINDOW_DAYS, 7);
assert.equal(DISCIPLINE_PRIORITY_WEIGHTS.critical, 4);
assert.equal(DISCIPLINE_PRIORITY_TARGETS.critical, 5);
assert.equal(isDisciplineCategoryKey('discipline'), true);
assert.equal(isSelectableProgressCategory('discipline'), false);
assert.equal('discipline' in TRUSTED_QUICK_ACTIVITIES, false);
assert.ok(categories.every((item) => item.key !== ('discipline' as CategoryKey)));

const today = '2026-09-11';
const allNormal = createDefaultPriorityMap();

function log(partial: Partial<DisciplineLog> & Pick<DisciplineLog, 'date' | 'points'>): DisciplineLog {
  return {
    category: 'physical',
    activity: 'Ran 5k',
    details: '',
    ...partial,
  };
}

assert.equal(calculateDisciplineScore({ logs: [], priorities: allNormal, today }), 0);

const todayLog = log({ date: today, points: 5 });
const withAccepted = calculateDisciplineScore({
  logs: [todayLog],
  priorities: allNormal,
  today,
});
assert.ok(withAccepted > 0);

assert.equal(
  calculateDisciplineScore({
    logs: [log({ date: today, points: 0 })],
    priorities: allNormal,
    today,
  }),
  0
);
assert.equal(
  calculateDisciplineScore({
    logs: [log({ date: today, points: -3 })],
    priorities: allNormal,
    today,
  }),
  0
);

assert.equal(isDateInDisciplineWindow(today, today), true);
assert.equal(isDateInDisciplineWindow(shiftIsoDate(today, -6), today), true);
assert.equal(isDateInDisciplineWindow(shiftIsoDate(today, -7), today), false);
assert.equal(isDateInDisciplineWindow(shiftIsoDate(today, 1), today), false);

const inside = calculateDisciplineScore({
  logs: [log({ date: shiftIsoDate(today, -6), points: 5 })],
  priorities: allNormal,
  today,
});
const outside = calculateDisciplineScore({
  logs: [log({ date: shiftIsoDate(today, -7), points: 5 })],
  priorities: allNormal,
  today,
});
const future = calculateDisciplineScore({
  logs: [log({ date: shiftIsoDate(today, 1), points: 5 })],
  priorities: allNormal,
  today,
});
assert.ok(inside > 0);
assert.equal(outside, 0);
assert.equal(future, 0);

const recentPhysical = [log({ date: today, points: 5, category: 'physical', activity: 'Lifted' })];
const frozenPoints = recentPhysical[0].points;
const normalScore = calculateDisciplineScore({
  logs: recentPhysical,
  priorities: allNormal,
  today,
});
const criticalPhysical = createDefaultPriorityMap();
criticalPhysical.physical = 'critical';
const criticalScore = calculateDisciplineScore({
  logs: recentPhysical,
  priorities: criticalPhysical,
  today,
});
assert.notEqual(normalScore, criticalScore);
assert.equal(recentPhysical[0].points, frozenPoints);

const multi: DisciplineLog = {
  date: today,
  points: 6,
  category: 'physical',
  categories: ['physical', 'fashion'],
  activity: 'Lifted',
  details: '',
};
const multiScore = calculateDisciplineScore({
  logs: [multi],
  priorities: allNormal,
  today,
});
assert.ok(multiScore > 0);
assert.equal(multi.points, 6);

const twoLogs = [
  log({ date: today, points: 5, category: 'physical', activity: 'Lifted' }),
  log({ date: today, points: 5, category: 'academics', activity: 'Study session', details: 'Quiz prep.' }),
];
const both = calculateDisciplineScore({ logs: twoLogs, priorities: allNormal, today });
const afterDelete = calculateDisciplineScore({
  logs: twoLogs.slice(1),
  priorities: allNormal,
  today,
});
assert.ok(afterDelete < both);

const withMeta = calculateDisciplineScore({
  logs: [log({ date: today, points: 5 })],
  priorities: allNormal,
  today,
});
const stillSame = calculateDisciplineScore({
  logs: [log({ date: today, points: 5 })],
  priorities: allNormal,
  today,
});
assert.equal(withMeta, stillSame);

const movedOut = calculateDisciplineScore({
  logs: [log({ date: shiftIsoDate(today, -7), points: 5 })],
  priorities: allNormal,
  today,
});
assert.equal(movedOut, 0);

const physicalOnly = calculateDisciplineScore({
  logs: [log({ date: today, points: 5, category: 'physical', activity: 'Lifted' })],
  priorities: allNormal,
  today,
});
const recategorized = calculateDisciplineScore({
  logs: [
    log({
      date: today,
      points: 5,
      category: 'fashion',
      categories: ['fashion'],
      activity: 'Lifted',
    }),
  ],
  priorities: allNormal,
  today,
});
assert.ok(Number.isFinite(physicalOnly) && Number.isFinite(recategorized));

const originalLogs = [log({ date: today, points: 5 })];
const rejectedLeavesOriginal = calculateDisciplineScore({
  logs: originalLogs,
  priorities: allNormal,
  today,
});
assert.equal(
  calculateDisciplineScore({ logs: originalLogs, priorities: allNormal, today }),
  rejectedLeavesOriginal
);

const zeroDoesNotRaise = calculateDisciplineScore({
  logs: [log({ date: today, points: 5 }), log({ date: today, points: 0, activity: 'junk' })],
  priorities: allNormal,
  today,
});
assert.equal(zeroDoesNotRaise, withAccepted);

console.log(
  JSON.stringify(
    {
      ok: true,
      windowDays: DISCIPLINE_WINDOW_DAYS,
      futureDated: 'excluded',
      xp: 'not awarded',
      category: 'not selectable',
    },
    null,
    2
  )
);
