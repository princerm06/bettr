import { decideCustomComposerSubmit } from './customComposerGateDecision';
import type { DevelopmentalGateStatus } from './developmentalProductPolicy';
import { isComposerSemanticInputInvalid, composeSemanticLogText } from './customComposerSemantic';
import { isDeterministicInvalid } from './deterministicInvalid';
import { clarificationIsTrivial } from './clarificationTrivial';

export type ComposerGateNotice =
  | 'invalid'
  | 'non'
  | 'uncertain'
  | 'uncertain_rejected'
  | 'technical'
  | 'scoring_conflict'
  | 'clarification_needed'
  | null;

export type ComposerSubmitPrecheck =
  | { type: 'noop' }
  | { type: 'invalid' }
  | { type: 'need_clarification_text' }
  | { type: 'evaluate'; originalText: string; clarificationPass: boolean };

/**
 * Live-path spam check used by CustomComposer.
 * Do not use `c >= 'a' && c <= 'z'` — Next/SWC has compiled that range
 * incorrectly in the browser while tsc/Node tests still passed.
 */
export function isRepeatedCharacterSpam(text: string) {
  const compact = String(text).trim().toLowerCase().replace(/\s+/g, '');
  if (compact.length < 10) return false;
  const first = compact.charAt(0);
  if (!first) return false;
  return compact === first.repeat(compact.length);
}

export function composerFieldsAreInvalid(activity: string, details: string) {
  return isComposerSemanticInputInvalid(activity, details);
}

export function resolveComposerSubmitPrecheck(input: {
  activity: string;
  details: string;
  awaitingClarification: boolean;
  frozenOriginalText: string | null;
  clarificationText: string;
}): ComposerSubmitPrecheck {
  const cleanActivity = input.activity.trim();
  if (!cleanActivity) return { type: 'noop' };

  const originalText = composeSemanticLogText(cleanActivity, input.details);
  const clarificationPass =
    input.awaitingClarification && input.frozenOriginalText === originalText;

  if (clarificationPass && !input.clarificationText.trim()) {
    return { type: 'need_clarification_text' };
  }

  if (
    clarificationPass &&
    !clarificationIsTrivial(input.clarificationText) &&
    isDeterministicInvalid(input.clarificationText)
  ) {
    return { type: 'invalid' };
  }

  if (!clarificationPass && composerFieldsAreInvalid(cleanActivity, input.details)) {
    return { type: 'invalid' };
  }

  return { type: 'evaluate', originalText, clarificationPass };
}

export function applyComposerGateDecisionToUi(input: {
  clarificationPass: boolean;
  status: DevelopmentalGateStatus;
}): {
  persist: boolean;
  awaitingClarification: boolean;
  gateNotice: ComposerGateNotice;
} {
  const decision = decideCustomComposerSubmit({
    clarificationPass: input.clarificationPass,
    clarificationText: input.clarificationPass ? 'x' : '',
    status: input.status,
  });

  if (decision.kind === 'save') {
    return { persist: true, awaitingClarification: false, gateNotice: null };
  }
  if (decision.kind === 'ask_clarification') {
    return { persist: false, awaitingClarification: true, gateNotice: 'uncertain' };
  }
  if (decision.kind === 'reject') {
    return {
      persist: false,
      awaitingClarification: false,
      gateNotice: decision.notice,
    };
  }
  return { persist: false, awaitingClarification: false, gateNotice: 'clarification_needed' };
}
