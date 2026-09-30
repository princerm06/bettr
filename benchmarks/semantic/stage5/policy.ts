/**
 * Pre-registered Stage 5 decision policy.
 * Thresholds are fixed before looking at model scores. Not a sweep.
 */
import type { NliGold } from './examples';

export type Probs = {
  entails: number;
  neutral: number;
  contradicts: number;
};

export type Decision = 'SUPPORTS' | 'CONTRADICTS' | 'INSUFFICIENT';

/** Majority-class entailment only. Ties do not support. */
export const PRIMARY_ENTAIL_MIN = 0.5;
export const PRIMARY_CONTRADICT_MIN = 0.5;

export function decidePrimary(probs: Probs): Decision {
  if (
    probs.entails >= PRIMARY_ENTAIL_MIN &&
    probs.entails > probs.neutral &&
    probs.entails > probs.contradicts
  ) {
    return 'SUPPORTS';
  }
  if (
    probs.contradicts >= PRIMARY_CONTRADICT_MIN &&
    probs.contradicts > probs.entails &&
    probs.contradicts >= probs.neutral
  ) {
    return 'CONTRADICTS';
  }
  return 'INSUFFICIENT';
}

export function decideAt(probs: Probs, entailMin: number): Decision {
  if (probs.entails >= entailMin && probs.entails > probs.neutral && probs.entails > probs.contradicts) {
    return 'SUPPORTS';
  }
  if (
    probs.contradicts >= PRIMARY_CONTRADICT_MIN &&
    probs.contradicts > probs.entails &&
    probs.contradicts >= probs.neutral
  ) {
    return 'CONTRADICTS';
  }
  return 'INSUFFICIENT';
}

export function argmaxLabel(probs: Probs): NliGold {
  if (probs.entails >= probs.neutral && probs.entails >= probs.contradicts) return 'entails';
  if (probs.contradicts >= probs.neutral && probs.contradicts > probs.entails) return 'contradicts';
  return 'neutral';
}
