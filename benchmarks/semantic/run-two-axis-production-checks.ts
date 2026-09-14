/**
 * Production two-axis regression checks.
 * Validates P1 mapping and live evaluateComposerSubmission behavior.
 * Does not rescore or alter the official final challenge.
 */
import assert from 'assert';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ACTION_EVIDENCE_BINARY_THRESHOLD,
  ACTION_EVIDENCE_CONFIDENT_NEGATIVE,
  ACTION_EVIDENCE_CONFIDENT_POSITIVE,
  evaluateActionEvidence,
  mapActionProbabilityToBand,
  needsFirstPassClarification,
} from '../../lib/evaluation/actionEvidence';
import {
  applyComposerGateDecisionToUi,
} from '../../lib/evaluation/customComposerSubmit';
import {
  decideCustomComposerSubmit,
  wouldCallOnSave,
} from '../../lib/evaluation/customComposerGateDecision';
import { canPersistComposerResult } from '../../lib/evaluation/composerPersistence';
import {
  evaluateComposerSubmission,
  productProbeIdentity,
  setDevelopmentalActionEvaluatorForTests,
} from '../../lib/evaluation/developmentalGate';
import { PRODUCT_PROBE_FILE } from '../../lib/evaluation/developmentalProductPolicy';
import {
  applyTwoAxisProductPolicy,
  mapTwoAxisOutcomeToGateStatus,
  type DevelopmentalEvidenceBand,
} from '../../lib/evaluation/twoAxisProductPolicy';
import { calculateDeterministicBasePoints } from '../../lib/evaluation/legacyEvaluator';
import { applyPriorityReward } from '../../lib/evaluation/priorityReward';
import { SLAYED_PRODUCTION_DETAILS } from './datasets/action-evidence-v1/exam-controls';

const EXPECTED_WEIGHT_FINGERPRINT =
  '72c03aa4638160895cd0bc7d6bf06b1b2914f226208aad82a3ccfe01ccbe657a';

const ACTION_BANDS = [
  'CONFIDENT_ACTION_NEGATIVE',
  'ACTION_UNCERTAIN',
  'CONFIDENT_ACTION_POSITIVE',
] as const;
const DEV_BANDS: DevelopmentalEvidenceBand[] = [
  'NON_DEVELOPMENTAL',
  'DEVELOPMENTAL_UNCERTAIN',
  'DEVELOPMENTAL',
];

function sha256File(path: string) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function persistCalled(decision: ReturnType<typeof decideCustomComposerSubmit>, points: number) {
  return canPersistComposerResult(decision, points);
}

