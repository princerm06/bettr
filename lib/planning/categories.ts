/**
 * Planning category display metadata.
 * Mirrors the locked production taxonomy without importing evaluation/XP code.
 */
import {
  PLANNING_CATEGORY_KEYS,
  type PlanningCategoryKey,
} from './types';

export type PlanningCategoryDisplay = {
  key: PlanningCategoryKey;
  label: string;
  short: string;
  emoji: string;
};

export const PLANNING_CATEGORY_DISPLAY: Record<
  PlanningCategoryKey,
  PlanningCategoryDisplay
> = {
  appearance: {
    key: 'appearance',
    label: 'Appearance & Self-Care',
    short: 'Appearance',
    emoji: '🧴',
  },
  fashion: {
    key: 'fashion',
    label: 'Fashion & Style',
    short: 'Fashion',
    emoji: '👔',
  },
  academics: {
    key: 'academics',
    label: 'Academics',
    short: 'Academics',
    emoji: '🎓',
  },
  career: {
    key: 'career',
    label: 'Career',
    short: 'Career',
    emoji: '💼',
  },
  finance: {
    key: 'finance',
    label: 'Finance',
    short: 'Finance',
    emoji: '💰',
  },
  nutrition: {
    key: 'nutrition',
    label: 'Nutrition & Cooking',
    short: 'Nutrition',
    emoji: '🥗',
  },
  social: {
    key: 'social',
    label: 'Social',
    short: 'Social',
    emoji: '🗣️',
  },
  physical: {
    key: 'physical',
    label: 'Physical Prowess',
    short: 'Physical',
    emoji: '🏋️',
  },
  mind: {
    key: 'mind',
    label: 'Mind & Craft',
    short: 'Mind & Craft',
    emoji: '🧠',
  },
  inner: {
    key: 'inner',
    label: 'Inner Wellbeing',
    short: 'Inner Wellbeing',
    emoji: '🌿',
  },
  spirituality: {
    key: 'spirituality',
    label: 'Spirituality',
    short: 'Spirituality',
    emoji: '🙏',
  },
};

export const PLANNING_CATEGORIES: PlanningCategoryDisplay[] =
  PLANNING_CATEGORY_KEYS.map((key) => PLANNING_CATEGORY_DISPLAY[key]);

export function planningCategoryDisplay(key: PlanningCategoryKey) {
  return PLANNING_CATEGORY_DISPLAY[key];
}
