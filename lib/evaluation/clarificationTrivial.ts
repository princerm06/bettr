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

/**
 * True when clarification is empty, punctuation-only, or an obvious
 * non-informative filler phrase. Exact phrase match after normalize — not length.
 */
export function clarificationIsTrivial(clarification: string) {
  const raw = String(clarification).trim();
  if (!raw) return true;

  const normalized = normalizeKey(raw);
  const spaced = alnumSpaced(normalized);
  const compact = alnumCompact(normalized);

  if (isPunctuationOrPlaceholder(normalized, compact)) return true;
  if (TRIVIAL_SPACED.has(spaced) || TRIVIAL_COMPACT.has(compact)) return true;
  return false;
}
