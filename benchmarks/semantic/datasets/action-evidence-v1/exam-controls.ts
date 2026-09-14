import type { ActionEvidenceLabel } from './schema';

/**
 * Exact production Slayed composer text. Isolated from training and from
 * threshold selection. Fragments are exam-only so the probe is not tuned
 * to this sentence.
 */
export const SLAYED_PRODUCTION_DETAILS =
  'totally slayed the day today 💅 everyone wished they was me, queen behavior fr yuhhhh. beautiful, good looking, fitting good, wearing good, doing good living good sleeping good with lots of men Tackled the day and killed it! Looked fly felt fly was fly';

export const SLAYED_PRODUCTION_COMPOSED = `Slayed\n${SLAYED_PRODUCTION_DETAILS}`;

export type ProtectedControl = {
  id: string;
  text: string;
  expected: ActionEvidenceLabel;
  note: string;
  /** If true, this exact string must not appear in train. */
  isolateFromTrain: boolean;
};

export const PROTECTED_CONTROLS: ProtectedControl[] = [
  {
    id: 'P01',
    text: SLAYED_PRODUCTION_COMPOSED,
    expected: 'ACTION_NEGATIVE',
    note: 'Exact production Slayed composer text (title + details). Exam only.',
    isolateFromTrain: true,
  },
  {
    id: 'P02',
    text: 'Looked fly felt fly was fly',
    expected: 'ACTION_NEGATIVE',
    note: 'Production fragment: appearance vibe, no practice.',
    isolateFromTrain: true,
  },
  {
    id: 'P03',
    text: 'beautiful, good looking, fitting good, wearing good',
    expected: 'ACTION_NEGATIVE',
    note: 'Production fragment: appearance adjectives as the log.',
    isolateFromTrain: true,
  },
  {
    id: 'P04',
    text: 'queen behavior fr yuhhhh',
    expected: 'ACTION_NEGATIVE',
    note: 'Production fragment: queen-behavior / status claim.',
    isolateFromTrain: true,
  },
  {
    id: 'P05',
    text: 'Tackled the day and killed it',
    expected: 'ACTION_NEGATIVE',
    note: 'Production fragment: outcome/vibe without a practice.',
    isolateFromTrain: true,
  },
  {
    id: 'P06',
    text: 'I learned how pointer arithmetic works and completed five CS240 practice problems.',
    expected: 'ACTION_POSITIVE',
    note: 'Protected academic action control.',
    isolateFromTrain: true,
  },
  {
    id: 'P07',
    text: 'Did my full skincare routine and applied moisturizer and sunscreen.',
    expected: 'ACTION_POSITIVE',
    note: 'Protected skincare action control.',
    isolateFromTrain: true,
  },
  {
    id: 'P08',
    text: 'Put together three outfits for my internship conference and practiced coordinating the pieces.',
    expected: 'ACTION_POSITIVE',
    note: 'Protected outfit-coordination action control.',
    isolateFromTrain: true,
  },
  {
    id: 'P09',
    text: 'Ran 5 miles',
    expected: 'ACTION_POSITIVE',
    note: 'Protected endurance action control.',
    isolateFromTrain: true,
  },
  {
    id: 'P10',
    text: 'Meditated for 15 minutes.',
    expected: 'ACTION_POSITIVE',
    note: 'Protected wellbeing action control.',
    isolateFromTrain: true,
  },
  {
    id: 'P11',
    text: 'Applied to 3 internships.',
    expected: 'ACTION_POSITIVE',
    note: 'Protected career action control.',
    isolateFromTrain: true,
  },
  {
    id: 'P12',
    text: 'Practiced guitar for 30 minutes.',
    expected: 'ACTION_POSITIVE',
    note: 'Protected craft action control.',
    isolateFromTrain: true,
  },
  {
    id: 'P13',
    text: 'I deadlifted 315 pounds for five reps.',
    expected: 'ACTION_POSITIVE',
    note: 'Protected lift action control.',
    isolateFromTrain: true,
  },
  {
    id: 'P14',
    text: "Journaled. Wrote about my goals and reflected on today's decisions.",
    expected: 'ACTION_POSITIVE',
    note: 'Protected journaling action control.',
    isolateFromTrain: true,
  },
  {
    id: 'P15',
    text: 'Volunteered and helped serve meals at the community shelter.',
    expected: 'ACTION_POSITIVE',
    note: 'Protected volunteer action control.',
    isolateFromTrain: true,
  },
  {
    id: 'P16',
    text: 'Bought a hoodie.',
    expected: 'ACTION_POSITIVE',
    note: 'Ordinary NON_DEV purchase. Still action-positive.',
    isolateFromTrain: true,
  },
  {
    id: 'P17',
    text: 'Looked in the mirror for a while.',
    expected: 'ACTION_POSITIVE',
    note: 'Ordinary NON_DEV looking. Still action-positive.',
    isolateFromTrain: true,
  },
  {
    id: 'P18',
    text: 'I looked amazing today.',
    expected: 'ACTION_NEGATIVE',
    note: 'Designed contrast: looks claim, same “looked” lemma as outfit work.',
    isolateFromTrain: true,
  },
  {
    id: 'P19',
    text: 'I felt like a beast today.',
    expected: 'ACTION_NEGATIVE',
    note: 'Designed contrast: physical vibe vs deadlift.',
    isolateFromTrain: true,
  },
  {
    id: 'P20',
    text: "I'm so smart.",
    expected: 'ACTION_NEGATIVE',
    note: 'Designed contrast: academic identity vs pointer work.',
    isolateFromTrain: true,
  },
];

export const EXAM_ONLY_BUNDLES = [
  {
    familyId: 'exam.production_slayed',
    contrastGroup: 'exam.production_slayed',
    domain: 'Fashion & Style' as const,
    role: 'exam_holdout' as const,
    label: 'ACTION_NEGATIVE' as const,
    developmentalIntents: ['NOT_AN_ACTION' as const],
    texts: [SLAYED_PRODUCTION_COMPOSED],
  },
  {
    familyId: 'exam.production_fragments',
    contrastGroup: 'exam.production_slayed',
    domain: 'Fashion & Style' as const,
    role: 'exam_holdout' as const,
    label: 'ACTION_NEGATIVE' as const,
    developmentalIntents: [
      'NOT_AN_ACTION' as const,
      'NOT_AN_ACTION' as const,
      'NOT_AN_ACTION' as const,
      'NOT_AN_ACTION' as const,
    ],
    texts: [
      'Looked fly felt fly was fly',
      'beautiful, good looking, fitting good, wearing good',
      'queen behavior fr yuhhhh',
      'Tackled the day and killed it',
    ],
  },
];
