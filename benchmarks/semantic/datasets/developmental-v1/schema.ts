/**
 * Candidate #3A developmental-validity dataset schema.
 *
 * Official trained task is binary:
 *   DEVELOPMENTAL | NON_DEVELOPMENTAL
 *
 * UNCERTAIN is a dataset label for auxiliary/challenge evaluation only.
 * It is never a supervised class for Candidate #3A.
 */

export const DEVELOPMENTAL_LABELS = [
  'DEVELOPMENTAL',
  'NON_DEVELOPMENTAL',
  'UNCERTAIN',
] as const;

export type DevelopmentalLabel = (typeof DEVELOPMENTAL_LABELS)[number];

export const TRAINABLE_LABELS = [
  'DEVELOPMENTAL',
  'NON_DEVELOPMENTAL',
] as const;

export type TrainableDevelopmentalLabel = (typeof TRAINABLE_LABELS)[number];

export const DATASET_ROLES = [
  'core_trainable',
  'uncertain_auxiliary',
  'stress_auxiliary',
] as const;

export type DatasetRole = (typeof DATASET_ROLES)[number];

export const DATASET_SPLITS = ['train', 'val', 'aux'] as const;
export type DatasetSplit = (typeof DATASET_SPLITS)[number];

export const BETTR_V1_DOMAINS = [
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

export type DatasetDomain = (typeof BETTR_V1_DOMAINS)[number];

export type DevelopmentalExample = {
  id: string;
  text: string;
  label: DevelopmentalLabel;
  familyId: string;
  contrastGroup: string;
  domain: DatasetDomain;
  role: DatasetRole;
  /** Assigned only after family-level split is approved and frozen. */
  split?: DatasetSplit;
  notes?: string;
};

export type FamilyPolarityPlan = {
  label: DevelopmentalLabel;
  /** Canonical seed that defines the family. Not a paraphrase expansion. */
  canonicalSeed: string;
  /** Target example count when the full dataset is generated later. */
  targetCount: number;
};

export type DevelopmentalFamilyPlan = {
  familyId: string;
  contrastGroup: string;
  domain: DatasetDomain;
  role: DatasetRole;
  purpose: string;
  polarities: FamilyPolarityPlan[];
};
