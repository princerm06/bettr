/**
 * Clarification-only product safeguard.
 * Frozen MiniLM + 3A.2 does not reliably treat explicit denial as non-developmental.
 * This helper is not part of the probe and must not affect first-pass scoring.
 */

function normalizeClarification(text: string) {
  return String(text)
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\bdidn't\b/g, 'did not')
    .replace(/\bhaven't\b/g, 'have not')
    .replace(/\bhasn't\b/g, 'has not')
    .replace(/\bwasn't\b/g, 'was not')
    .replace(/\bweren't\b/g, 'were not')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Later completion/reversal beats earlier negation, talking, or intention. */
const COMPLETION_OVERRIDE =
  /\b(?:but i completed|but completed|then i completed|then i actually completed|actually completed|ended up completing|actually went out and completed|changed my mind and|i trained anyway|then i ran|then i studied|then i trained|i studied for|finished)\b/;

const TALKED_ABOUT =
  /\b(?:only|just) (?:talked|talking) about\b|\bjust talking about\b/;

const DID_NOT_ACTUALLY = /\bdid not actually\b/;

const DID_NOT_AT_ALL = /\bdid not .{0,80}? at all\b/;

const INTENTION_THEN_FAILURE =
  /\b(?:planned to|meant to|wanted to|was going to|were going to)\b.{0,160}?\bbut (?:i )?(?:did not|never)\b/;

const MEANT_TO_BUT_SPENT = /\bmeant to\b.{0,160}?\bbut (?:i )?spent\b/;

const THOUGHT_ABOUT_THEN_DID_NOT =
  /\bthought about\b.{0,160}?\bbut (?:i )?(?:did not|never)\b/;

const THOUGHT_ABOUT_AVOIDANCE =
  /\bthought about (?:skipping|skip\b|quitting|giving up|not )/;

const ACTION =
  '(?:run|ran|study|studied|train|trained|lift|lifted|practice|practiced|apply|applied|meditate|meditated|cook|cooked|save|saved|complete|completed|workout|worked out)';

const DID_NOT_ACTION = new RegExp(`\\bdid not (?:actually )?${ACTION}\\b`);
const HAVE_NOT_ACTION = new RegExp(`\\bhave not ${ACTION}\\b`);
const NEVER_ACTION = new RegExp(`\\bnever ${ACTION}\\b`);
const BUT_NEVER_ACTION = new RegExp(`\\bbut (?:i )?never ${ACTION}\\b`);

/**
 * True when clarification text explicitly denies, retracts, or states that
 * the claimed action did not occur. Contrastive/completed negation is allowed.
 */
export function clarificationExplicitlyDeniesAction(clarification: string) {
  const text = normalizeClarification(clarification);
  if (!text) return false;

  if (COMPLETION_OVERRIDE.test(text)) return false;

  if (TALKED_ABOUT.test(text)) return true;
  if (DID_NOT_ACTUALLY.test(text)) return true;
  if (DID_NOT_AT_ALL.test(text)) return true;
  if (MEANT_TO_BUT_SPENT.test(text)) return true;
  if (INTENTION_THEN_FAILURE.test(text)) return true;
  if (THOUGHT_ABOUT_THEN_DID_NOT.test(text) && !THOUGHT_ABOUT_AVOIDANCE.test(text)) {
    return true;
  }
  if (HAVE_NOT_ACTION.test(text)) return true;
  if (NEVER_ACTION.test(text) || BUT_NEVER_ACTION.test(text)) return true;
  if (DID_NOT_ACTION.test(text)) return true;

  return false;
}
