import type { DevelopmentalGateStatus } from './developmentalProductPolicy';

export type ComposerGateNotice =
  | 'invalid'
  | 'non'
  | 'uncertain'
  | 'uncertain_rejected'
  | 'technical'
  | 'scoring_conflict'
  | 'clarification_needed';

export type ComposerGateDecision =
  | { kind: 'need_clarification_text' }
  | { kind: 'reject'; notice: ComposerGateNotice; closeClarification: boolean }
  | { kind: 'ask_clarification' }
  | { kind: 'save' };

export function decideCustomComposerSubmit(options: {
  clarificationPass: boolean;
  clarificationText: string;
  status?: DevelopmentalGateStatus;
}): ComposerGateDecision {
  if (options.clarificationPass && !options.clarificationText.trim()) {
    return { kind: 'need_clarification_text' };
  }

  const status = options.status;
  if (!status) {
    throw new Error('Missing gate status after evaluation.');
  }

  if (status === 'TECHNICAL_FAILURE') {
    return { kind: 'reject', notice: 'technical', closeClarification: false };
  }
  if (status === 'INVALID') {
    return { kind: 'reject', notice: 'invalid', closeClarification: options.clarificationPass };
  }
  if (status === 'NON_DEVELOPMENTAL') {
    return { kind: 'reject', notice: 'non', closeClarification: true };
  }
  if (status === 'UNCERTAIN') {
    if (options.clarificationPass) {
      return { kind: 'reject', notice: 'uncertain_rejected', closeClarification: true };
    }
    return { kind: 'ask_clarification' };
  }
  return { kind: 'save' };
}

export function wouldCallOnSave(decision: ComposerGateDecision) {
  return decision.kind === 'save';
}
