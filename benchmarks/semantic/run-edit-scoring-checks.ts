/**
 * Phase 2 edit-scoring: preserve historical XP on metadata-only edits.
 * Does not load MiniLM or change priority math.
 */
import assert from 'assert';
import { applyEditIfAccepted } from '../../lib/evaluation/composerPersistence';
import { decideCustomComposerSubmit } from '../../lib/evaluation/customComposerGateDecision';
import {
  categorySelectionEquals,
  editRequiresRescore,
  logHasEvidenceImage,
  resolveEditedPoints,
  type EditCreditSnapshot,
} from '../../lib/evaluation/editScoring';
import type { CategoryKey } from '../../lib/evaluation/legacyEvaluator';
import type { PriorityMap } from '../../lib/evaluation/priorityReward';

const physical: CategoryKey = 'physical';
const fashion: CategoryKey = 'fashion';

const allNormal: PriorityMap = {
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

const previous: EditCreditSnapshot = {
  activity: 'Ran 5k',
  details: '',
  categories: [physical],
  hasImage: false,
  points: 5,
};

const sameClaim = {
  activity: previous.activity,
  details: previous.details,
  categories: previous.categories,
  hasImage: previous.hasImage,
};

assert.equal(editRequiresRescore(previous, sameClaim), false);
assert.equal(
  resolveEditedPoints({
    previous,
    next: sameClaim,
    priorities: { ...allNormal, physical: 'critical' },
  }),
  5
);

const previousSeven: EditCreditSnapshot = {
  ...previous,
  details: 'Negative splits, 24:10.',
  points: 7,
};
assert.equal(
  resolveEditedPoints({
    previous: previousSeven,
    next: {
      activity: previousSeven.activity,
      details: previousSeven.details,
      categories: previousSeven.categories,
      hasImage: false,
    },
    priorities: { ...allNormal, physical: 'maintenance' },
  }),
  7
);

const semanticNext = {
  activity: 'Studied organic chemistry for 90 minutes',
  details: 'Finished the problem set.',
  categories: ['academics'] as CategoryKey[],
  hasImage: false,
};
assert.equal(editRequiresRescore(previous, semanticNext), true);
assert.equal(
  resolveEditedPoints({
    previous,
    next: semanticNext,
    priorities: { ...allNormal, academics: 'critical' },
  }),
  9
);

assert.equal(categorySelectionEquals([physical, fashion], [fashion, physical]), true);
assert.equal(
  editRequiresRescore(previous, {
    ...sameClaim,
    categories: [fashion],
  }),
  true
);
assert.equal(
  resolveEditedPoints({
    previous,
    next: { ...sameClaim, categories: [fashion] },
    priorities: { ...allNormal, fashion: 'high' },
  }),
  6
);

const rejected = decideCustomComposerSubmit({
  clarificationPass: false,
  clarificationText: '',
  status: 'NON_DEVELOPMENTAL',
});
const original = { id: '1', points: 5 };
const attempted = { id: '1', points: 9 };
assert.deepEqual(
  applyEditIfAccepted({
    original,
    next: attempted,
    decision: rejected,
    points: 9,
  }),
  original
);

assert.equal(
  editRequiresRescore(previous, { ...sameClaim, hasImage: true }),
  true
);
assert.equal(
  resolveEditedPoints({
    previous,
    next: { ...sameClaim, hasImage: true },
    priorities: allNormal,
  }),
  7
);
assert.equal(
  resolveEditedPoints({
    previous: { ...previous, details: 'Track workout, 8x400.', points: 7 },
    next: {
      activity: 'Ran 5k',
      details: '',
      categories: [physical],
      hasImage: false,
    },
    priorities: allNormal,
  }),
  5
);

assert.equal(logHasEvidenceImage({ imagePath: 'user/log.jpg' }), true);
assert.equal(logHasEvidenceImage({}), false);

const stored = [
  { id: 'a', points: 5 },
  { id: 'b', points: 7 },
];
const afterDelete = stored.filter((log) => log.id !== 'a');
assert.equal(
  afterDelete.reduce((sum, log) => sum + log.points, 0),
  7
);

console.log(
  JSON.stringify(
    {
      ok: true,
      metadataOnly: 'preserves stored points',
      creditBearing: 'recalculates with current priorities',
      rejectedEdit: 'original points unchanged',
    },
    null,
    2
  )
);
