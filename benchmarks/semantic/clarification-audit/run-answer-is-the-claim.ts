/**
 * Second-pass specimen experiment.
 * Scores the clarification sentence alone with the frozen production gate.
 * Does not change production, thresholds, weights, or the locked audit rows.
 */
import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { CLARIFICATION_AUDIT_SCENARIOS } from './scenarios';

const ROOT = process.cwd();
const AUDIT_DIR = join(ROOT, 'benchmarks/semantic/clarification-audit');
const PREREG_PATH = join(AUDIT_DIR, 'preregistration.json');
const OLD_SUMMARY_PATH = join(AUDIT_DIR, 'results/summary.json');
const OUT_PATH = join(AUDIT_DIR, 'results/answer-is-the-claim.json');

const PRODUCTION_FILES = [
  'lib/evaluation/developmentalGate.ts',
  'lib/evaluation/actionEvidence.ts',
  'lib/evaluation/developmentalProductPolicy.ts',
  'lib/evaluation/twoAxisProductPolicy.ts',
  'lib/evaluation/clarificationTrivial.ts',
  'lib/evaluation/clarificationDenial.ts',
  'lib/evaluation/customComposerSemantic.ts',
  'lib/evaluation/customComposerGateDecision.ts',
  'lib/evaluation/customComposerSubmit.ts',
  'lib/evaluation/deterministicInvalid.ts',
  'lib/evaluation/semantic/weights/developmental-3a.2.json',
  'lib/evaluation/semantic/weights/action-evidence-mpnet.json',
];

const EXTRA_DIAGNOSTICS = ['watched Netflix for two hours', 'give me the XP'] as const;

type LockedScenario = {
  id: string;
  role: string;
  originalLog: string;
  clarification: string;
  clarificationType: string;
  goldFinal: 'CREDIT' | 'NO_CREDIT';
  actionValid: boolean;
  clarificationEstablishesCompletion: boolean;
};

type OldPass = {
  status: string;
  reason: string | null;
  pAction: number | null;
  pDev: number | null;
  decision: string;
  guard: string | null;
};

type OldRow = {
  id: string;
  rescueCohort: boolean;
  rescued: boolean;
  falseCreditAfterClarification: boolean;
  first: OldPass;
  second: OldPass | null;
};

function sha256(text: string) {
  return createHash('sha256').update(text).digest('hex');
}

function productionHashes() {
  const hashes: Record<string, string> = {};
  for (const relative of PRODUCTION_FILES) {
    hashes[relative] = sha256(readFileSync(join(ROOT, relative), 'utf8'));
  }
  return hashes;
}

type ClaimResult = {
  guard: string | null;
  status: string;
  reason: string | null;
  pAction: number | null;
  pDev: number | null;
  actionDecision: string | null;
  developmentalDecision: string | null;
  finalDecision: 'credit' | 'reject';
};

