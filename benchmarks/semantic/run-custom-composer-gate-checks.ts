import assert from 'assert';
import { calculateDeterministicBasePoints, calculateLogPoints } from '../../lib/evaluation/legacyEvaluator';
import { isDeterministicInvalid } from '../../lib/evaluation/developmentalProductPolicy';
import {
  COMPOSER_GATE_COPY,
  composeClarificationSemanticText,
  composeSemanticLogText,
  isComposerSemanticInputInvalid,
  persistDetailsAfterGate,
  shouldResetClarificationSession,
} from '../../lib/evaluation/customComposerSemantic';
import {
  decideCustomComposerSubmit,
  wouldCallOnSave,
} from '../../lib/evaluation/customComposerGateDecision';
import {
  applyEditIfAccepted,
  canPersistComposerResult,
  shouldReevaluateEditedLog,
} from '../../lib/evaluation/composerPersistence';
import {
  evaluateComposerSubmission,
  evaluateDevelopmentalAction,
  setDevelopmentalActionEvaluatorForTests,
} from '../../lib/evaluation/developmentalGate';
import {
  applyComposerGateDecisionToUi,
  isRepeatedCharacterSpam,
  resolveComposerSubmitPrecheck,
} from '../../lib/evaluation/customComposerSubmit';
import { clarificationExplicitlyDeniesAction } from '../../lib/evaluation/clarificationDenial';
import { clarificationIsTrivial } from '../../lib/evaluation/clarificationTrivial';
import {
  canBypassSemanticGateForQuickClaim,
  isTrustedQuickClaim,
  TRUSTED_QUICK_ACTIVITIES,
} from '../../lib/evaluation/trustedQuickActivities';

function persistCalled(decision: ReturnType<typeof decideCustomComposerSubmit>, points: number) {
  return canPersistComposerResult(decision, points);
}

