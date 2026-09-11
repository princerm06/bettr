/**
 * Deterministic Phase 2 priority-reward regression.
 * Does not load MiniLM or Candidate 3A.2.
 */
import assert from 'assert';
import type { CategoryKey } from '../../lib/evaluation/legacyEvaluator';
import {
  applyPriorityReward,
  DEFAULT_PRIORITY,
  PRIORITY_BONUS,
  priorityBonus,
  resolvePriorityLevel,
  uniqueCategoryKeys,
  type PriorityLevel,
  type PriorityMap,
} from '../../lib/evaluation/priorityReward';

const ALL_NORMAL: PriorityMap = {
  appearance: 'normal',
  fashion: 'normal',
  academics: 'normal',
  career: 'normal',
  finance: 'normal',
  nutrition: 'normal',
  social: 'normal',
  physical: 'normal',
  mind: 'normal',
  spirituality: 'normal',
};

function mapWith(
  overrides: Partial<Record<CategoryKey, PriorityLevel>>
): PriorityMap {
  return { ...ALL_NORMAL, ...overrides };
}

assert.equal(PRIORITY_BONUS.critical, 2);
assert.equal(PRIORITY_BONUS.high, 1);
assert.equal(PRIORITY_BONUS.normal, 0);
assert.equal(PRIORITY_BONUS.maintenance, -1);
assert.equal(DEFAULT_PRIORITY, 'normal');
assert.equal(resolvePriorityLevel(undefined), 'normal');
assert.equal(resolvePriorityLevel(''), 'normal');
assert.equal(resolvePriorityLevel('urgent'), 'normal');
assert.equal(priorityBonus(undefined), 0);

const priorities: PriorityLevel[] = ['critical', 'high', 'normal', 'maintenance'];

for (const priority of priorities) {
  assert.equal(applyPriorityReward(0, ['physical'], mapWith({ physical: priority })), 0);
}

assert.equal(applyPriorityReward(5, ['physical'], mapWith({ physical: 'critical' })), 7);
assert.equal(applyPriorityReward(5, ['physical'], mapWith({ physical: 'high' })), 6);
assert.equal(applyPriorityReward(5, ['physical'], mapWith({ physical: 'normal' })), 5);
assert.equal(applyPriorityReward(5, ['physical'], mapWith({ physical: 'maintenance' })), 4);

assert.equal(applyPriorityReward(7, ['physical'], mapWith({ physical: 'critical' })), 9);
assert.equal(applyPriorityReward(7, ['physical'], mapWith({ physical: 'high' })), 8);
assert.equal(applyPriorityReward(7, ['physical'], mapWith({ physical: 'normal' })), 7);
assert.equal(applyPriorityReward(7, ['physical'], mapWith({ physical: 'maintenance' })), 6);

assert.equal(
  applyPriorityReward(5, ['academics', 'career'], mapWith({ academics: 'critical', career: 'high' })),
  7
);
assert.equal(
  applyPriorityReward(5, ['career', 'finance'], mapWith({ career: 'high', finance: 'normal' })),
  6
);
assert.equal(
  applyPriorityReward(7, ['academics', 'fashion'], mapWith({ academics: 'critical', fashion: 'maintenance' })),
  8
);
assert.equal(
  applyPriorityReward(5, ['mind', 'fashion'], mapWith({ mind: 'normal', fashion: 'maintenance' })),
  5
);
assert.equal(
  applyPriorityReward(5, ['physical', 'nutrition'], mapWith({ physical: 'high', nutrition: 'high' })),
  6
);

assert.equal(applyPriorityReward(5, ['physical'], {}), 5);
assert.equal(applyPriorityReward(5, ['physical'], { career: 'critical' }), 5);
assert.equal(applyPriorityReward(7, ['physical'], { physical: 'not-a-level' }), 7);
assert.ok(Number.isFinite(applyPriorityReward(5, ['physical'], {})));
assert.equal(applyPriorityReward(Number.NaN, ['physical'], ALL_NORMAL), 0);

assert.deepEqual(uniqueCategoryKeys(['physical', 'physical', 'mind']), ['physical', 'mind']);
assert.equal(
  applyPriorityReward(5, ['physical', 'physical'], mapWith({ physical: 'critical' })),
  7
);

assert.equal(applyPriorityReward(5, [], ALL_NORMAL), 5);
assert.equal(applyPriorityReward(7, [], ALL_NORMAL), 7);
assert.equal(applyPriorityReward(0, [], ALL_NORMAL), 0);

console.log(
  JSON.stringify(
    {
      ok: true,
      emptyCategories: 'positive base unchanged',
      duplicates: 'first-seen unique keys',
      missingPriority: 'normal',
    },
    null,
    2
  )
);
