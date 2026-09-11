/**
 * Deterministic Phase 2 priority-state normalization.
 * Does not load MiniLM or change reward math.
 */
import assert from 'assert';
import { categories, type CategoryKey } from '../../lib/evaluation/legacyEvaluator';
import { DEFAULT_PRIORITY } from '../../lib/evaluation/priorityReward';
import {
  buildOnboardingPriorityMap,
  CATEGORY_KEYS,
  createDefaultPriorityMap,
  normalizePriorityMap,
  parsePriorityMap,
} from '../../lib/evaluation/priorityState';

function assertAllKeys(map: Record<string, unknown>) {
  const keys = Object.keys(map).sort();
  const expected = [...CATEGORY_KEYS].sort();
  assert.deepEqual(keys, expected);
}

function assertAllNormal(map: ReturnType<typeof createDefaultPriorityMap>) {
  assertAllKeys(map);
  for (const key of CATEGORY_KEYS) {
    assert.equal(map[key], 'normal');
  }
}

const defaults = createDefaultPriorityMap();
assert.equal(CATEGORY_KEYS.length, categories.length);
assert.equal(defaults.academics, DEFAULT_PRIORITY);
assertAllNormal(defaults);
assert.equal('made_up_category' in defaults, false);

assertAllNormal(normalizePriorityMap(undefined));
assertAllNormal(normalizePriorityMap(null));
assertAllNormal(normalizePriorityMap({}));

const partial = normalizePriorityMap({ career: 'critical' });
assert.equal(partial.career, 'critical');
for (const key of CATEGORY_KEYS) {
  if (key !== 'career') assert.equal(partial[key], 'normal');
}

assert.equal(normalizePriorityMap({ career: 'banana' }).career, 'normal');
assert.equal(normalizePriorityMap({ academics: 42 }).academics, 'normal');
assert.equal(normalizePriorityMap({ physical: null }).physical, 'normal');

const unknownKeys = normalizePriorityMap({
  career: 'high',
  made_up_category: 'critical',
});
assert.equal(unknownKeys.career, 'high');
assert.equal('made_up_category' in unknownKeys, false);
assert.equal(unknownKeys.academics, 'normal');

const mixed = normalizePriorityMap({
  career: 'critical',
  academics: 'nope',
  physical: 'maintenance',
  mind: 0,
});
assert.equal(mixed.career, 'critical');
assert.equal(mixed.academics, 'normal');
assert.equal(mixed.physical, 'maintenance');
assert.equal(mixed.mind, 'normal');

assertAllNormal(normalizePriorityMap('critical'));
assertAllNormal(normalizePriorityMap(7));
assertAllNormal(normalizePriorityMap(['critical']));

const fullValid = {
  appearance: 'normal',
  fashion: 'maintenance',
  academics: 'critical',
  career: 'high',
  finance: 'normal',
  nutrition: 'high',
  social: 'maintenance',
  physical: 'high',
  mind: 'normal',
  spirituality: 'normal',
} as const;
assert.deepEqual(normalizePriorityMap(fullValid), { ...fullValid });

const onboarded = buildOnboardingPriorityMap(
  ['academics', 'career', 'physical'] as CategoryKey[],
  'academics'
);
assert.equal(onboarded.academics, 'critical');
assert.equal(onboarded.career, 'high');
assert.equal(onboarded.physical, 'high');
assert.equal(onboarded.fashion, 'maintenance');
assert.equal(onboarded.mind, 'maintenance');
assert.deepEqual(normalizePriorityMap(onboarded), onboarded);

assertAllNormal(parsePriorityMap(undefined));
assertAllNormal(parsePriorityMap('{not json'));
assert.equal(parsePriorityMap('{"career":"high"}').career, 'high');

console.log(
  JSON.stringify(
    {
      ok: true,
      default: 'all normal',
      missingFallback: 'normal',
      onboarding: 'maintenance / high / critical preserved',
    },
    null,
    2
  )
);
