/**
 * Measures the frozen production clarification contract.
 * Does not change thresholds, weights, or policy.
 *
 * preregister: write the locked set, then exit.
 * evaluate: refuse to run if scenarios.ts no longer matches that lock.
 */
import { createHash } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { CLARIFICATION_AUDIT_SCENARIOS, type ClarificationScenario } from './scenarios';

const ROOT = process.cwd();
const AUDIT_DIR = join(ROOT, 'benchmarks/semantic/clarification-audit');
const PREREG_PATH = join(AUDIT_DIR, 'preregistration.json');
const RESULTS_DIR = join(AUDIT_DIR, 'results');

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

function canonicalScenarios() {
  return JSON.stringify(CLARIFICATION_AUDIT_SCENARIOS);
}

type Preregistration = {
  createdAt: string;
  scenarioHash: string;
  scenarioCount: number;
  scenarios: ClarificationScenario[];
  productionHashes: Record<string, string>;
  note: string;
};

async function assertStructuralFlagsMatchCode() {
  const { needsFirstPassClarification } = await import('../../../lib/evaluation/actionEvidence');
  for (const scenario of CLARIFICATION_AUDIT_SCENARIOS) {
    const structural = needsFirstPassClarification(scenario.originalLog, '');
    if (structural !== scenario.structuralClarificationExpected) {
      throw new Error(
        `${scenario.id} structuralClarificationExpected=${scenario.structuralClarificationExpected} but production returns ${structural}. Fix the lock before preregistration.`
      );
    }
  }
}

async function writePreregistration() {
  await assertStructuralFlagsMatchCode();
  const payload: Preregistration = {
    createdAt: new Date().toISOString(),
    scenarioHash: sha256(canonicalScenarios()),
    scenarioCount: CLARIFICATION_AUDIT_SCENARIOS.length,
    scenarios: [...CLARIFICATION_AUDIT_SCENARIOS],
    productionHashes: productionHashes(),
    note: 'Gold labels locked before production evaluation. Do not edit scenarios after this file exists.',
  };
  writeFileSync(PREREG_PATH, JSON.stringify(payload, null, 2));
  return payload;
}

function loadLockedPreregistration(): Preregistration {
  const locked = JSON.parse(readFileSync(PREREG_PATH, 'utf8')) as Preregistration;
  const currentHash = sha256(canonicalScenarios());
  if (currentHash !== locked.scenarioHash) {
    throw new Error(
      `scenarios.ts changed after preregistration (${locked.scenarioHash} -> ${currentHash}). Refusing to evaluate.`
    );
  }
  const currentProduction = productionHashes();
  for (const relative of PRODUCTION_FILES) {
    if (currentProduction[relative] !== locked.productionHashes[relative]) {
      throw new Error(`Production file changed after preregistration: ${relative}`);
    }
  }
  return locked;
}

type GateSnapshot = {
  status: string;
  reason: string | null;
  pAction: number | null;
  pDev: number | null;
  decision: string;
  notice: string | null;
  guard: string | null;
  scoredText: string | null;
};

async function snapshotPass(
  scenario: ClarificationScenario,
  clarificationPass: boolean
): Promise<GateSnapshot> {
  const { evaluateComposerSubmission } = await import('../../../lib/evaluation/developmentalGate');
  const { decideCustomComposerSubmit } = await import(
    '../../../lib/evaluation/customComposerGateDecision'
  );
  const { clarificationIsTrivial } = await import('../../../lib/evaluation/clarificationTrivial');
  const { clarificationExplicitlyDeniesAction } = await import(
    '../../../lib/evaluation/clarificationDenial'
  );
  const { isDeterministicInvalid } = await import('../../../lib/evaluation/deterministicInvalid');
  const { composeClarificationSemanticText, composeSemanticLogText } = await import(
    '../../../lib/evaluation/customComposerSemantic'
  );

  const originalText = composeSemanticLogText(scenario.originalLog, '');
  let guard: string | null = null;
  if (clarificationPass) {
    if (clarificationIsTrivial(scenario.clarification, originalText)) guard = 'trivial';
    else if (isDeterministicInvalid(scenario.clarification)) guard = 'deterministic_invalid';
    else if (clarificationExplicitlyDeniesAction(scenario.clarification)) guard = 'explicit_denial';
  }

  const result = await evaluateComposerSubmission({
    activity: scenario.originalLog,
    details: '',
    clarificationPass,
    clarificationText: clarificationPass ? scenario.clarification : '',
  });
  const decision = decideCustomComposerSubmit({
    clarificationPass,
    clarificationText: clarificationPass ? scenario.clarification : '',
    status: result.status,
  });

  return {
    status: result.status,
    reason: result.reason ?? null,
    pAction: result.pAction ?? null,
    pDev: result.pDev ?? null,
    decision: decision.kind,
    notice: decision.kind === 'reject' ? decision.notice : null,
    guard,
    scoredText: clarificationPass
      ? guard
        ? null
        : composeClarificationSemanticText(originalText, scenario.clarification)
      : originalText,
  };
}

function inRescueCohort(scenario: ClarificationScenario, first: GateSnapshot) {
  return (
    scenario.role === 'legitimate_rescue' &&
    scenario.actionValid &&
    scenario.clarificationEstablishesCompletion &&
    first.decision === 'ask_clarification'
  );
}

