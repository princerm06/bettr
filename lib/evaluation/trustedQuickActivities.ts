import type { CategoryKey } from './legacyEvaluator';

/**
 * Built-in Bettr-defined quick activities.
 * These are approved at definition time; claimLog may skip 3A only for
 * an exact (category, activity) pair from this table.
 */
export const TRUSTED_QUICK_ACTIVITIES: Record<CategoryKey, readonly string[]> = {
  appearance: ['Skincare routine', 'Hair / grooming', 'Full reset'],
  fashion: ['Put together a fit', 'Wardrobe cleanup', 'Accessory / fragrance'],
  academics: ['Study session', 'Assignment progress', 'Exam prep'],
  career: ['Applied to a role', 'Résumé / portfolio', 'Interview prep'],
  finance: ['Tracked spending', 'Budget check', 'Invested / saved'],
  nutrition: ['Cooked a meal', 'Meal prep', 'Grocery planning'],
  social: ['Started a conversation', 'Met someone new', 'Made plans'],
  physical: ['Lifted', 'Ran', 'Athletic training'],
  mind: ['Read', 'Journaled', 'Practiced a craft'],
  spirituality: ['Prayer / reflection', 'Religious study', 'Service / worship'],
};

export function isTrustedQuickClaim(category: CategoryKey, activity: string) {
  return TRUSTED_QUICK_ACTIVITIES[category].includes(activity);
}

/** claimLog may skip 3A only when this is true. */
export function canBypassSemanticGateForQuickClaim(
  category: CategoryKey,
  activity: string
) {
  return isTrustedQuickClaim(category, activity);
}