function mainSync() {
  assert.strictEqual(composeSemanticLogText('  Ran 5k  ', ''), 'Ran 5k');
  assert.strictEqual(
    composeSemanticLogText('Ran 5k', ' Negative split '),
    'Ran 5k\nNegative split'
  );
  assert.strictEqual(
    composeClarificationSemanticText('Ran 5k', 'Negative split, 24:10'),
    'Original action:\nRan 5k\n\nAdditional context:\nNegative split, 24:10'
  );
  assert.strictEqual(
    persistDetailsAfterGate({
      details: 'vague',
      clarificationPass: true,
      clarificationText: 'Finished a problem set',
    }),
    'vague\nFinished a problem set'
  );

  assert.ok(!isDeterministicInvalid('Meditated'));
  assert.ok(!isDeterministicInvalid('Ran 5k'));
  assert.ok(!isDeterministicInvalid('Studied calculus'));
  assert.ok(!isDeterministicInvalid('Lifted'));
  assert.ok(!isDeterministicInvalid('Read'));
  assert.ok(!isDeterministicInvalid('Practiced guitar'));
  assert.ok(!isDeterministicInvalid('Practiced guitar for 30 minutes'));
  assert.ok(!isDeterministicInvalid('Read 20 pages'));
  assert.ok(!isDeterministicInvalid('Worked on my project'));
  assert.ok(!isDeterministicInvalid('Made progress on my career portfolio'));
  assert.ok(!isDeterministicInvalid('Career fair preparation'));
  assert.ok(!isDeterministicInvalid('Had a really really good workout'));
  assert.ok(!isDeterministicInvalid('Run run club practice'));
  assert.ok(!isDeterministicInvalid('CS240 lab'));
  assert.ok(!isDeterministicInvalid('LeetCode two sum'));
  assert.ok(!isDeterministicInvalid('Saved $500 this month'));
  assert.ok(!isDeterministicInvalid('Did 100 pushups'));
  assert.ok(!isDeterministicInvalid('Ran 10 miles'));
  assert.ok(!isDeterministicInvalid('Studied for 6 hours'));

  assert.ok(isDeterministicInvalid('aaaaaaaaaa'));
  assert.ok(isDeterministicInvalid('zzzzzzzzzzzzzz'));
  assert.ok(isDeterministicInvalid('   '));
  assert.ok(isDeterministicInvalid('...'));
  assert.ok(isDeterministicInvalid('!!!!'));
  assert.ok(isDeterministicInvalid('good good good good good good good'));
  assert.ok(isDeterministicInvalid('career career career career career'));
  assert.ok(
    isDeterministicInvalid(
      'progress progress progress progress improvement improvement improvement'
    )
  );
  assert.ok(
    isDeterministicInvalid(
      'development improvement progress development improvement progress'
    )
  );
  assert.ok(
    isDeterministicInvalid(
      'productive growth discipline progress improvement development'
    )
  );
  assert.ok(isDeterministicInvalid('aaaaaaaaaa'));
  assert.ok(isComposerSemanticInputInvalid('aaaaaaaaaa', ''));
  assert.ok(isComposerSemanticInputInvalid('aaaaaaaaaa', ' leftover notes '));
  assert.ok(!isComposerSemanticInputInvalid('Meditated', ''));
  assert.equal(composeSemanticLogText('aaaaaaaaaa', ''), 'aaaaaaaaaa');
  assert.equal(
    composeSemanticLogText('aaaaaaaaaa', ' leftover notes '),
    'aaaaaaaaaa\nleftover notes'
  );

  assert.strictEqual(calculateDeterministicBasePoints('', false), 5);
  assert.strictEqual(calculateDeterministicBasePoints('Did 5x5 squats at 185', false), 7);
  const legacyGeneric = calculateLogPoints(['physical'], 'Ran', '', false);
  assert.ok(legacyGeneric < 5);

  for (const text of Object.values(COMPOSER_GATE_COPY)) {
    assert.equal(/p_dev|pDev|INVALID|NON_DEVELOPMENTAL/.test(text), false);
  }

  const original = { id: '1', activity: 'Ran 5k', points: 6 };
  const next = { id: '1', activity: 'Did nothing', points: 5 };

  const non = decideCustomComposerSubmit({
    clarificationPass: false,
    clarificationText: '',
    status: 'NON_DEVELOPMENTAL',
  });
  assert.equal(persistCalled(non, 5), false);
  assert.deepEqual(applyEditIfAccepted({ original, next, decision: non, points: 5 }), original);

  const invalid = decideCustomComposerSubmit({
    clarificationPass: false,
    clarificationText: '',
    status: 'INVALID',
  });
  assert.equal(persistCalled(invalid, 5), false);
  assert.deepEqual(applyEditIfAccepted({ original, next, decision: invalid, points: 5 }), original);

  const uncertain = decideCustomComposerSubmit({
    clarificationPass: false,
    clarificationText: '',
    status: 'UNCERTAIN',
  });
  assert.equal(wouldCallOnSave(uncertain), false);
  assert.equal(persistCalled(uncertain, 5), false);

  const technical = decideCustomComposerSubmit({
    clarificationPass: false,
    clarificationText: '',
    status: 'TECHNICAL_FAILURE',
  });
  assert.equal(persistCalled(technical, 5), false);
  assert.equal(wouldCallOnSave(technical), false);
  assert.equal(technical.kind, 'reject');
  if (technical.kind === 'reject') {
    assert.equal(technical.notice, 'technical');
  }
  assert.deepEqual(
    applyEditIfAccepted({ original, next, decision: technical, points: 5 }),
    original
  );

  const uncertainThenUncertain = decideCustomComposerSubmit({
    clarificationPass: true,
    clarificationText: 'idk',
    status: 'UNCERTAIN',
  });
  assert.equal(persistCalled(uncertainThenUncertain, 5), false);
  assert.deepEqual(
    applyEditIfAccepted({ original, next, decision: uncertainThenUncertain, points: 5 }),
    original
  );

  const uncertainThenNon = decideCustomComposerSubmit({
    clarificationPass: true,
    clarificationText: 'sat around',
    status: 'NON_DEVELOPMENTAL',
  });
  assert.equal(persistCalled(uncertainThenNon, 5), false);
  assert.deepEqual(
    applyEditIfAccepted({ original, next, decision: uncertainThenNon, points: 5 }),
    original
  );

  const dev = decideCustomComposerSubmit({
    clarificationPass: false,
    clarificationText: '',
    status: 'DEVELOPMENTAL',
  });
  assert.equal(persistCalled(dev, 6), true);
  assert.deepEqual(applyEditIfAccepted({ original, next, decision: dev, points: 6 }), next);
  assert.equal(persistCalled(dev, 0), false);

  const uncertainThenDev = decideCustomComposerSubmit({
    clarificationPass: true,
    clarificationText: 'Completed a 90-minute problem set',
    status: 'DEVELOPMENTAL',
  });
  assert.equal(persistCalled(uncertainThenDev, 7), true);

  assert.equal(
    shouldReevaluateEditedLog({
      existingPoints: 6,
      existingSemanticText: 'Ran 5k',
      nextSemanticText: 'Ran 5k',
    }),
    false
  );
  assert.equal(
    shouldReevaluateEditedLog({
      existingPoints: 6,
      existingSemanticText: 'Ran 5k',
      nextSemanticText: 'Did nothing',
    }),
    true
  );
  assert.equal(
    shouldReevaluateEditedLog({
      existingPoints: 0,
      existingSemanticText: 'asdf',
      nextSemanticText: 'asdf',
    }),
    true
  );

  assert.equal(shouldResetClarificationSession('Ran 5k', 'Ran 6k'), true);

  assert.equal(isTrustedQuickClaim('physical', 'Ran'), true);
  assert.equal(canBypassSemanticGateForQuickClaim('physical', 'Ran'), true);
  assert.equal(canBypassSemanticGateForQuickClaim('academics', 'Study session'), true);
  assert.equal(canBypassSemanticGateForQuickClaim('physical', 'Did nothing all day'), false);
  assert.equal(canBypassSemanticGateForQuickClaim('physical', 'Study session'), false);
  assert.equal(canBypassSemanticGateForQuickClaim('physical', 'Ran '), false);
  assert.equal(canBypassSemanticGateForQuickClaim('physical', 'ran'), false);

  const freeTextNon = decideCustomComposerSubmit({
    clarificationPass: false,
    clarificationText: '',
    status: 'NON_DEVELOPMENTAL',
  });
  assert.equal(canBypassSemanticGateForQuickClaim('mind', 'Watched random videos'), false);
  assert.equal(canPersistComposerResult(freeTextNon, 5), false);
  assert.equal(canPersistComposerResult(dev, 6), true);

  const trustedCount = Object.values(TRUSTED_QUICK_ACTIVITIES).reduce(
    (sum, list) => sum + list.length,
    0
  );
  assert.equal(trustedCount, 30);

  assert.equal('aaaaaaaaaa'.length, 10);
  assert.equal(isRepeatedCharacterSpam('aaaaaaaaaa'), true);
  assert.equal(isRepeatedCharacterSpam('aaaaaaaaa'), false);
  assert.equal(isRepeatedCharacterSpam('Meditated'), false);

  const liveSpamClick = resolveComposerSubmitPrecheck({
    activity: 'aaaaaaaaaa',
    details: '',
    awaitingClarification: false,
    frozenOriginalText: null,
    clarificationText: '',
  });
  assert.deepEqual(liveSpamClick, { type: 'invalid' });

  const liveSpamWithStaleUncertain = resolveComposerSubmitPrecheck({
    activity: 'aaaaaaaaaa',
    details: '',
    awaitingClarification: true,
    frozenOriginalText: 'Ran 5k',
    clarificationText: '',
  });
  assert.deepEqual(liveSpamWithStaleUncertain, { type: 'invalid' });

  const invalidUi = applyComposerGateDecisionToUi({
    clarificationPass: false,
    status: 'INVALID',
  });
  assert.equal(invalidUi.persist, false);
  assert.equal(invalidUi.awaitingClarification, false);
  assert.equal(invalidUi.gateNotice, 'invalid');

  const uncertainUi = applyComposerGateDecisionToUi({
    clarificationPass: false,
    status: 'UNCERTAIN',
  });
  assert.equal(uncertainUi.persist, false);
  assert.equal(uncertainUi.awaitingClarification, true);
  assert.equal(uncertainUi.gateNotice, 'uncertain');

  const denialAudit = [
    [false, "I didn't run until later, then I completed the 5k."],
    [false, 'I never felt more focused after studying for two hours.'],
    [false, 'I talked about running first, then I actually went out and completed the run.'],
    [false, "I didn't plan to lift, but I ended up completing the workout."],
    [false, "I haven't skipped a workout all week."],
    [false, 'I never missed my study session.'],
    [false, 'I did not give up; I finished the entire run.'],
    [false, "I didn't just practice guitar, I also learned a new song."],
    [false, 'I thought about skipping the workout, but I trained anyway.'],
    [false, 'I meant to stop early, but I finished the full session.'],
    [false, 'I was going to skip studying, but I changed my mind and studied for two hours.'],
    [false, "I didn't study in the morning; I studied for three hours that night."],
    [false, 'I never thought I could run that far, but I completed the 10k.'],
    [false, "I haven't felt this productive in weeks; I finished the assignment today."],
    [false, 'I just talked about the plan earlier, but then I actually completed it.'],
    [true, "I didn't run at all."],
    [true, 'I did not actually study.'],
    [true, 'I never completed the workout.'],
    [true, "I haven't practiced guitar."],
    [true, 'I have not applied yet.'],
    [true, "I planned to run but didn't."],
    [true, "I meant to study but never did."],
    [true, "I thought about working out but didn't."],
    [true, "I was going to apply but didn't."],
    [true, 'I only talked about practicing guitar.'],
    [true, 'I just talked about running.'],
    [true, "I talked about studying, but I didn't actually study."],
    [true, 'I considered lifting, but I never lifted.'],
    [true, "I wanted to meditate, but I didn't."],
    [true, 'I meant to save money, but I spent it instead.'],
  ] as const;
  for (const [expected, text] of denialAudit) {
    assert.equal(clarificationExplicitlyDeniesAction(text), expected, text);
  }

  const denialBlocks = [
    "I didn't actually train, I was just talking about running.",
    'I did not study calculus.',
    'I never lifted today.',
    "I haven't studied for the exam.",
    "I planned to meditate but didn't.",
    'I only talked about practicing guitar.',
    "I thought about reaching out but didn't.",
    'I meant to save money but spent it.',
    "I was going to update my résumé but didn't.",
    'I just talked about running.',
    'I have not studied for the exam.',
  ];
  for (const text of denialBlocks) {
    assert.equal(clarificationExplicitlyDeniesAction(text), true, text);
  }

  const denialAllows = [
    "I didn't give up and finished my run.",
    "I didn't miss my workout.",
    "I didn't just run, I also lifted.",
    "I wasn't going to train, but I changed my mind and completed the workout.",
    'I thought about skipping it, but I studied for two hours.',
  ];
  for (const text of denialAllows) {
    assert.equal(clarificationExplicitlyDeniesAction(text), false, text);
  }

  const denialNon = decideCustomComposerSubmit({
    clarificationPass: true,
    clarificationText: "I didn't actually train, I was just talking about running.",
    status: 'NON_DEVELOPMENTAL',
  });
  assert.equal(persistCalled(denialNon, 6), false);
  assert.equal(wouldCallOnSave(denialNon), false);

  const trivialTrue = [
    'idk',
    "i don't know",
    "I don't know",
    'dont know',
    'not sure',
    'maybe',
    'yeah',
    'yes',
    'no',
    'ok',
    'okay',
    'lol',
    'whatever',
    'nothing',
    'n/a',
    'na',
    '?',
    '...',
    '???',
    '.....',
    'asdf',
    'test',
    'because',
    'I guess',
    'hard to explain',
  ];
  for (const text of trivialTrue) {
    assert.equal(clarificationIsTrivial(text), true, text);
  }

  const trivialFalse = [
    '30 minutes',
    '5 miles',
    'new PR',
    'faster pace',
    'with my trainer',
    'before class',
    'after work',
    'finished chapter 4',
    'studied for 2 hours',
    'completed the full run',
    'improved my pace',
    'first time running 5k',
    'ran without stopping',
    'worked on recursion problems',
    'practiced scales',
    'saved $50',
    'applied to Google',
    'cooked dinner',
    'called my friend',
    "I didn't actually train, I was just talking about running.",
    "I didn't run until later, then I completed the 5k.",
  ];
  for (const text of trivialFalse) {
    assert.equal(clarificationIsTrivial(text), false, text);
  }

  assert.equal(
    clarificationExplicitlyDeniesAction("I didn't actually train, I was just talking about running."),
    true
  );
  assert.equal(
    clarificationExplicitlyDeniesAction("I didn't run until later, then I completed the 5k."),
    false
  );
}

