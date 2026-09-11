/**
 * Production taxonomy: Inner Wellbeing is a first-class CategoryKey.
 * Does not load MiniLM or change Phase 1/2 scoring constants.
 */
import assert from 'assert';
import { attributionShareForCategory } from '../../lib/evaluation/categoryAttribution';
import { inferMatchingCategories } from '../../lib/evaluation/categoryComposerUx';
import { calculateDisciplineScore } from '../../lib/evaluation/discipline';
import {
  categories,
  categoryFor,
  type CategoryKey,
} from '../../lib/evaluation/legacyEvaluator';
import { applyPriorityReward } from '../../lib/evaluation/priorityReward';
import {
  CATEGORY_KEYS,
  createDefaultPriorityMap,
  normalizePriorityMap,
} from '../../lib/evaluation/priorityState';
import { TRUSTED_QUICK_ACTIVITIES } from '../../lib/evaluation/trustedQuickActivities';
import { LEGACY_KEY_TO_V1, V1_TO_LEGACY_KEY } from './legacyAdapter';

const PRODUCTION_KEYS: CategoryKey[] = [
  'appearance',
  'fashion',
  'academics',
  'career',
  'finance',
  'nutrition',
  'social',
  'physical',
  'mind',
  'inner',
  'spirituality',
];

assert.equal(categories.length, 11);
assert.deepEqual(categories.map((item) => item.key), PRODUCTION_KEYS);
assert.deepEqual(CATEGORY_KEYS, PRODUCTION_KEYS);
assert.equal(new Set(CATEGORY_KEYS).size, 11);

assert.equal(categoryFor('inner').label, 'Inner Wellbeing');
assert.equal(categoryFor('inner').short, 'Inner Wellbeing');
assert.ok(categoryFor('inner').emoji);
assert.equal(categoryFor('mind').key, 'mind');

const defaults = createDefaultPriorityMap();
assert.equal(Object.keys(defaults).length, 11);
assert.equal(defaults.inner, 'normal');
assert.equal(normalizePriorityMap({ career: 'high' }).inner, 'normal');

assert.equal(applyPriorityReward(5, ['inner'], defaults), 5);
assert.equal(applyPriorityReward(5, ['inner'], { ...defaults, inner: 'critical' }), 7);
assert.equal(applyPriorityReward(5, ['inner', 'mind'], { ...defaults, inner: 'critical', mind: 'high' }), 7);

assert.ok('inner' in TRUSTED_QUICK_ACTIVITIES);
assert.ok(TRUSTED_QUICK_ACTIVITIES.mind.includes('Journaled'));
assert.ok(!TRUSTED_QUICK_ACTIVITIES.inner.includes('Journaled'));

assert.ok(inferMatchingCategories('Meditated for 15 minutes', '').includes('inner'));
assert.ok(!inferMatchingCategories('Meditated for 15 minutes', '').includes('mind'));
assert.ok(inferMatchingCategories('Did a gratitude exercise', '').includes('inner'));
assert.ok(
  inferMatchingCategories(
    'Spent 20 minutes intentionally decompressing after a stressful day',
    ''
  ).includes('inner')
);
assert.ok(inferMatchingCategories('Read 21 pages', '').includes('mind'));
assert.ok(!inferMatchingCategories('Read 21 pages', '').includes('inner'));

assert.equal(
  attributionShareForCategory(
    { category: 'inner', categories: ['inner'], activity: 'Meditated', details: '' },
    'inner'
  ),
  1
);

const innerLog = {
  date: '2026-09-11',
  points: 5,
  category: 'inner' as CategoryKey,
  categories: ['inner'] as CategoryKey[],
  activity: 'Meditated',
  details: '',
};
const discipline = calculateDisciplineScore({
  logs: [innerLog],
  priorities: defaults,
  today: '2026-09-11',
});
assert.ok(Number.isFinite(discipline));
assert.ok(discipline >= 0 && discipline <= 100);
assert.ok(discipline > 0);

assert.equal(V1_TO_LEGACY_KEY['Inner Wellbeing'], 'inner');
assert.equal(LEGACY_KEY_TO_V1.inner, 'Inner Wellbeing');

console.log(
  JSON.stringify(
    {
      ok: true,
      productionCount: 11,
      innerKey: 'inner',
      innerDefaultPriority: 'normal',
    },
    null,
    2
  )
);
