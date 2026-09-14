/**
 * Action-evidence research dataset (Experiment 1).
 *
 * Official trained task is binary:
 *   ACTION_POSITIVE | ACTION_NEGATIVE
 *
 * AMBIGUOUS is auxiliary / exam only. It is never a supervised class.
 *
 * This axis is independent of DEVELOPMENTAL / NON_DEVELOPMENTAL.
 * Ordinary non-developmental actions remain ACTION_POSITIVE.
 */

export const ACTION_EVIDENCE_LABELS = [
  'ACTION_POSITIVE',
  'ACTION_NEGATIVE',
  'AMBIGUOUS',
] as const;

export type ActionEvidenceLabel = (typeof ACTION_EVIDENCE_LABELS)[number];

export const TRAINABLE_ACTION_LABELS = [
  'ACTION_POSITIVE',
  'ACTION_NEGATIVE',
] as const;

export type TrainableActionLabel = (typeof TRAINABLE_ACTION_LABELS)[number];

export const ACTION_DATASET_ROLES = [
  'core_trainable',
  'uncertain_auxiliary',
  'exam_holdout',
] as const;

export type ActionDatasetRole = (typeof ACTION_DATASET_ROLES)[number];

export const ACTION_DATASET_SPLITS = ['train', 'val', 'aux', 'exam'] as const;
export type ActionDatasetSplit = (typeof ACTION_DATASET_SPLITS)[number];

export const ACTION_DOMAINS = [
  'Appearance & Self-Care',
  'Fashion & Style',
  'Academics',
  'Career',
  'Finance',
  'Nutrition & Cooking',
  'Social',
  'Physical Prowess',
  'Mind & Craft',
  'Inner Wellbeing',
  'Spirituality',
  'Ordinary / none',
] as const;

export type ActionDatasetDomain = (typeof ACTION_DOMAINS)[number];

export const DEVELOPMENTAL_INTENTS = [
  'DEVELOPMENTAL',
  'NON_DEVELOPMENTAL',
  'NOT_AN_ACTION',
] as const;

export type DevelopmentalIntent = (typeof DEVELOPMENTAL_INTENTS)[number];

export type ActionEvidenceExample = {
  id: string;
  text: string;
  label: ActionEvidenceLabel;
  familyId: string;
  contrastGroup: string;
  domain: ActionDatasetDomain;
  role: ActionDatasetRole;
  /** Assigned only after family-level split is frozen. */
  split?: ActionDatasetSplit;
  /**
   * Ablation-only label. NOT the trained action-evidence class.
   * DEVELOPMENTAL = deliberate self-development practice.
   * NON_DEVELOPMENTAL = ordinary action that still has action evidence.
   * NOT_AN_ACTION = description / identity / vibe / outcome without a practice.
   */
  developmentalIntent: DevelopmentalIntent;
  notes?: string;
};

export type ActionFamilyPolarityPlan = {
  label: TrainableActionLabel;
  canonicalSeed: string;
  targetCount: number;
};

export type ActionFamilyPlan = {
  familyId: string;
  contrastGroup: string;
  domain: ActionDatasetDomain;
  role: ActionDatasetRole;
  purpose: string;
  polarities: ActionFamilyPolarityPlan[];
};

export type ActionExampleBundle = {
  familyId: string;
  contrastGroup: string;
  domain: ActionDatasetDomain;
  role: ActionDatasetRole;
  label: ActionEvidenceLabel;
  developmentalIntents: DevelopmentalIntent[];
  texts: string[];
};
