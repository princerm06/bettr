import {
  categories,
  categorySignals,
  type CategoryKey,
} from './legacyEvaluator';

export type AttributionLog = {
  category: CategoryKey;
  categories?: CategoryKey[];
  activity: string;
  details?: string | null;
};

export function categoriesForAttribution(log: AttributionLog): CategoryKey[] {
  const keys = log.categories?.length ? log.categories : [log.category];
  return Array.from(new Set(keys));
}

/**
 * Existing production category-share formula.
 * Evidence-backed selected tags weight 1; other selected tags 0.35.
 * Does not award XP.
 */
export function attributionShareForCategory(log: AttributionLog, category: CategoryKey) {
  const selected = categoriesForAttribution(log);
  if (!selected.includes(category)) return 0;

  const compact = `${log.activity} ${log.details || ''}`
    .toLowerCase()
    .replace(/[^a-z0-9$\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const matched = selected.filter((key) => categorySignals[key].test(compact));
  if (!matched.length) return 1 / selected.length;

  const weights = selected.map((key) => (matched.includes(key) ? 1 : 0.35));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  return weights[selected.indexOf(category)] / totalWeight;
}

export function isSelectableProgressCategory(key: string): key is CategoryKey {
  return categories.some((item) => item.key === key);
}