async function evaluateClarificationClaim(
  originalLog: string,
  clarification: string
): Promise<ClaimResult> {
  const { clarificationIsTrivial } = await import('../../../lib/evaluation/clarificationTrivial');
  const { clarificationExplicitlyDeniesAction } = await import(
    '../../../lib/evaluation/clarificationDenial'
  );
  const { isDeterministicInvalid } = await import('../../../lib/evaluation/deterministicInvalid');
  const { evaluateDevelopmentalAction } = await import('../../../lib/evaluation/developmentalGate');
  const {
    ACTION_EVIDENCE_CONFIDENT_NEGATIVE,
    ACTION_EVIDENCE_CONFIDENT_POSITIVE,
  } = await import('../../../lib/evaluation/actionEvidence');
  const { PRODUCT_DEV_MIN, PRODUCT_NON_MAX } = await import(
    '../../../lib/evaluation/developmentalProductPolicy'
  );

  if (
    ACTION_EVIDENCE_CONFIDENT_NEGATIVE !== 0.4407 ||
    ACTION_EVIDENCE_CONFIDENT_POSITIVE !== 0.6165 ||
    PRODUCT_NON_MAX !== 0.45 ||
    PRODUCT_DEV_MIN !== 0.55
  ) {
    throw new Error('Frozen thresholds do not match the experiment contract.');
  }

  if (clarificationIsTrivial(clarification, originalLog)) {
    return {
      guard: 'trivial',
      status: 'UNCERTAIN',
      reason: null,
      pAction: null,
      pDev: null,
      actionDecision: null,
      developmentalDecision: null,
      finalDecision: 'reject',
    };
  }
  if (isDeterministicInvalid(clarification)) {
    return {
      guard: 'deterministic_invalid',
      status: 'INVALID',
      reason: null,
      pAction: null,
      pDev: null,
      actionDecision: null,
      developmentalDecision: null,
      finalDecision: 'reject',
    };
  }
  if (clarificationExplicitlyDeniesAction(clarification)) {
    return {
      guard: 'explicit_denial',
      status: 'NON_DEVELOPMENTAL',
      reason: null,
      pAction: null,
      pDev: null,
      actionDecision: null,
      developmentalDecision: null,
      finalDecision: 'reject',
    };
  }

  const result = await evaluateDevelopmentalAction(clarification);
  let actionDecision: string | null = null;
  if (result.pAction != null) {
    if (result.pAction <= 0.4407) actionDecision = 'reject';
    else if (result.pAction >= 0.6165) actionDecision = 'confident_positive';
    else actionDecision = 'uncertain';
  }
  let developmentalDecision: string | null = null;
  if (result.pDev != null) {
    if (result.pDev <= 0.45) developmentalDecision = 'reject';
    else if (result.pDev >= 0.55) developmentalDecision = 'developmental';
    else developmentalDecision = 'uncertain';
  }

  const finalDecision = result.status === 'DEVELOPMENTAL' ? 'credit' : 'reject';
  return {
    guard: null,
    status: result.status,
    reason: result.reason ?? null,
    pAction: result.pAction ?? null,
    pDev: result.pDev ?? null,
    actionDecision,
    developmentalDecision,
    finalDecision,
  };
}

function roundDelta(value: number | null) {
  if (value == null || Number.isNaN(value)) return null;
  return Math.round(value * 1000) / 1000;
}

