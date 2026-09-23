/**
 * Destination calendar identity. Provider-neutral ownership tag.
 * Google description is only a transport for the tag — never match on display name.
 */
export const UNSET_DESTINATION_CALENDAR_ID = 'primary';
export const BETTR_DESTINATION_SUMMARY = 'Bettr';
export const BETTR_DESTINATION_OWNERSHIP_PREFIX = 'bettr-dest-v1:';

export function bettrDestinationOwnershipTag(userId: string): string {
  return `${BETTR_DESTINATION_OWNERSHIP_PREFIX}${userId}`;
}

export function bettrDestinationDescription(userId: string): string {
  return `Copy of your Bettr plan. ${bettrDestinationOwnershipTag(userId)}`;
}

export function isUnsetDestinationCalendarId(
  calendarId: string | null | undefined
): boolean {
  return !calendarId || calendarId === UNSET_DESTINATION_CALENDAR_ID;
}

export function isPersistedDedicatedCalendarId(
  calendarId: string | null | undefined
): boolean {
  return typeof calendarId === 'string' && !isUnsetDestinationCalendarId(calendarId);
}

export function descriptionHasBettrOwnership(
  description: string | null | undefined,
  userId: string
): boolean {
  if (!description) return false;
  return description.includes(bettrDestinationOwnershipTag(userId));
}

export type DestinationCatalogEntry = {
  id: string;
  summary?: string | null;
  description?: string | null;
  accessRole?: string | null;
  primary?: boolean;
};

/**
 * Recover a Bettr-owned destination from catalog metadata.
 * Requires the ownership tag and owner access. Display name is ignored.
 */
export function selectOwnedBettrDestination(
  entries: readonly DestinationCatalogEntry[],
  userId: string
): string | null {
  const owned = entries.filter(
    (entry) =>
      Boolean(entry.id) &&
      entry.primary !== true &&
      entry.accessRole === 'owner' &&
      descriptionHasBettrOwnership(entry.description, userId)
  );
  if (owned.length === 0) return null;
  return [...owned].sort((a, b) => a.id.localeCompare(b.id))[0].id;
}
