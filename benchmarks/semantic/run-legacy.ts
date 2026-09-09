import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  calculateLogPoints,
  validateLogQuality,
} from '../../lib/evaluation/legacyEvaluator';
import {
  mapLegacyToContract,
  toLegacyKeys,
  unsupportedTaxonomyCategories,
} from './legacyAdapter';
import { LEGACY_ADAPTER_ASSUMPTIONS } from './types';
import type {
  BettrV1Category,
  MappedLegacyEvaluation,
  SemanticBenchmarkCase,
  SemanticOutcome,
} from './types';
import { SEMANTIC_BENCHMARK_V1 } from './v1';

type CaseResult = {
  id: string;
  text: string;
  family: string;
  selectedCategories: BettrV1Category[];
  comparable: boolean;
  taxonomyUnsupported: boolean;
  unsupportedCategories: BettrV1Category[];
  expected: {
    outcome: SemanticOutcome;
    supportedCategories: BettrV1Category[];
    suggestedCategories: BettrV1Category[];
    evidenceTier: string;
    baseCredit: number;
    developmental: boolean;
    reason: string;
  };
  actual: MappedLegacyEvaluation | null;
  matches: {
    outcome: boolean | null;
    developmental: boolean | null;
    suggestion: boolean | null;
    evidence: boolean | null;
    baseCredit: boolean | null;
    contract: boolean | null;
  };
  failReasons: string[];
};

function isDevelopmental(outcome: SemanticOutcome) {
  return outcome === 'VALID' || outcome === 'VALID_WITH_SUGGESTION';
}

