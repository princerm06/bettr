import type {
  BettrV1Category,
  EvidenceTier,
  SemanticBenchmarkCase,
  SemanticOutcome,
} from './types';

export type ContractActual = {
  outcome: SemanticOutcome;
  developmental: boolean;
  supportedCategories: BettrV1Category[];
  suggestedCategories: BettrV1Category[];
  evidenceTier: EvidenceTier | string;
  baseCredit: number;
};

export type ScoredCase = {
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
  actual: ContractActual | null;
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

export function isDevelopmental(outcome: SemanticOutcome) {
  return outcome === 'VALID' || outcome === 'VALID_WITH_SUGGESTION';
}

function sameSet(a: BettrV1Category[], b: BettrV1Category[]) {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

export function suggestionMatch(
  testCase: SemanticBenchmarkCase,
  actual: ContractActual
) {
  if (testCase.expectedSuggestedCategories.length) {
    return sameSet(testCase.expectedSuggestedCategories, actual.suggestedCategories);
  }
  if (testCase.expectedOutcome === 'VALID_WITH_SUGGESTION') {
    return actual.suggestedCategories.length > 0;
  }
  return actual.suggestedCategories.length === 0;
}

export function rate(passed: number, total: number) {
  if (!total) return { passed, total, accuracy: null as number | null };
  return { passed, total, accuracy: Number((passed / total).toFixed(4)) };
}

export function scoreAgainstCase(
  testCase: SemanticBenchmarkCase,
  actual: ContractActual | null,
  options: {
    comparable: boolean;
    taxonomyUnsupported: boolean;
    unsupportedCategories: BettrV1Category[];
  }
): ScoredCase {
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

  if (!options.comparable || !actual) {
    return {
      id: testCase.id,
      text: testCase.text,
      family: testCase.benchmarkFamily,
      selectedCategories: testCase.selectedCategories,
      comparable: options.comparable,
      taxonomyUnsupported: options.taxonomyUnsupported,
      unsupportedCategories: options.unsupportedCategories,
      expected,
      actual,
      matches: {
        outcome: null,
        developmental: null,
        suggestion: null,
        evidence: null,
        baseCredit: null,
        contract: null,
      },
      failReasons: options.taxonomyUnsupported
        ? ['LEGACY_UNSUPPORTED_TAXONOMY']
        : ['missing-actual'],
    };
  }

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

export function summarizeScores(scored: ScoredCase[]) {
  const comparable = scored.filter((item) => item.comparable);
  const familyGroups = ['G_NON_DEVELOPMENTAL', 'H_JUNK', 'I_IMPLAUSIBLE', 'J_GAMING'] as const;
  const junkAdversarial = comparable.filter((item) =>
    familyGroups.includes(item.family as (typeof familyGroups)[number])
  );

  return {
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
    overallContractScore: rate(
      comparable.filter((item) => item.matches.contract === true).length,
      comparable.length
    ),
  };
}
