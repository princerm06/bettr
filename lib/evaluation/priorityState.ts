import { categories, type CategoryKey } from './legacyEvaluator';
import {
  DEFAULT_PRIORITY,
  isPriorityLevel,
  type PriorityLevel,
} from './priorityReward';

export type CompletePriorityMap = Record<CategoryKey, PriorityLevel>;

export const CATEGORY_KEYS = categories.map((item) => item.key) as CategoryKey[];

export function createDefaultPriorityMap(): CompletePriorityMap {
  return Object.fromEntries(
    CATEGORY_KEYS.map((key) => [key, DEFAULT_PRIORITY])
  ) as CompletePriorityMap;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Full CategoryKey map with only valid PriorityLevel values.
 * Unknown keys dropped. Missing/invalid values → normal.
 */
export function normalizePriorityMap(input: unknown): CompletePriorityMap {
  const source = isPlainObject(input) ? input : {};
  const next = createDefaultPriorityMap();

  for (const key of CATEGORY_KEYS) {
    if (key in source && isPriorityLevel(source[key])) {
      next[key] = source[key];
    }
  }

  return next;
}

/** localStorage / JSON payloads. Never throws. */
export function parsePriorityMap(raw: string | null | undefined): CompletePriorityMap {
  if (!raw) return createDefaultPriorityMap();
  try {
    return normalizePriorityMap(JSON.parse(raw) as unknown);
  } catch {
    return createDefaultPriorityMap();
  }
}

/**
 * Explicit onboarding assignment (not the generic all-normal default):
 * every category maintenance, selected focus high, mission critical.
 */
export function buildOnboardingPriorityMap(
  focus: readonly CategoryKey[],
  mission: CategoryKey
): CompletePriorityMap {
  const next = createDefaultPriorityMap();
  for (const key of CATEGORY_KEYS) {
    next[key] = 'maintenance';
  }
  for (const key of focus) {
    if (!CATEGORY_KEYS.includes(key)) continue;
    next[key] = key === mission ? 'critical' : 'high';
  }
  if (CATEGORY_KEYS.includes(mission)) {
    next[mission] = 'critical';
  }
  return normalizePriorityMap(next);
}
