import { categories, type CategoryKey } from './legacyEvaluator';
import { attributionShareForCategory } from './categoryAttribution';
import { hasPositiveProgressCredit } from './progressCredit';
import {
  resolvePriorityLevel,
  type PriorityLevel,
  type PriorityMap,
} from './priorityReward';

/**
 * Interim Phase 2 Discipline: a live derived alignment score, not XP
 * and not a selectable category. Historical credit stays in log.points.
 * Phase 3/4 may replace this with planned-vs-actual / alignment reasoning.
 */

export const DISCIPLINE_WINDOW_DAYS = 7;

export const DISCIPLINE_PRIORITY_WEIGHTS: Record<PriorityLevel, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  maintenance: 1,
};

export const DISCIPLINE_PRIORITY_TARGETS: Record<PriorityLevel, number> = {
  critical: 5,
  high: 3,
  normal: 2,
  maintenance: 1,
};

export type DisciplineLog = {
  date: string;
  points: number;
  category: CategoryKey;
  categories?: CategoryKey[];
  activity: string;
  details?: string | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function shiftIsoDate(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

export function isDateInDisciplineWindow(logDate: string, today: string): boolean {
  if (!ISO_DATE.test(logDate) || !ISO_DATE.test(today)) return false;
  const start = shiftIsoDate(today, -(DISCIPLINE_WINDOW_DAYS - 1));
  return logDate >= start && logDate <= today;
}

export function isDisciplineCategoryKey(key: string) {
  return key === 'discipline' || key === 'Discipline';
}

export type DisciplineScoreInput = {
  logs: readonly DisciplineLog[];
  priorities: PriorityMap;
  today: string;
};

/**
 * 0–100 live score of recent accepted progress vs current priorities.
 * Does not mutate logs or award XP. Future-dated logs do not count.
 */
export function calculateDisciplineScore(input: DisciplineScoreInput): number {
  const recent = input.logs.filter(
    (log) =>
      hasPositiveProgressCredit(log.points) &&
      isDateInDisciplineWindow(log.date, input.today)
  );

  const totalWeight = categories.reduce((sum, category) => {
    const priority = resolvePriorityLevel(input.priorities[category.key]);
    return sum + DISCIPLINE_PRIORITY_WEIGHTS[priority];
  }, 0);

  if (totalWeight <= 0) return 0;

  const earned = categories.reduce((sum, category) => {
    const count = recent.reduce(
      (inner, log) => inner + attributionShareForCategory(log, category.key),
      0
    );
    const priority = resolvePriorityLevel(input.priorities[category.key]);
    const target = DISCIPLINE_PRIORITY_TARGETS[priority];
    const weight = DISCIPLINE_PRIORITY_WEIGHTS[priority];
    return sum + Math.min(1, count / target) * weight;
  }, 0);

  const score = Math.round((earned / totalWeight) * 100);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, score));
}
