/**
 * Deterministic INVALID layer. Not a semantic classifier.
 * Rejects malformed/junk input before MiniLM. Independent of p_dev.
 */

const GENERIC_STUFFING_TOKENS = new Set([
  'progress',
  'improvement',
  'development',
  'developmental',
  'career',
  'academic',
  'academics',
  'fitness',
  'productive',
  'productivity',
  'discipline',
  'growth',
  'xp',
  'points',
]);

const PUNCT_ONLY = /^[.?,!\-:;/~*_'"“”‘’]+$/;

function compactAlnum(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function tokenizeAction(text: string) {
  return String(text)
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function isEmptyOrWhitespace(text: string) {
  return !String(text).trim();
}

export function isPunctuationOnlyGarbage(text: string) {
  const compact = String(text).trim().replace(/\s+/g, '');
  if (compact.length < 3) return false;
  if (compactAlnum(compact)) return false;
  return PUNCT_ONLY.test(compact);
}

/** Same-character run of 10+, or 10+ alnum chars of a single distinct character. */
export function isCharacterSpam(text: string) {
  const trimmed = String(text).trim();
  if (!trimmed) return false;

  const compact = trimmed.replace(/\s+/g, '').toLowerCase();
  const chars = Array.from(compact);
  let run = 1;
  for (let i = 1; i < chars.length; i++) {
    if (chars[i] === chars[i - 1]) {
      run += 1;
      if (run >= 10) return true;
    } else {
      run = 1;
    }
  }

  const letters = compactAlnum(compact);
  if (letters.length >= 10 && new Set(Array.from(letters)).size <= 1) return true;
  return false;
}

/**
 * One token repeated 5+ times (career career career…).
 * Does not use a frequency ratio on mixed phrases like "really really".
 */
export function isTokenRepetitionSpam(text: string) {
  const tokens = tokenizeAction(text);
  if (tokens.length < 5) return false;
  return new Set(tokens).size === 1;
}

/**
 * Almost every token is a generic progress/category word, with no other content.
 * "Made progress on my career portfolio" has non-generic tokens and is allowed.
 */
export function isGenericKeywordStuffing(text: string) {
  const tokens = tokenizeAction(text);
  if (tokens.length < 5) return false;
  const unique = new Set(tokens);
  const genericCount = tokens.filter((token) => GENERIC_STUFFING_TOKENS.has(token)).length;
  if (genericCount === tokens.length) return true;
  return unique.size <= 2 && genericCount / tokens.length >= 0.85;
}

export function isDeterministicInvalid(text: string) {
  if (isEmptyOrWhitespace(text)) return true;
  if (isPunctuationOnlyGarbage(text)) return true;
  if (isCharacterSpam(text)) return true;
  if (isTokenRepetitionSpam(text)) return true;
  if (isGenericKeywordStuffing(text)) return true;
  return false;
}
