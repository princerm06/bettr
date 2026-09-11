/**
 * Clarification-only product safeguard.
 * Frozen MiniLM + 3A.2 can treat filler clarification as additional evidence.
 * This helper is not part of the probe and does not classify NON vs DEV.
 */

const TRIVIAL_SPACED = new Set([
  'idk',
  'i dont know',
  'dont know',
  'not sure',
  'maybe',
  'yeah',
  'yes',
  'no',
  'ok',
  'okay',
  'lol',
  'whatever',
  'nothing',
  'na',
  'n a',
  'because',
  'i guess',
  'hard to explain',
  'asdf',
  'test',
]);

const TRIVIAL_COMPACT = new Set(
  [...TRIVIAL_SPACED].map((phrase) => phrase.replace(/\s+/g, ''))
);

const FILLER_TOKENS = new Set([
  'a',
  'an',
  'and',
  'are',
  'at',
  'be',
  'been',
  'being',
  'did',
  'do',
  'does',
  'doing',
  'done',
  'for',
  'get',
  'go',
  'going',
  'good',
  'got',
  'had',
  'has',
  'have',
  'i',
  'im',
  'in',
  'is',
  'it',
  'its',
  'just',
  'kinda',
  'like',
  'me',
  'my',
  'nice',
  'of',
  'ok',
  'okay',
  'on',
  'really',
  'some',
  'something',
  'stuff',
  'the',
  'thing',
  'things',
  'this',
  'to',
  'tried',
  'try',
  'was',
  'were',
  'with',
  'yeah',
  'you',
]);

const SHORT_CONTENT = new Set(['pr', 'km', 'mi', 'hr']);

function normalizeKey(text: string) {
  return String(text)
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/'/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function alnumSpaced(normalized: string) {
  return normalized.replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function alnumCompact(normalized: string) {
  return normalized.replace(/[^a-z0-9]+/g, '');
}

function isPunctuationOrPlaceholder(raw: string, compact: string) {
  if (compact) return false;
  const marks = raw.replace(/\s+/g, '');
  if (!marks) return true;
  return /^[.?,!\-:;/~*_'"“”‘’]+$/.test(marks);
}

function contentTokens(text: string) {
  const spaced = alnumSpaced(normalizeKey(text));
  if (!spaced) return [];
  return spaced.split(' ').filter((token) => {
    if (!token) return false;
    if (/\d/.test(token)) return true;
    if (SHORT_CONTENT.has(token)) return true;
    if (FILLER_TOKENS.has(token)) return false;
    return token.length >= 3;
  });
}

/**
 * True when clarification is empty, punctuation-only, an obvious
 * non-informative filler phrase, or adds no concrete content tokens.
 * Optional original text lets restatements of the same action count as trivial.
 */
export function clarificationIsTrivial(clarification: string, originalText = '') {
  const raw = String(clarification).trim();
  if (!raw) return true;

  const normalized = normalizeKey(raw);
  const spaced = alnumSpaced(normalized);
  const compact = alnumCompact(normalized);

  if (isPunctuationOrPlaceholder(normalized, compact)) return true;
  if (TRIVIAL_SPACED.has(spaced) || TRIVIAL_COMPACT.has(compact)) return true;

  const tokens = contentTokens(raw);
  if (!tokens.length) return true;

  const original = String(originalText).trim();
  if (original) {
    const originalTokens = new Set(contentTokens(original));
    const novel = tokens.filter((token) => !originalTokens.has(token));
    if (!novel.length) return true;
  }

  return false;
}
