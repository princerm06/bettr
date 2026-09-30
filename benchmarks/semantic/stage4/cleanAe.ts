/**
 * Clean Action Evidence contract for Stage 4 probes only.
 * AE = evidence a concrete action occurred. Not developmental credit.
 */
import type { Stage3Example } from '../stage3/newExamples';

export type CleanAeRow = {
  id: string;
  text: string;
  y: number;
  source: string;
  note: string;
};

/** Extra contract examples. Not paraphrases of v1/Stage 2 failures. */
export const CLEAN_AE_CONTRACT_EXAMPLES: CleanAeRow[] = [
  {
    id: 'CAE-01',
    text: 'Bought running shoes.',
    y: 1,
    source: 'stage4_clean_contract',
    note: 'completed purchase is still a completed action',
  },
  {
    id: 'CAE-02',
    text: "I'll buy running shoes tomorrow.",
    y: 0,
    source: 'stage4_clean_contract',
    note: 'future purchase is not completed action',
  },
  {
    id: 'CAE-03',
    text: 'I almost bought running shoes.',
    y: 0,
    source: 'stage4_clean_contract',
    note: 'almost-purchase is not completed action',
  },
  {
    id: 'CAE-04',
    text: 'Paid the water bill at the lobby kiosk.',
    y: 1,
    source: 'stage4_clean_contract',
    note: 'errand occurred; developmental value is downstream',
  },
  {
    id: 'CAE-05',
    text: 'I will pay the water bill later.',
    y: 0,
    source: 'stage4_clean_contract',
    note: 'future errand',
  },
  {
    id: 'CAE-06',
    text: 'Did not pay the water bill.',
    y: 0,
    source: 'stage4_clean_contract',
    note: 'negated errand',
  },
  {
    id: 'CAE-07',
    text: 'Returned two library books at the desk.',
    y: 1,
    source: 'stage4_clean_contract',
    note: 'completed ordinary action',
  },
  {
    id: 'CAE-08',
    text: 'Planning to return the library books.',
    y: 0,
    source: 'stage4_clean_contract',
    note: 'plan only',
  },
];

/**
 * Stage 3 mixed AE NEG into completed purchases because those rows are
 * non-developmental. Clean contract flips completed transactions to AE POS.
 */
const COMPLETED_TRANSACTION_IDS = new Set([
  'S3-009',
  'S3-031',
  'S3-039',
  'S3-044',
  'S3-051',
  'S3-059',
  'S3-081',
  'S3-083',
  'S3-093',
  'S3-H05',
  'S3-H13',
]);

export function cleanAeLabelFromStage3(row: Stage3Example): number | null {
  if (row.threeA === 'UNCERTAIN' && row.ae === 'AMBIGUOUS') return null;
  if (COMPLETED_TRANSACTION_IDS.has(row.id)) return 1;
  if (row.ae === 'AMBIGUOUS') return null;
  return row.ae === 'ACTION_POSITIVE' ? 1 : 0;
}
