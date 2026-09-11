import {
  categories,
  categoryFor,
  categorySignals,
  type Category,
  type CategoryKey,
} from './legacyEvaluator';

export type ComposerPriority = 'critical' | 'high' | 'normal' | 'maintenance';

export const CATEGORY_REQUIRED_MESSAGE = 'Choose at least one category.';

const PRIORITY_RANK: Record<ComposerPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  maintenance: 3,
};

const CATEGORY_INDEX = Object.fromEntries(
  categories.map((item, index) => [item.key, index])
) as Record<CategoryKey, number>;

export function countCategoryUsage(
  logs: Array<{ category: CategoryKey; categories?: CategoryKey[] }>
): Record<CategoryKey, number> {
  const counts = Object.fromEntries(categories.map((item) => [item.key, 0])) as Record<
    CategoryKey,
    number
  >;

  for (const log of logs) {
    const keys = log.categories?.length ? log.categories : [log.category];
    for (const key of keys) {
      if (key in counts) counts[key] += 1;
    }
  }

  return counts;
}

/** Display order only. Does not change XP or priority reward. */
export function orderComposerCategories(
  priorities: Record<CategoryKey, ComposerPriority>,
  usageCounts: Record<CategoryKey, number>
): Category[] {
  return [...categories].sort((a, b) => {
    const priorityDelta =
      (PRIORITY_RANK[priorities[a.key] ?? 'normal'] ?? PRIORITY_RANK.normal) -
      (PRIORITY_RANK[priorities[b.key] ?? 'normal'] ?? PRIORITY_RANK.normal);
    if (priorityDelta !== 0) return priorityDelta;

    const frequencyDelta = (usageCounts[b.key] ?? 0) - (usageCounts[a.key] ?? 0);
    if (frequencyDelta !== 0) return frequencyDelta;

    return CATEGORY_INDEX[a.key] - CATEGORY_INDEX[b.key];
  });
}

export function inferMatchingCategories(activity: string, details: string): CategoryKey[] {
  const compact = `${activity} ${details}`
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9$\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (compact.length < 8) return [];

  return categories
    .map((item) => item.key)
    .filter((key) => categorySignals[key].test(compact));
}

export function additionalCategorySuggestions(
  activity: string,
  details: string,
  selected: CategoryKey[],
  ordered: Category[] = categories
): CategoryKey[] {
  const selectedSet = new Set(selected);
  const matches = new Set(inferMatchingCategories(activity, details));
  return ordered
    .map((item) => item.key)
    .filter((key) => matches.has(key) && !selectedSet.has(key))
    .slice(0, 3);
}

export function categorySuggestionLabel(key: CategoryKey) {
  const item = categoryFor(key);
  return `${item.emoji} ${item.short}`;
}
