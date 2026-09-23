/**
 * Deterministic Google Calendar event IDs from Bettr occurrence UUIDs.
 *
 * Google events.insert IDs must:
 * - be 5–1024 characters
 * - use only base32hex: digits 0-9 and lowercase a-v
 *   (RFC 2938 §3.1.2)
 *
 * Encoding:
 *   "bttr" + occurrence UUID with hyphens stripped, lowercased
 *
 * Example:
 *   11111111-1111-4111-8111-111111111111
 *   → bttr11111111111141118111111111111111
 *
 * Hex 0-9a-f is a subset of base32hex. Length is 36 (≥ 26 recommended).
 * The occurrence UUID is the Bettr identity; title/date are never used.
 */
import { isUuid } from './oauth';

export const GOOGLE_EVENT_ID_PREFIX = 'bttr';

export function googleEventIdFromOccurrenceId(occurrenceId: string): string {
  if (!isUuid(occurrenceId)) {
    throw new Error('Occurrence id is not valid.');
  }
  return `${GOOGLE_EVENT_ID_PREFIX}${occurrenceId.replace(/-/g, '').toLowerCase()}`;
}

export function isGoogleEventIdShape(value: string): boolean {
  return /^[0-9a-v]{5,1024}$/.test(value);
}