function sameSet(a: BettrV1Category[], b: BettrV1Category[]) {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

function suggestionMatch(testCase: SemanticBenchmarkCase, actual: MappedLegacyEvaluation) {
  if (testCase.expectedSuggestedCategories.length) {
    return sameSet(testCase.expectedSuggestedCategories, actual.suggestedCategories);
  }
  if (testCase.expectedOutcome === 'VALID_WITH_SUGGESTION') {
    return actual.suggestedCategories.length > 0;
  }
  return actual.suggestedCategories.length === 0;
}

function evaluateCase(testCase: SemanticBenchmarkCase): CaseResult {
  const unsupported = unsupportedTaxonomyCategories(testCase.selectedCategories);
  const expectedDevelopmental = isDevelopmental(testCase.expectedOutcome);
  const expected = {
    outcome: testCase.expectedOutcome,
    supportedCategories: testCase.expectedSupportedCategories,
    suggestedCategories: testCase.expectedSuggestedCategories,
    evidenceTier: testCase.expectedEvidenceTier,
    baseCredit: testCase.expectedBaseCredit,
    developmental: expectedDevelopmental,
    reason: testCase.reason,
  };

  if (unsupported.length) {
    return {
      id: testCase.id,
      text: testCase.text,
      family: testCase.benchmarkFamily,
      selectedCategories: testCase.selectedCategories,
      comparable: false,
      taxonomyUnsupported: true,
      unsupportedCategories: unsupported,
      expected,
      actual: null,
      matches: {
        outcome: null,
        developmental: null,
        suggestion: null,
        evidence: null,
        baseCredit: null,
        contract: null,
      },
      failReasons: ['LEGACY_UNSUPPORTED_TAXONOMY'],
    };
  }

  const keys = toLegacyKeys(testCase.selectedCategories);
  if (!keys) {
    throw new Error(`Comparable case ${testCase.id} failed key mapping`);
  }

  const quality = validateLogQuality(keys, testCase.text, '');
  const points = calculateLogPoints(keys, testCase.text, '', false);
  const actual = mapLegacyToContract(quality, points);
  const failReasons: string[] = [];

  const outcomeOk = actual.outcome === testCase.expectedOutcome;
  const developmentalOk = actual.developmental === expectedDevelopmental;
  const suggestionOk = suggestionMatch(testCase, actual);
  const evidenceOk = actual.evidenceTier === testCase.expectedEvidenceTier;
  const baseCreditOk = actual.baseCredit === testCase.expectedBaseCredit;
  const contractOk =
    outcomeOk && developmentalOk && suggestionOk && evidenceOk && baseCreditOk;

  if (!outcomeOk) {
    failReasons.push(
      `outcome expected ${testCase.expectedOutcome}, actual ${actual.outcome}`
    );
  }
  if (!developmentalOk) {
    failReasons.push(
      `developmental expected ${expectedDevelopmental}, actual ${actual.developmental}`
    );
  }
  if (!suggestionOk) {
    failReasons.push(
      `suggestion expected [${testCase.expectedSuggestedCategories.join(', ') || 'none'}], actual [${actual.suggestedCategories.join(', ') || 'none'}]`
    );
  }
  if (!evidenceOk) {
    failReasons.push(
      `evidence expected ${testCase.expectedEvidenceTier}, actual ${actual.evidenceTier}`
    );
  }
  if (!baseCreditOk) {
    failReasons.push(
      `baseCredit expected ${testCase.expectedBaseCredit}, actual ${actual.baseCredit}`
    );
  }

  return {
    id: testCase.id,
    text: testCase.text,
    family: testCase.benchmarkFamily,
    selectedCategories: testCase.selectedCategories,
    comparable: true,
    taxonomyUnsupported: false,
    unsupportedCategories: [],
    expected,
    actual,
    matches: {
      outcome: outcomeOk,
      developmental: developmentalOk,
      suggestion: suggestionOk,
      evidence: evidenceOk,
      baseCredit: baseCreditOk,
      contract: contractOk,
    },
    failReasons,
  };
}

function rate(passed: number, total: number) {
  if (!total) return { passed, total, accuracy: null as number | null };
  return { passed, total, accuracy: Number((passed / total).toFixed(4)) };
}

function main() {
  const results = SEMANTIC_BENCHMARK_V1.map(evaluateCase);
  const comparable = results.filter((item) => item.comparable);
  const taxonomyUnsupported = results.filter((item) => item.taxonomyUnsupported);
  const comparableFailed = comparable.filter((item) => item.matches.contract !== true);

  const familyGroups = ['G_NON_DEVELOPMENTAL', 'H_JUNK', 'I_IMPLAUSIBLE', 'J_GAMING'] as const;
  const junkAdversarial = comparable.filter((item) =>
    familyGroups.includes(item.family as (typeof familyGroups)[number])
  );

  const summary = {
    evaluator: 'legacy-heuristic',
    benchmark: 'Bettr Semantic Benchmark v1',
    generatedAt: new Date().toISOString(),
    totals: {
      totalCases: results.length,
      legacyComparable: comparable.length,
      taxonomyUnsupported: taxonomyUnsupported.length,
    },
    scores: {
      outcomeAccuracy: rate(
        comparable.filter((item) => item.matches.outcome === true).length,
        comparable.length
      ),
      developmentalValidityAccuracy: rate(
        comparable.filter((item) => item.matches.developmental === true).length,
        comparable.length
      ),
      categorySuggestionAccuracy: rate(
        comparable.filter((item) => item.matches.suggestion === true).length,
        comparable.length
      ),
      evidenceBaseCreditAccuracy: rate(
        comparable.filter(
          (item) => item.matches.evidence === true && item.matches.baseCredit === true
        ).length,
        comparable.length
      ),
      junkAdversarialImplausibilityAccuracy: rate(
        junkAdversarial.filter((item) => item.matches.outcome === true).length,
        junkAdversarial.length
      ),
      overallLegacyComparableContractScore: rate(
        comparable.filter((item) => item.matches.contract === true).length,
        comparable.length
      ),
    },
    taxonomyUnsupportedCases: taxonomyUnsupported.map((item) => ({
      id: item.id,
      text: item.text,
      selectedCategories: item.selectedCategories,
      unsupportedCategories: item.unsupportedCategories,
      expectedOutcome: item.expected.outcome,
      reason: item.expected.reason,
    })),
    failedComparableCases: comparableFailed.map((item) => ({
      id: item.id,
      text: item.text,
      expected: item.expected,
      actual: item.actual,
      failReasons: item.failReasons,
    })),
    adapterAssumptions: [...LEGACY_ADAPTER_ASSUMPTIONS],
    cases: results,
  };

  const outDir = join(process.cwd(), 'benchmarks/semantic/results');
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, 'legacy-baseline-v1.json');
  writeFileSync(outFile, `${JSON.stringify(summary, null, 2)}\n`);

  const pct = (value: number | null) =>
    value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;

  console.log('Bettr Semantic Benchmark v1 — legacy heuristic baseline');
  console.log(`Total cases: ${summary.totals.totalCases}`);
  console.log(`Legacy-comparable: ${summary.totals.legacyComparable}`);
  console.log(`Taxonomy-unsupported: ${summary.totals.taxonomyUnsupported}`);
  console.log(`Outcome accuracy: ${pct(summary.scores.outcomeAccuracy.accuracy)}`);
  console.log(
    `Developmental-validity accuracy: ${pct(summary.scores.developmentalValidityAccuracy.accuracy)}`
  );
  console.log(
    `Category/suggestion accuracy: ${pct(summary.scores.categorySuggestionAccuracy.accuracy)}`
  );
  console.log(
    `Evidence/base-credit accuracy: ${pct(summary.scores.evidenceBaseCreditAccuracy.accuracy)}`
  );
  console.log(
    `Junk/adversarial/implausibility outcome accuracy: ${pct(summary.scores.junkAdversarialImplausibilityAccuracy.accuracy)}`
  );
  console.log(
    `Overall legacy-comparable contract score: ${pct(summary.scores.overallLegacyComparableContractScore.accuracy)}`
  );
  console.log(`Failed comparable cases: ${comparableFailed.length}`);
  for (const failure of comparableFailed) {
    console.log(
      `- ${failure.id}: expected ${failure.expected.outcome}/${failure.expected.evidenceTier}/${failure.expected.baseCredit}; actual ${failure.actual?.outcome}/${failure.actual?.evidenceTier}/${failure.actual?.baseCredit} | ${failure.failReasons.join('; ')}`
    );
  }
  console.log(`Wrote ${outFile}`);
}

main();
