/**
 * Frozen P1 two-axis product policy.
 * Pure mapping only. Does not score, combine, or average axes.
 */
import type { ActionEvidenceBand } from './actionEvidence';
import type { DevelopmentalSemanticStatus } from './developmentalProductPolicy';

export type TwoAxisPolicyOutcome =
  | 'CREDIT'
  | 'CLARIFICATION'
  | 'NO_CREDIT_ACTION_EVIDENCE'
  | 'NO_CREDIT_NON_DEVELOPMENTAL';

export type DevelopmentalEvidenceBand =
  | 'NON_DEVELOPMENTAL'
  | 'DEVELOPMENTAL_UNCERTAIN'
  | 'DEVELOPMENTAL';

export function developmentalStatusToBand(
  status: Exclude<DevelopmentalSemanticStatus, 'INVALID'>
): DevelopmentalEvidenceBand {
  if (status === 'UNCERTAIN') return 'DEVELOPMENTAL_UNCERTAIN';
  return status;
}

/**
 * P1: action-first conservative.
 * Developmental evidence is consulted only after CONFIDENT_ACTION_POSITIVE.
 */
export function applyTwoAxisProductPolicy(
  actionBand: ActionEvidenceBand,
  developmentalBand?: DevelopmentalEvidenceBand | null
): TwoAxisPolicyOutcome {
  if (actionBand === 'CONFIDENT_ACTION_NEGATIVE') return 'NO_CREDIT_ACTION_EVIDENCE';
  if (actionBand === 'ACTION_UNCERTAIN') return 'CLARIFICATION';
  if (!developmentalBand) {
    throw new Error('P1 requires Candidate 3A.2 after CONFIDENT_ACTION_POSITIVE.');
  }
  if (developmentalBand === 'NON_DEVELOPMENTAL') return 'NO_CREDIT_NON_DEVELOPMENTAL';
  if (developmentalBand === 'DEVELOPMENTAL_UNCERTAIN') return 'CLARIFICATION';
  return 'CREDIT';
}

export function mapTwoAxisOutcomeToGateStatus(outcome: TwoAxisPolicyOutcome) {
  if (outcome === 'CREDIT') return 'DEVELOPMENTAL' as const;
  if (outcome === 'CLARIFICATION') return 'UNCERTAIN' as const;
  return 'NON_DEVELOPMENTAL' as const;
}
