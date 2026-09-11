/**
 * Frozen Phase 1 product mapping for Candidate #3A.
 * Pure helpers: no model I/O. p_dev is never an XP multiplier.
 */

export { isDeterministicInvalid } from './deterministicInvalid';

export const PRODUCT_PROBE_FILE = 'developmental-3a.2.json';
export const PRODUCT_NON_MAX = 0.45;
export const PRODUCT_DEV_MIN = 0.55;

export type DevelopmentalSemanticStatus =
  | 'INVALID'
  | 'NON_DEVELOPMENTAL'
  | 'UNCERTAIN'
  | 'DEVELOPMENTAL';

export type DevelopmentalGateStatus = DevelopmentalSemanticStatus | 'TECHNICAL_FAILURE';

/** NARROW product band. Research binary 0.50 is not used for product states. */
export function mapProbabilityToStatus(pDev: number): Exclude<
  DevelopmentalSemanticStatus,
  'INVALID'
> {
  if (pDev <= PRODUCT_NON_MAX) return 'NON_DEVELOPMENTAL';
  if (pDev >= PRODUCT_DEV_MIN) return 'DEVELOPMENTAL';
  return 'UNCERTAIN';
}
