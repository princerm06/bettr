import type { CategoryKey, QualityResult } from '../../lib/evaluation/legacyEvaluator';
import type {
  BettrV1Category,
  EvidenceTier,
  MappedLegacyEvaluation,
  SemanticOutcome,
} from './types';

/**
 * Production keys that the legacy evaluator can actually receive.
 * Inner Wellbeing is intentionally absent.
 */
export const V1_TO_LEGACY_KEY: Record<BettrV1Category, CategoryKey | null> = {
  'Appearance & Self-Care': 'appearance',
  'Fashion & Style': 'fashion',
  'Academics': 'academics',
  'Career': 'career',
  'Finance': 'finance',
  'Nutrition & Cooking': 'nutrition',
  'Social': 'social',
  'Physical Prowess': 'physical',
  'Mind & Craft': 'mind',
  'Inner Wellbeing': null,
  'Spirituality': 'spirituality',
};

export const LEGACY_KEY_TO_V1: Record<CategoryKey, BettrV1Category> = {
  appearance: 'Appearance & Self-Care',
  fashion: 'Fashion & Style',
  academics: 'Academics',
  career: 'Career',
  finance: 'Finance',
  nutrition: 'Nutrition & Cooking',
  social: 'Social',
  physical: 'Physical Prowess',
  mind: 'Mind & Craft',
  spirituality: 'Spirituality',
};

export function unsupportedTaxonomyCategories(
  selected: BettrV1Category[]
): BettrV1Category[] {
  return selected.filter((category) => V1_TO_LEGACY_KEY[category] === null);
}

export function toLegacyKeys(selected: BettrV1Category[]): CategoryKey[] | null {
  const keys: CategoryKey[] = [];
  for (const category of selected) {
    const key = V1_TO_LEGACY_KEY[category];
    if (key === null) return null;
    keys.push(key);
  }
  return keys;
}

function evidenceFromPoints(points: number): EvidenceTier {
  if (points <= 0) return 'NONE';
  if (points >= 7) return 'STRONG';
  return 'STANDARD';
}

export function mapLegacyToContract(
  quality: QualityResult,
  points: number
): MappedLegacyEvaluation {
  const suggestedCategories = quality.suggestedCategory
    ? [LEGACY_KEY_TO_V1[quality.suggestedCategory]]
    : [];

  const supportedCategories = (quality.matchedCategories || []).map(
    (key) => LEGACY_KEY_TO_V1[key]
  );

  let outcome: SemanticOutcome;

  if (quality.rewardRatio > 0) {
    outcome = suggestedCategories.length
      ? 'VALID_WITH_SUGGESTION'
      : 'VALID';
  } else if (suggestedCategories.length) {
    outcome = 'VALID_WITH_SUGGESTION';
  } else if (quality.status === 'invalid') {
    outcome = 'NO_CREDIT';
  } else {
    outcome = 'NEEDS_CLARIFICATION';
  }

  return {
    outcome,
    supportedCategories,
    suggestedCategories,
    evidenceTier: evidenceFromPoints(points),
    baseCredit: points,
    developmental: outcome === 'VALID' || outcome === 'VALID_WITH_SUGGESTION',
    legacyStatus: quality.status,
    legacyRewardRatio: quality.rewardRatio,
    legacyMessage: quality.message,
  };
}