function mainSync() {
  assert.equal(ACTION_EVIDENCE_BINARY_THRESHOLD, 0.52);
  assert.equal(ACTION_EVIDENCE_CONFIDENT_NEGATIVE, 0.4407);
  assert.equal(ACTION_EVIDENCE_CONFIDENT_POSITIVE, 0.6165);
  assert.equal(mapActionProbabilityToBand(0.4407), 'CONFIDENT_ACTION_NEGATIVE');
  assert.equal(mapActionProbabilityToBand(0.4407000001), 'ACTION_UNCERTAIN');
  assert.equal(mapActionProbabilityToBand(0.52), 'ACTION_UNCERTAIN');
  assert.equal(mapActionProbabilityToBand(0.6164999999), 'ACTION_UNCERTAIN');
  assert.equal(mapActionProbabilityToBand(0.6165), 'CONFIDENT_ACTION_POSITIVE');
  assert.equal(mapActionProbabilityToBand(0.2874), 'CONFIDENT_ACTION_NEGATIVE');

  assert.equal(needsFirstPassClarification('i learned', ''), true);
  assert.equal(needsFirstPassClarification('Slayed', SLAYED_PRODUCTION_DETAILS), false);

  const identity = productProbeIdentity();
  assert.equal(identity.file, PRODUCT_PROBE_FILE);
  assert.equal(identity.evaluator, 'candidate-developmental-3a.2');
  assert.equal(identity.l2, 0.01);
  assert.equal(identity.learningRate, 0.4);
  assert.equal(identity.epochs, 400);

  const probe = JSON.parse(
    readFileSync(join(process.cwd(), 'lib/evaluation/semantic/weights/action-evidence-mpnet.json'), 'utf8')
  ) as { weights: number[]; bias: number; embeddingDim: number; modelId: string };
  assert.equal(probe.modelId, 'Xenova/all-mpnet-base-v2');
  assert.equal(probe.embeddingDim, 768);
  assert.equal(probe.weights.length, 768);
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ weights: probe.weights, bias: probe.bias }))
    .digest('hex');
  assert.equal(fingerprint, EXPECTED_WEIGHT_FINGERPRINT);

  const frozen3a2 = sha256File(
    join(process.cwd(), 'lib/evaluation/semantic/weights/developmental-3a.2.json')
  );
  assert.equal(typeof frozen3a2, 'string');
  assert.equal(frozen3a2.length, 64);

  for (const action of ACTION_BANDS) {
    for (const developmental of DEV_BANDS) {
      const outcome =
        action === 'CONFIDENT_ACTION_POSITIVE'
          ? applyTwoAxisProductPolicy(action, developmental)
          : applyTwoAxisProductPolicy(action);
      if (action === 'CONFIDENT_ACTION_NEGATIVE') {
        assert.equal(outcome, 'NO_CREDIT_ACTION_EVIDENCE');
        assert.notEqual(outcome, 'CREDIT');
      }
      if (action === 'ACTION_UNCERTAIN') {
        assert.equal(outcome, 'CLARIFICATION');
        assert.notEqual(outcome, 'CREDIT');
      }
      if (action === 'CONFIDENT_ACTION_POSITIVE' && developmental === 'NON_DEVELOPMENTAL') {
        assert.equal(outcome, 'NO_CREDIT_NON_DEVELOPMENTAL');
      }
      if (action === 'CONFIDENT_ACTION_POSITIVE' && developmental === 'DEVELOPMENTAL_UNCERTAIN') {
        assert.equal(outcome, 'CLARIFICATION');
      }
      if (action === 'CONFIDENT_ACTION_POSITIVE' && developmental === 'DEVELOPMENTAL') {
        assert.equal(outcome, 'CREDIT');
      }
      if (outcome === 'CREDIT') {
        assert.equal(action, 'CONFIDENT_ACTION_POSITIVE');
        assert.equal(developmental, 'DEVELOPMENTAL');
      }
    }
  }

  assert.equal(mapTwoAxisOutcomeToGateStatus('CREDIT'), 'DEVELOPMENTAL');
  assert.equal(mapTwoAxisOutcomeToGateStatus('CLARIFICATION'), 'UNCERTAIN');
  assert.equal(mapTwoAxisOutcomeToGateStatus('NO_CREDIT_NON_DEVELOPMENTAL'), 'NON_DEVELOPMENTAL');
  assert.equal(mapTwoAxisOutcomeToGateStatus('NO_CREDIT_ACTION_EVIDENCE'), 'NON_DEVELOPMENTAL');

  assert.equal(calculateDeterministicBasePoints('', false), 5);
  assert.equal(applyPriorityReward(5, ['physical'], { physical: 'critical' }), 7);
}

