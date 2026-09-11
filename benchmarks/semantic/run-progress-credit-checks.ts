/**
 * Zero-credit aggregation invariants. Does not load MiniLM.
 */
import assert from 'assert';
import { attributionShareForCategory } from '../../lib/evaluation/categoryAttribution';
import { shiftIsoDate } from '../../lib/evaluation/discipline';
import {
  countCreditedActiveDays,
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