async function evaluate() {
  const locked = loadLockedPreregistration();
  const { needsFirstPassClarification } = await import('../../../lib/evaluation/actionEvidence');

  const rows = [];
  for (const scenario of locked.scenarios) {
    const structural = needsFirstPassClarification(scenario.originalLog, '');
    if (structural !== scenario.structuralClarificationExpected) {
      throw new Error(
        `${scenario.id} structural flag ${scenario.structuralClarificationExpected} does not match production ${structural}. The lock was wrong; not rewriting it.`
      );
    }
    const first = await snapshotPass(scenario, false);
    const ranClarification = first.decision === 'ask_clarification';
    const second = ranClarification ? await snapshotPass(scenario, true) : null;
    rows.push({
      id: scenario.id,
      role: scenario.role,
      originalLog: scenario.originalLog,
      clarification: scenario.clarification,
      clarificationType: scenario.clarificationType,
      goldFinal: scenario.goldFinal,
      structuralClarificationExpected: scenario.structuralClarificationExpected,
      first,
      clarificationRan: ranClarification,
      second,
      rescueCohort: inRescueCohort(scenario, first),
      rescued: inRescueCohort(scenario, first) && second?.decision === 'save',
      falseCreditAfterClarification:
        scenario.goldFinal === 'NO_CREDIT' && ranClarification && second?.decision === 'save',
    });
  }

  const cohort = rows.filter((row) => row.rescueCohort);
  const rescued = cohort.filter((row) => row.rescued);
  const failures = cohort.filter((row) => !row.rescued);
  const falseCredits = rows.filter((row) => row.falseCreditAfterClarification);
  const firstPass = {
    credit: rows.filter((row) => row.first.decision === 'save').length,
    clarify: rows.filter((row) => row.first.decision === 'ask_clarification').length,
    reject: rows.filter((row) => row.first.decision === 'reject').length,
    other: rows.filter(
      (row) => !['save', 'ask_clarification', 'reject'].includes(row.first.decision)
    ).length,
  };

  const byRole: Record<string, { n: number; clarified: number; falseCredits: number; credits: number }> =
    {};
  for (const row of rows) {
    const bucket = byRole[row.role] ?? { n: 0, clarified: 0, falseCredits: 0, credits: 0 };
    bucket.n += 1;
    if (row.clarificationRan) bucket.clarified += 1;
    if (row.falseCreditAfterClarification) bucket.falseCredits += 1;
    if (row.second?.decision === 'save') bucket.credits += 1;
    byRole[row.role] = bucket;
  }

  const rate = cohort.length === 0 ? null : rescued.length / cohort.length;
  let interpretation: 'GREEN' | 'YELLOW' | 'RED' | 'NO_COHORT' = 'NO_COHORT';
  if (cohort.length > 0 && rate !== null) {
    if (falseCredits.length > 0 || rate < 0.75) interpretation = 'RED';
    else if (rate >= 0.9) interpretation = 'GREEN';
    else interpretation = 'YELLOW';
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    scenarioHash: locked.scenarioHash,
    scenarioCount: locked.scenarioCount,
    productionUnchanged: true,
    firstPass,
    rescueCohortN: cohort.length,
    rescueNumerator: rescued.length,
    rescueDenominator: cohort.length,
    rescueRate: rate,
    falseCreditAfterClarification: falseCredits.length,
    interpretation,
    byRole,
    droppedFromCohort: rows
      .filter((row) => row.role === 'legitimate_rescue' && !row.rescueCohort)
      .map((row) => ({
        id: row.id,
        originalLog: row.originalLog,
        firstDecision: row.first.decision,
        firstStatus: row.first.status,
        firstReason: row.first.reason,
      })),
    failures: failures.map((row) => ({
      id: row.id,
      originalLog: row.originalLog,
      clarification: row.clarification,
      clarificationType: row.clarificationType,
      first: row.first,
      second: row.second,
    })),
    falseCredits: falseCredits.map((row) => ({
      id: row.id,
      role: row.role,
      originalLog: row.originalLog,
      clarification: row.clarification,
      first: row.first,
      second: row.second,
    })),
    rows,
  };

  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(join(RESULTS_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
  return summary;
}

async function main() {
  const mode = process.argv[2];
  if (mode === 'preregister') {
    const payload = await writePreregistration();
    console.log(
      JSON.stringify(
        {
          wrote: PREREG_PATH,
          scenarioHash: payload.scenarioHash,
          scenarioCount: payload.scenarioCount,
        },
        null,
        2
      )
    );
    return;
  }
  if (mode === 'evaluate') {
    const summary = await evaluate();
    console.log(
      JSON.stringify(
        {
          rescue: `${summary.rescueNumerator}/${summary.rescueDenominator}`,
          rescueRate: summary.rescueRate,
          falseCreditAfterClarification: summary.falseCreditAfterClarification,
          interpretation: summary.interpretation,
          firstPass: summary.firstPass,
          failureIds: summary.failures.map((row) => row.id),
          falseCreditIds: summary.falseCredits.map((row) => row.id),
        },
        null,
        2
      )
    );
    return;
  }
  throw new Error('Usage: run-clarification-audit.ts preregister|evaluate');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
