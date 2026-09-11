import type { CategoryKey } from './legacyEvaluator';

/**
 * Phase 2 slice 1: deterministic priority adjustment after Phase 1 base credit.
 * Does not infer category support or change semantic eligibility.
 */

export type PriorityLevel = 'critical' | 'high' | 'normal' | 'maintenance';

export const PRIORITY_BONUS: Record<PriorityLevel, number> = {
  critical: 2,
  high: 1,
  normal: 0,
  maintenance: -1,
};

export const DEFAULT_PRIORITY: PriorityLevel = 'normal';

const PRIORITY_LEVELS = new Set<string>(Object.keys(PRIORITY_BONUS));

export type PriorityMap = Partial<Record<CategoryKey, PriorityLevel | string | null | undefined>>;

export function isPriorityLevel(value: unknown): value is PriorityLevel {
  return typeof value === 'string' && PRIORITY_LEVELS.has(value);
}

/** Missing, undefined, or unrecognized values behave as normal (bonus 0). */
export function resolvePriorityLevel(value: unknown): PriorityLevel {
  return isPriorityLevel(value) ? value : DEFAULT_PRIORITY;
}

export function priorityBonus(value: unknown): number {
  return PRIORITY_BONUS[resolvePriorityLevel(value)];
}

/**
 * First-seen unique keys. Matches `categoriesForLog` so duplicate tags
 * cannot overweight the average bonus.
 */
export function uniqueCategoryKeys(categoryKeys: readonly CategoryKey[]): CategoryKey[] {
  return Array.from(new Set(categoryKeys));
}

/**
 * Adjust deterministic base XP by the average priority bonus of selected categories.
 * Zero/invalid base stays 0. Empty selected list leaves a positive base unchanged.
 */
export function applyPriorityReward(
  basePoints: number,
  categoryKeys: readonly CategoryKey[],
  priorities: PriorityMap
): number {
  if (!Number.isFinite(basePoints) || basePoints <= 0) return 0;

  const selected = uniqueCategoryKeys(categoryKeys);
  if (selected.length === 0) {
    return Math.max(1, Math.round(basePoints));
  }

  const averageBonus =
    selected.reduce((sum, key) => sum + priorityBonus(priorities[key]), 0) /
    selected.length;

  const awarded = Math.round(basePoints + averageBonus);
  if (!Number.isFinite(awarded)) return 0;
  return Math.max(1, awarded);
}
