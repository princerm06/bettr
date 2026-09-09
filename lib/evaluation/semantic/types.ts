export type SemanticOutcome =
  | 'VALID'
  | 'VALID_WITH_SUGGESTION'
  | 'NEEDS_CLARIFICATION'
  | 'NO_CREDIT';

export type EvidenceTier = 'STANDARD' | 'STRONG' | 'NONE';

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

export type SemanticEvaluation = {
  outcome: SemanticOutcome;
  developmental: boolean;
  supportedCategories: BettrV1Category[];
  suggestedCategories: BettrV1Category[];
  categoryScores: Record<BettrV1Category, number>;
  ambiguityScore: number;
  developmentalScore: number;
  ordinaryActivityScore: number;
  passiveConsumptionScore: number;
  nonsenseScore: number;
  evidenceTier: EvidenceTier;
  baseCredit: 0 | 5 | 7;
  junkReason: string | null;
};
