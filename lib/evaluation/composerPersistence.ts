import type { ComposerGateDecision } from './customComposerGateDecision';

export function canPersistComposerResult(
  decision: ComposerGateDecision,
  points: number
) {
  return decision.kind === 'save' && points > 0;
}

/** Skip 3A only for already-accepted logs whose activity/details did not change. */
export function shouldReevaluateEditedLog(options: {
  existingPoints: number;
  existingSemanticText: string;
  nextSemanticText: string;
}) {
  if (options.existingPoints <= 0) return true;
  return options.existingSemanticText !== options.nextSemanticText;
}

export function applyEditIfAccepted<T>(options: {
  original: T;
  next: T;
  decision: ComposerGateDecision;
  points: number;
}) {
  if (!canPersistComposerResult(options.decision, options.points)) {
    return options.original;
  }
  return options.next;
}
