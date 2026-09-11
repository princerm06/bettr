/**
 * Zero-credit aggregation invariants. Does not load MiniLM.
 */
import assert from 'assert';
import { attributionShareForCategory } from '../../lib/evaluation/categoryAttribution';
import { shiftIsoDate } from '../../lib/evaluation/discipline';
import {
  countCreditedActiveDays,
  countCreditedProgressStreak,
  creditedProgressPoints,
  hasPositiveProgressCredit,
  isCreditedProgressLog,
  isIsoDateInInclusiveRange,
  sumCreditedProgress,
} from '../../lib/evaluation/progressCredit';
import type { CategoryKey } from '../../lib/evaluation/legacyEvaluator';

assert.equal(hasPositiveProgressCredit(5), true);
assert.equal(hasPositiveProgressCredit(7), true);
assert.equal(hasPositiveProgressCredit(0), false);
assert.equal(hasPositiveProgressCredit(-1), false);
assert.equal(hasPositiveProgressCredit(Number.NaN), false);
assert.equal(hasPositiveProgressCredit(Number.POSITIVE_INFINITY), false);
assert.equal(isCreditedProgressLog({ points: 5 }), true);
assert.equal(isCreditedProgressLog({ points: 0 }), false);

assert.equal(sumCreditedProgress([{ points: 5 }, { points: 7 }]), 12);
assert.equal(sumCreditedProgress([{ points: 5 }, { points: 0 }, { points: 7 }]), 12);
assert.equal(
  sumCreditedProgress([{ points: 5 }, { points: -4 }, { points: Number.NaN }, { points: 7 }]),
  12
);
assert.equal(creditedProgressPoints(-4), 0);

const today = '2026-09-11';
const start30 = shiftIsoDate(today, -29);

assert.equal(
  countCreditedActiveDays([{ date: today, points: 5 }]),
  1
);
assert.equal(
  countCreditedActiveDays([
    { date: today, points: 5 },
    { date: today, points: 7 },
  ]),
  1
);
assert.equal(countCreditedActiveDays([{ date: today, points: 0 }]), 0);
assert.equal(countCreditedActiveDays([{ date: today, points: -2 }]), 0);
assert.equal(
  countCreditedActiveDays([
    { date: today, points: 5 },
    { date: today, points: 0 },
  ]),
  1
);

const inWindow = { date: start30, points: 5 };
const outside = { date: shiftIsoDate(today, -30), points: 5 };
const future = { date: shiftIsoDate(today, 1), points: 5 };
assert.equal(isIsoDateInInclusiveRange(inWindow.date, start30, today), true);
assert.equal(isIsoDateInInclusiveRange(outside.date, start30, today), false);
assert.equal(isIsoDateInInclusiveRange(future.date, start30, today), false);

const windowed = [inWindow, outside, future, { date: today, points: 0 }, { date: today, points: 7 }];
const recentCredited = windowed.filter(
  (log) =>
    isCreditedProgressLog(log) && isIsoDateInInclusiveRange(log.date, start30, today)
);
assert.equal(sumCreditedProgress(recentCredited), 12);
assert.equal(countCreditedActiveDays(recentCredited), 2);

const zeroMulti = {
  category: 'physical' as CategoryKey,
  categories: ['physical', 'fashion'] as CategoryKey[],
  activity: 'Lifted',
  details: '',
  points: 0,
};
assert.equal(attributionShareForCategory(zeroMulti, 'physical') * zeroMulti.points, 0);
assert.equal(creditedProgressPoints(zeroMulti.points), 0);

const logs = [
  { id: 'a', date: today, points: 5 },
  { id: 'b', date: today, points: 0 },
  { id: 'c', date: today, points: 7 },
];
assert.equal(sumCreditedProgress(logs), 12);
assert.equal(sumCreditedProgress(logs.filter((log) => log.id !== 'a')), 7);
assert.equal(sumCreditedProgress(logs.filter((log) => log.id !== 'b')), 12);

const afterMetadata = logs.map((log) =>
  log.id === 'a' ? { ...log, date: today } : log
);
assert.equal(sumCreditedProgress(afterMetadata), 12);

const yesterday = shiftIsoDate(today, -1);
const twoAgo = shiftIsoDate(today, -2);
assert.equal(
  countCreditedProgressStreak([{ date: today, points: 0 }], today),
  0
);
assert.equal(
  countCreditedProgressStreak([{ date: today, points: 5 }], today),
  1
);
assert.equal(
  countCreditedProgressStreak(
    [
      { date: today, points: 5 },
      { date: today, points: 7 },
    ],
    today
  ),
  1
);
assert.equal(
  countCreditedProgressStreak([{ date: shiftIsoDate(today, 1), points: 5 }], today),
  0
);
assert.equal(
  countCreditedProgressStreak(
    [
      { date: today, points: 5 },
      { date: yesterday, points: 5 },
    ],
    today
  ),
  2
);
assert.equal(
  countCreditedProgressStreak(
    [
      { date: today, points: 5 },
      { date: yesterday, points: 0 },
      { date: twoAgo, points: 5 },
    ],
    today
  ),
  1
);
assert.equal(
  countCreditedProgressStreak(
    [
      { date: yesterday, points: 5 },
      { date: today, points: 0 },
    ],
    today
  ),
  0
);

const streakLogs = [
  { id: 'keep', date: yesterday, points: 5 },
  { id: 'gone', date: today, points: 5 },
];
assert.equal(countCreditedProgressStreak(streakLogs, today), 2);
assert.equal(
  countCreditedProgressStreak(
    streakLogs.filter((log) => log.id !== 'gone'),
    today
  ),
  0
);
assert.equal(
  countCreditedProgressStreak(
    streakLogs.map((log) =>
      log.id === 'gone' ? { ...log, date: shiftIsoDate(today, -8) } : log
    ),
    today
  ),
  0
);

const historyRows = [
  { date: today, points: 0, activity: 'rejected' },
  { date: today, points: 5, activity: 'Ran 5k' },
];
assert.equal(historyRows.length, 2);

console.log(
  JSON.stringify(
    {
      ok: true,
      zeroCredit: 'excluded from xp / active days / 30-day points',
      history: 'not filtered here',
    },
    null,
    2
  )
);
