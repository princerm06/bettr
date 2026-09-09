export type SemanticOutcome =
  | 'VALID'
  | 'VALID_WITH_SUGGESTION'
  | 'NEEDS_CLARIFICATION'
  | 'NO_CREDIT';

export type EvidenceTier = 'STANDARD' | 'STRONG' | 'NONE';

export type BenchmarkFamily =
  | 'A_NORMAL_VALID'
  | 'B_SHORT_COMPLETE'
  | 'C_STRONG_EVIDENCE'
  | 'D_AMBIGUOUS'
  | 'E_CATEGORY_MISMATCH'
  | 'F_MULTI_CATEGORY'
  | 'G_NON_DEVELOPMENTAL'
  | 'H_JUNK'
  | 'I_IMPLAUSIBLE'
  | 'J_GAMING'
  | 'K_CONTEXT_SENSITIVE';

/**
 * Locked Bettr v1 category labels used by the semantic benchmark.
 * These are independent of the production 10-category taxonomy.
 */
export type BettrV1Category =
  | 'Appearance & Self-Care'
  | 'Fashion & Style'
  | 'Academics'
  | 'Career'
  | 'Finance'
  | 'Nutrition & Cooking'
  | 'Social'
  | 'Physical Prowess'
  | 'Mind & Craft'
  | 'Inner Wellbeing'
  | 'Spirituality';

export type SemanticBenchmarkCase = {
  id: string;
  text: string;
  selectedCategories: BettrV1Category[];
  expectedOutcome: SemanticOutcome;
  expectedSupportedCategories: BettrV1Category[];
  expectedSuggestedCategories: BettrV1Category[];
  expectedEvidenceTier: EvidenceTier;
  expectedBaseCredit: 0 | 5 | 7;
  reason: string;
  benchmarkFamily: BenchmarkFamily;
};

export type MappedLegacyEvaluation = {
  outcome: SemanticOutcome;
  supportedCategories: BettrV1Category[];
  suggestedCategories: BettrV1Category[];
  evidenceTier: EvidenceTier;
  baseCredit: number;
  developmental: boolean;
  legacyStatus: 'valid' | 'questionable' | 'invalid';
  legacyRewardRatio: number;
  legacyMessage: string;
};

export const LEGACY_ADAPTER_ASSUMPTIONS = [
  'Benchmark `text` is passed to the legacy evaluator as the activity/entry field with empty details and no image, matching the main Custom Log entry field.',
  'Priority is never applied. Reported baseCredit is calculateLogPoints output only.',
  'rewardRatio > 0 without a suggestedCategory maps to VALID, including legacy reduced-credit (ratio 0.5) cases, because the heuristic awarded some credit.',
  'rewardRatio > 0 with a suggestedCategory maps to VALID_WITH_SUGGESTION.',
  'rewardRatio === 0 with a suggestedCategory maps to VALID_WITH_SUGGESTION. The legacy engine often uses invalid/questionable+suggestion for category mismatch and never awards those points; the new contract treats mismatch of an otherwise recognizable action as suggestion, not junk. This can over-promote implausible logs that still keyword-match another category.',
  'rewardRatio === 0, no suggestion, status invalid maps to NO_CREDIT.',
  'rewardRatio === 0, no suggestion, status questionable maps to NEEDS_CLARIFICATION. Legacy uses questionable for both genuine ambiguity and much junk/spam, so junk families may look like clarification rather than NO_CREDIT.',
  'Evidence STRONG vs STANDARD is inferred only from calculateLogPoints (7 vs 5 vs 0, with 0.5-ratio values treated as STANDARD if > 0). With empty details, the legacy helper never emits 7, so STRONG expected cases cannot match evidence/base-credit even when VALID.',
  'Fashion & Style is executed against production key `fashion` (label Fashion & Accessories). That is a public-name alias for an existing category, not a taxonomy translation.',
  'Inner Wellbeing has no production key. Those cases are LEGACY_UNSUPPORTED_TAXONOMY and are not run through the evaluator.',
  'Social maps to production key `social` (label Socialization).',
] as const;