async function mainAsync() {
  for (const text of ['Meditated', 'Ran 5k', 'Studied calculus']) {
    const result = await evaluateDevelopmentalAction(text);
    assert.notEqual(result.status, 'INVALID');
    assert.notEqual(result.status, 'TECHNICAL_FAILURE');
  }

  const spamEmptyDetails = await evaluateComposerSubmission({
    activity: 'aaaaaaaaaa',
    details: '',
  });
  assert.equal(spamEmptyDetails.status, 'INVALID');
  assert.equal(spamEmptyDetails.pDev, null);

  const spamWithDetails = await evaluateComposerSubmission({
    activity: 'aaaaaaaaaa',
    details: ' leftover notes ',
  });
  assert.equal(spamWithDetails.status, 'INVALID');
  assert.equal(spamWithDetails.pDev, null);

  const composedThenGate = await evaluateDevelopmentalAction(
    composeSemanticLogText('aaaaaaaaaa', '')
  );
  assert.equal(composedThenGate.status, 'INVALID');

  const stuffingClick = resolveComposerSubmitPrecheck({
    activity: 'career career career career career',
    details: '',
    awaitingClarification: false,
    frozenOriginalText: null,
    clarificationText: '',
  });
  assert.deepEqual(stuffingClick, { type: 'invalid' });

  setDevelopmentalActionEvaluatorForTests(async () => {
    throw new Error('MiniLM should not run for INVALID');
  });
  try {
    const stuffingEval = await evaluateComposerSubmission({
      activity: 'career career career career career',
      details: '',
    });
    assert.equal(stuffingEval.status, 'INVALID');
    assert.equal(stuffingEval.pDev, null);
    const stuffingUi = applyComposerGateDecisionToUi({
      clarificationPass: false,
      status: stuffingEval.status,
    });
    assert.equal(stuffingUi.persist, false);
    assert.equal(stuffingUi.gateNotice, 'invalid');
    const stuffingDecision = decideCustomComposerSubmit({
      clarificationPass: false,
      clarificationText: '',
      status: stuffingEval.status,
    });
    assert.equal(persistCalled(stuffingDecision, 5), false);
    assert.deepEqual(
      applyEditIfAccepted({
        original: { id: '1', activity: 'Ran 5k', points: 6 },
        next: { id: '1', activity: 'career career career career career', points: 5 },
        decision: stuffingDecision,
        points: 5,
      }),
      { id: '1', activity: 'Ran 5k', points: 6 }
    );

    const junkClarification = await evaluateComposerSubmission({
      activity: 'Ran 5k',
      details: '',
      clarificationPass: true,
      clarificationText: 'progress progress progress progress progress',
    });
    assert.equal(junkClarification.status, 'INVALID');
    assert.equal(junkClarification.pDev, null);
  } finally {
    setDevelopmentalActionEvaluatorForTests(null);
  }

  setDevelopmentalActionEvaluatorForTests(async () => {
    throw new Error('forced MiniLM failure');
  });
  try {
    const technicalEval = await evaluateComposerSubmission({
      activity: 'Practiced guitar for 30 minutes',
      details: '',
    });
    assert.equal(technicalEval.status, 'TECHNICAL_FAILURE');
    assert.equal(technicalEval.pDev, null);
    assert.notEqual(technicalEval.status, 'NON_DEVELOPMENTAL');
    assert.notEqual(technicalEval.status, 'UNCERTAIN');
    assert.notEqual(technicalEval.status, 'DEVELOPMENTAL');

    const technicalUi = applyComposerGateDecisionToUi({
      clarificationPass: false,
      status: technicalEval.status,
    });
    assert.equal(technicalUi.persist, false);
    assert.equal(technicalUi.gateNotice, 'technical');
    assert.equal(technicalUi.awaitingClarification, false);

    const technicalDecision = decideCustomComposerSubmit({
      clarificationPass: false,
      clarificationText: '',
      status: technicalEval.status,
    });
    assert.equal(persistCalled(technicalDecision, 7), false);
    assert.equal(wouldCallOnSave(technicalDecision), false);
    assert.deepEqual(
      applyEditIfAccepted({
        original: { id: 'g1', activity: 'Practiced guitar for 30 minutes', points: 6 },
        next: { id: 'g1', activity: 'Changed activity', points: 5 },
        decision: technicalDecision,
        points: 5,
      }),
      { id: 'g1', activity: 'Practiced guitar for 30 minutes', points: 6 }
    );
  } finally {
    setDevelopmentalActionEvaluatorForTests(null);
  }

  const firstPassRan5k = await evaluateComposerSubmission({
    activity: 'Ran 5k',
    details: '',
  });
  assert.equal(firstPassRan5k.status, 'UNCERTAIN');
  assert.equal(typeof firstPassRan5k.pDev, 'number');

  const trivialClarification = await evaluateComposerSubmission({
    activity: 'Ran 5k',
    details: '',
    clarificationPass: true,
    clarificationText: 'idk',
  });
  assert.equal(clarificationIsTrivial('idk'), true);
  assert.equal(trivialClarification.status, 'UNCERTAIN');
  assert.equal(trivialClarification.pDev, null);
  const trivialUi = applyComposerGateDecisionToUi({
    clarificationPass: true,
    status: trivialClarification.status,
  });
  assert.equal(trivialUi.persist, false);
  assert.equal(trivialUi.awaitingClarification, false);
  assert.equal(trivialUi.gateNotice, 'uncertain_rejected');

  const deniedClarification = await evaluateComposerSubmission({
    activity: 'Ran 5k',
    details: '',
    clarificationPass: true,
    clarificationText: "I didn't actually train, I was just talking about running.",
  });
  assert.equal(clarificationIsTrivial("I didn't actually train, I was just talking about running."), false);
  assert.equal(deniedClarification.status, 'NON_DEVELOPMENTAL');
  assert.equal(deniedClarification.pDev, null);

  const deniedUi = applyComposerGateDecisionToUi({
    clarificationPass: true,
    status: deniedClarification.status,
  });
  assert.equal(deniedUi.persist, false);
  assert.equal(deniedUi.awaitingClarification, false);
  assert.equal(deniedUi.gateNotice, 'non');

  const allowedClarification = await evaluateComposerSubmission({
    activity: 'Ran 5k',
    details: '',
    clarificationPass: true,
    clarificationText: "I didn't just run, I also lifted.",
  });
  assert.notEqual(allowedClarification.status, 'TECHNICAL_FAILURE');
  assert.equal(typeof allowedClarification.pDev, 'number');

  const contrastiveDelay = "I didn't run until later, then I completed the 5k.";
  assert.equal(clarificationIsTrivial(contrastiveDelay), false);
  assert.equal(clarificationExplicitlyDeniesAction(contrastiveDelay), false);
  const contrastiveClarification = await evaluateComposerSubmission({
    activity: 'Ran 5k',
    details: '',
    clarificationPass: true,
    clarificationText: contrastiveDelay,
  });
  assert.notEqual(contrastiveClarification.status, 'TECHNICAL_FAILURE');
  assert.equal(typeof contrastiveClarification.pDev, 'number');
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