async function mainAsync() {
  setDevelopmentalActionEvaluatorForTests(async () => {
    throw new Error('MiniLM/MPNet should not run for structural first-pass');
  });
  try {
    const learned = await evaluateComposerSubmission({
      activity: 'i learned',
      details: '',
    });
    assert.equal(learned.status, 'UNCERTAIN');
    assert.equal(learned.pDev, null);
    assert.equal(learned.reason, 'STRUCTURAL_FIRST_PASS');
    const learnedUi = applyComposerGateDecisionToUi({
      clarificationPass: false,
      status: learned.status,
    });
    assert.equal(learnedUi.persist, false);
    assert.equal(learnedUi.awaitingClarification, true);
    assert.equal(wouldCallOnSave(decideCustomComposerSubmit({
      clarificationPass: false,
      clarificationText: '',
      status: learned.status,
    })), false);
  } finally {
    setDevelopmentalActionEvaluatorForTests(null);
  }

  const slayed = await evaluateComposerSubmission({
    activity: 'Slayed',
    details: SLAYED_PRODUCTION_DETAILS,
  });
  assert.equal(slayed.status, 'NON_DEVELOPMENTAL');
  assert.equal(slayed.reason, 'NO_CREDIT_ACTION_EVIDENCE');
  assert.equal(slayed.pDev, null);
  assert.ok(typeof slayed.pAction === 'number');
  assert.ok(slayed.pAction <= ACTION_EVIDENCE_CONFIDENT_NEGATIVE);
  assert.equal(mapActionProbabilityToBand(slayed.pAction), 'CONFIDENT_ACTION_NEGATIVE');
  const slayedUi = applyComposerGateDecisionToUi({
    clarificationPass: false,
    status: slayed.status,
  });
  assert.equal(slayedUi.persist, false);
  assert.equal(slayedUi.awaitingClarification, false);
  assert.equal(slayedUi.gateNotice, 'non');
  assert.equal(
    persistCalled(
      decideCustomComposerSubmit({
        clarificationPass: false,
        clarificationText: '',
        status: slayed.status,
      }),
      5
    ),
    false
  );

  const pointer = await evaluateComposerSubmission({
    activity: 'I learned how pointer arithmetic works and completed five CS240 practice problems.',
    details: '',
  });
  assert.equal(pointer.status, 'DEVELOPMENTAL');
  assert.equal(pointer.reason, 'CREDIT');
  assert.equal(typeof pointer.pDev, 'number');
  assert.ok(typeof pointer.pAction === 'number');
  assert.equal(mapActionProbabilityToBand(pointer.pAction), 'CONFIDENT_ACTION_POSITIVE');
  assert.equal(
    applyComposerGateDecisionToUi({
      clarificationPass: false,
      status: pointer.status,
    }).persist,
    true
  );

  const outfit = await evaluateComposerSubmission({
    activity: 'Put together three outfits for my internship conference and practiced coordinating the pieces.',
    details: '',
  });
  assert.equal(outfit.status, 'DEVELOPMENTAL');
  assert.equal(outfit.reason, 'CREDIT');
  assert.equal(
    applyComposerGateDecisionToUi({
      clarificationPass: false,
      status: outfit.status,
    }).persist,
    true
  );

  const meditation = await evaluateComposerSubmission({
    activity: 'Meditated for 15 minutes.',
    details: '',
  });
  assert.equal(meditation.status, 'DEVELOPMENTAL');
  assert.equal(meditation.reason, 'CREDIT');

  const guitar = await evaluateComposerSubmission({
    activity: 'Practiced guitar for 30 minutes.',
    details: '',
  });
  assert.equal(guitar.status, 'DEVELOPMENTAL');
  assert.equal(guitar.reason, 'CREDIT');

  const journaling = await evaluateComposerSubmission({
    activity: "Journaled. Wrote about my goals and reflected on today's decisions.",
    details: '',
  });
  assert.equal(journaling.status, 'DEVELOPMENTAL');
  assert.equal(journaling.reason, 'CREDIT');

  const smart = await evaluateComposerSubmission({
    activity: "I'm so smart.",
    details: '',
  });
  assert.equal(smart.status, 'NON_DEVELOPMENTAL');
  assert.equal(smart.reason, 'NO_CREDIT_ACTION_EVIDENCE');
  assert.equal(smart.pDev, null);
  assert.ok(typeof smart.pAction === 'number');
  assert.equal(mapActionProbabilityToBand(smart.pAction), 'CONFIDENT_ACTION_NEGATIVE');
  assert.equal(
    applyComposerGateDecisionToUi({
      clarificationPass: false,
      status: smart.status,
    }).persist,
    false
  );

  const internships = await evaluateComposerSubmission({
    activity: 'Applied to 3 internships.',
    details: '',
  });
  assert.equal(internships.status, 'UNCERTAIN');
  assert.equal(internships.reason, 'CLARIFICATION');
  assert.notEqual(internships.status, 'DEVELOPMENTAL');
  const internshipsUi = applyComposerGateDecisionToUi({
    clarificationPass: false,
    status: internships.status,
  });
  assert.equal(internshipsUi.persist, false);
  assert.equal(internshipsUi.awaitingClarification, true);

  const skincare = await evaluateComposerSubmission({
    activity: 'Did my full skincare routine and applied moisturizer and sunscreen.',
    details: '',
  });
  assert.equal(skincare.status, 'UNCERTAIN');
  assert.equal(skincare.reason, 'CLARIFICATION');
  assert.equal(typeof skincare.pDev, 'number');
  assert.ok(typeof skincare.pAction === 'number');
  assert.equal(mapActionProbabilityToBand(skincare.pAction), 'CONFIDENT_ACTION_POSITIVE');

  const ordinary = await evaluateComposerSubmission({
    activity: 'Picked up a bottle of shampoo at the drugstore.',
    details: '',
  });
  assert.equal(ordinary.status, 'NON_DEVELOPMENTAL');
  assert.equal(ordinary.reason, 'NO_CREDIT_NON_DEVELOPMENTAL');
  assert.equal(typeof ordinary.pDev, 'number');
  assert.ok(typeof ordinary.pAction === 'number');
  assert.equal(mapActionProbabilityToBand(ordinary.pAction), 'CONFIDENT_ACTION_POSITIVE');
  assert.notEqual(ordinary.reason, 'NO_CREDIT_ACTION_EVIDENCE');

  const liveAction = await evaluateActionEvidence("I'm so smart.");
  assert.ok(liveAction.pAction <= ACTION_EVIDENCE_CONFIDENT_NEGATIVE);
  assert.equal(liveAction.band, 'CONFIDENT_ACTION_NEGATIVE');
}

async function main() {
  mainSync();
  await mainAsync();
  console.log(JSON.stringify({ ok: true }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