async function main() {
  const prereg = JSON.parse(readFileSync(PREREG_PATH, 'utf8')) as {
    scenarioHash: string;
    scenarioCount: number;
    scenarios: LockedScenario[];
    productionHashes: Record<string, string>;
  };
  const currentHash = sha256(JSON.stringify(CLARIFICATION_AUDIT_SCENARIOS));
  if (currentHash !== prereg.scenarioHash) {
    throw new Error('Locked clarification rows changed. Refusing to evaluate.');
  }
  const hashes = productionHashes();
  for (const relative of PRODUCTION_FILES) {
    if (hashes[relative] !== prereg.productionHashes[relative]) {
      throw new Error(`Production file changed since the locked audit: ${relative}`);
    }
  }

  const oldSummary = JSON.parse(readFileSync(OLD_SUMMARY_PATH, 'utf8')) as {
    rescueNumerator: number;
    rescueDenominator: number;
    falseCreditAfterClarification: number;
    rows: OldRow[];
  };
  const oldById = new Map(oldSummary.rows.map((row) => [row.id, row]));

  const evaluated = [];
  for (const scenario of prereg.scenarios) {
    const claim = await evaluateClarificationClaim(scenario.originalLog, scenario.clarification);
    const old = oldById.get(scenario.id);
    if (!old) throw new Error(`Missing baseline row ${scenario.id}`);
    evaluated.push({ scenario, claim, old });
  }

  const cohort = evaluated.filter((row) => row.old.rescueCohort);
  if (cohort.length !== 28) {
    throw new Error(`Expected the locked rescue cohort of 28, found ${cohort.length}.`);
  }
  const controls = evaluated.filter((row) => row.scenario.goldFinal === 'NO_CREDIT');
  if (controls.length !== 16) {
    throw new Error(`Expected 16 locked controls, found ${controls.length}.`);
  }

  const rescued = cohort.filter((row) => row.claim.finalDecision === 'credit');
  const failures = cohort.filter((row) => row.claim.finalDecision !== 'credit');
  const falseCredits = controls.filter((row) => row.claim.finalDecision === 'credit');
  const rate = rescued.length / cohort.length;

  let decision: 'PASS' | 'YELLOW' | 'FAIL' = 'FAIL';
  if (falseCredits.length > 0 || rate < 0.75) decision = 'FAIL';
  else if (rate >= 0.9) decision = 'PASS';
  else decision = 'YELLOW';

  const comparison = cohort.map((row) => {
    const oldAction = row.old.second?.pAction ?? null;
    const newAction = row.claim.pAction;
    return {
      id: row.scenario.id,
      original: row.scenario.originalLog,
      clarification: row.scenario.clarification,
      oldAction,
      newAction,
      delta: oldAction != null && newAction != null ? roundDelta(newAction - oldAction) : null,
      oldDevelopmental: row.old.second?.pDev ?? null,
      newDevelopmental: row.claim.pDev,
      developmentalDecision: row.claim.developmentalDecision,
      oldResult: row.old.rescued ? 'credit' : 'reject',
      newResult: row.claim.finalDecision,
      newStatus: row.claim.status,
      newReason: row.claim.reason,
      guard: row.claim.guard,
      actionDecision: row.claim.actionDecision,
    };
  });

  const deltas = comparison.map((row) => row.delta).filter((value): value is number => value != null);
  const controlScores = controls
    .map((row) => row.claim.pAction)
    .filter((value): value is number => value != null);
  const legitimateScores = comparison
    .map((row) => row.newAction)
    .filter((value): value is number => value != null);

  const extras = [];
  for (const text of EXTRA_DIAGNOSTICS) {
    extras.push({
      text,
      claim: await evaluateClarificationClaim('', text),
      countsTowardDenominator: false,
    });
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    specimen: 'clarification_sentence_only',
    firstPassUnchanged: true,
    planningContextInjected: false,
    scenarioHash: prereg.scenarioHash,
    productionUnchanged: true,
    thresholds: {
      actionRejectAtOrBelow: 0.4407,
      actionContinueAtOrAbove: 0.6165,
      developmentalRejectAtOrBelow: 0.45,
      developmentalCreditAtOrAbove: 0.55,
    },
    oldContract: {
      rescue: `${oldSummary.rescueNumerator}/${oldSummary.rescueDenominator}`,
      falseCredits: oldSummary.falseCreditAfterClarification,
    },
    newContract: {
      rescueNumerator: rescued.length,
      rescueDenominator: cohort.length,
      rescueRate: rate,
      falseCredits: falseCredits.length,
      falseCreditDenominator: controls.length,
      decision,
    },
    distribution: {
      legitimateActionMeanDelta: deltas.length
        ? roundDelta(deltas.reduce((sum, value) => sum + value, 0) / deltas.length)
        : null,
      legitimateMinNewAction: legitimateScores.length ? Math.min(...legitimateScores) : null,
      legitimateMaxNewAction: legitimateScores.length ? Math.max(...legitimateScores) : null,
      controlMinAction: controlScores.length ? Math.min(...controlScores) : null,
      controlMaxAction: controlScores.length ? Math.max(...controlScores) : null,
      creditedLegitimate: rescued.length,
      probeRanLegitimate: legitimateScores.length,
    },
    comparison,
    failures: failures.map((row) => ({
      id: row.scenario.id,
      clarification: row.scenario.clarification,
      pAction: row.claim.pAction,
      actionDecision: row.claim.actionDecision,
      pDev: row.claim.pDev,
      developmentalDecision: row.claim.developmentalDecision,
      status: row.claim.status,
      reason: row.claim.reason,
      guard: row.claim.guard,
    })),
    controls: controls.map((row) => ({
      id: row.scenario.id,
      type: row.scenario.role,
      clarification: row.scenario.clarification,
      guard: row.claim.guard,
      pAction: row.claim.pAction,
      actionDecision: row.claim.actionDecision,
      pDev: row.claim.pDev,
      developmentalDecision: row.claim.developmentalDecision,
      status: row.claim.status,
      reason: row.claim.reason,
      finalDecision: row.claim.finalDecision,
    })),
    falseCreditIds: falseCredits.map((row) => row.scenario.id),
    extras,
  };

  writeFileSync(OUT_PATH, JSON.stringify(summary, null, 2));
  console.log(
    JSON.stringify(
      {
        rescue: `${summary.newContract.rescueNumerator}/${summary.newContract.rescueDenominator}`,
        rescueRate: summary.newContract.rescueRate,
        falseCredits: `${summary.newContract.falseCredits}/${summary.newContract.falseCreditDenominator}`,
        decision: summary.newContract.decision,
        failureIds: summary.failures.map((row) => row.id),
        falseCreditIds: summary.falseCreditIds,
        extras: summary.extras.map((row) => ({
          text: row.text,
          finalDecision: row.claim.finalDecision,
          pAction: row.claim.pAction,
          pDev: row.claim.pDev,
          status: row.claim.status,
        })),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
