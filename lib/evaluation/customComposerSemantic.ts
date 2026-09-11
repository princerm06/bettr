/**
 * Custom-composer semantic text + UX copy.
 * p_dev is never included here and must never be rendered.
 */
import { isDeterministicInvalid } from './developmentalProductPolicy';

export function composeSemanticLogText(activity: string, details: string) {
  const cleanActivity = activity.trim();
  const cleanDetails = details.trim();
  if (!cleanDetails) return cleanActivity;
  return `${cleanActivity}\n${cleanDetails}`;
}

export function isComposerSemanticInputInvalid(activity: string, details: string) {
  if (isDeterministicInvalid(activity)) return true;
  if (details.trim() && isDeterministicInvalid(details)) return true;
  return isDeterministicInvalid(composeSemanticLogText(activity, details));
}

export function composeClarificationSemanticText(
  originalSemanticText: string,
  clarification: string
) {
  return `Original action:\n${originalSemanticText}\n\nAdditional context:\n${clarification.trim()}`;
}

export const COMPOSER_GATE_COPY = {
  invalid: 'Describe what you did so Bettr can understand the action.',
  non: "This doesn't appear to count toward your progress.",
  uncertainHeading: 'Tell Bettr a little more',
  uncertainBody:
    'Add what you did or accomplished so Bettr can determine whether this counts toward your progress.',
  uncertainRejected:
    "Bettr still can't confidently determine how this counts toward your progress. Try making the action more specific.",
  technical: "Bettr couldn't check this action right now. Try again.",
  scoringConflict: "Bettr couldn't award progress for this entry. Try again.",
  checking: 'Checking your action…',
  gettingReady: 'Bettr is getting ready…',
  recheck: 'Continue / Recheck action',
} as const;

export function persistDetailsAfterGate(options: {
  details: string;
  clarificationPass: boolean;
  clarificationText: string;
}) {
  const details = options.details.trim();
  if (!options.clarificationPass) return details;
  const extra = options.clarificationText.trim();
  if (!extra) return details;
  if (!details) return extra;
  return `${details}\n${extra}`;
}

export function gatedProgressInsight(
  labels: string,
  details: string,
  hasImage: boolean
) {
  const extra =
    details.trim() || hasImage
      ? ' Extra context is saved with the entry.'
      : '';
  return `${labels}: logged as progress.${extra}`;
}

export function shouldResetClarificationSession(
  frozenOriginalText: string | null,
  nextOriginalText: string
) {
  return frozenOriginalText !== null && nextOriginalText !== frozenOriginalText;
}
