/**
 * Routine write/normalization and database mapping.
 * Intention only: no XP, semantic evaluation, or Log scoring.
 */
import {
  isIanaTimeZone,
  isLocalScheduledTime,
  isPlanningCategoryKey,
  isPlanningIsoWeekday,
  isPlanningRecurrenceType,
  isValidDurationMinutes,
  isValidPlanningCategories,
  isValidPlanningTitle,
  isValidRoutine,
  isValidRoutineRecurrence,
  isValidRoutineWeekdayLabels,
  normalizeLocalScheduledTime,
  samePlanningOwner,
} from './invariants';
import {
  PLANNING_ISO_WEEKDAYS,
  PLANNING_TITLE_MAX_LENGTH,
  type PlanningCategoryKey,
  type PlanningIsoWeekday,
  type PlanningRecurrenceType,
  type Routine,
  type RoutineWeekdayLabels,
} from './types';
import { isoWeekdayFromLocalDate } from './localCalendar';

export const ROUTINE_CREATE_IS_ACTIVE = true as const;
export const ROUTINE_CREATE_EXTERNAL_CALENDAR_ENABLED = true as const;

export const ROUTINE_TABLE_COLUMNS = [
  'id',
  'user_id',
  'title',
  'description',
  'categories',
  'goal_id',
  'recurrence_type',
  'weekdays',
  'weekday_labels',
  'scheduled_time',
  'duration_minutes',
  'timezone',
  'is_active',
  'external_calendar_enabled',
  'deleted_at',
  'created_at',
  'updated_at',
] as const;

export const ROUTINE_DOMAIN_FIELDS = [
  'id',
  'userId',
  'title',
  'description',
  'categories',
  'goalId',
  'recurrenceType',
  'weekdays',
  'weekdayLabels',
  'scheduledTime',
  'durationMinutes',
  'timezone',
  'isActive',
  'externalCalendarEnabled',
  'deletedAt',
  'createdAt',
  'updatedAt',
] as const;

export const ROUTINE_VALIDATION_MESSAGES = {
  signedIn: 'Sign in to manage routines.',
  owner: 'You can only manage your own routines.',
  title: 'Give this routine a name.',
  titleTooLong: `Keep the name under ${PLANNING_TITLE_MAX_LENGTH} characters.`,
  categories: 'Choose 1–3 areas this routine supports.',
  categoriesUnknown: "Choose from Bettr's development areas.",
  recurrence: 'Choose daily or weekly.',
  weekdays: 'Pick at least one weekday for a weekly routine.',
  weekdaysDaily: 'Daily routines do not use weekdays.',
  weekdayLabels: 'Day labels must match a selected weekday and stay under 200 characters.',
  weekdayLabelsDaily: 'Daily routines do not use day-specific labels.',
  goal: 'That goal could not be linked.',
  scheduledTime: 'Use a real local time.',
  duration: 'Duration must be a whole number of minutes.',
  timezone: 'Choose a real timezone.',
  active: 'That routine status is not available.',
  calendar: 'Choose whether this routine should appear on a connected calendar.',
  deleteActive: 'Archive this routine before deleting it permanently.',
  alreadyDeleted: 'That routine is already removed.',
  archiveOccurrences:
    'Routine archived, but some planned days could not be updated. Try again.',
  deleteOccurrences:
    'Could not close remaining planned days before removing this routine. Try again.',
} as const;

export const WEEKDAY_LABELS: Record<PlanningIsoWeekday, string> = {
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
  7: 'Sun',
};

export const WEEKDAY_FULL_LABELS: Record<PlanningIsoWeekday, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};

export type RoutineRow = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  categories: string[];
  goal_id: string | null;
  recurrence_type: string;
  weekdays: number[] | null;
  weekday_labels: Record<string, string> | null;
  scheduled_time: string | null;
  duration_minutes: number | null;
  timezone: string;
  is_active: boolean;
  external_calendar_enabled: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type RoutineInsertRow = {
  user_id: string;
  title: string;
  description: string | null;
  categories: PlanningCategoryKey[];
  goal_id: string | null;
  recurrence_type: PlanningRecurrenceType;
  weekdays: PlanningIsoWeekday[] | null;
  weekday_labels: Record<string, string> | null;
  scheduled_time: string | null;
  duration_minutes: number | null;
  timezone: string;
  is_active: boolean;
  external_calendar_enabled: boolean;
};

export type RoutineUpdateRow = {
  title: string;
  description: string | null;
  categories: PlanningCategoryKey[];
  goal_id: string | null;
  recurrence_type: PlanningRecurrenceType;
  weekdays: PlanningIsoWeekday[] | null;
  weekday_labels: Record<string, string> | null;
  scheduled_time: string | null;
  duration_minutes: number | null;
  timezone: string;
  external_calendar_enabled: boolean;
  updated_at: string;
};

export type RoutineActiveUpdateRow = {
  is_active: boolean;
  updated_at: string;
};

export type RoutineTombstoneUpdateRow = {
  is_active: false;
  deleted_at: string;
  updated_at: string;
};

export type RoutineWriteInput = {
  title: unknown;
  description?: unknown;
  categories: unknown;
  goalId?: unknown;
  recurrenceType: unknown;
  weekdays?: unknown;
  weekdayLabels?: unknown;
  scheduledTime?: unknown;
  durationMinutes?: unknown;
  timezone: unknown;
  externalCalendarEnabled?: unknown;
};

export type RoutinePrepareSuccess<T> = { ok: true; value: T };
export type RoutinePrepareFailure = { ok: false; error: string };
export type RoutinePrepareResult<T> =
  | RoutinePrepareSuccess<T>
  | RoutinePrepareFailure;

/** 12-hour picker period for routine scheduled-time UI. */
export type LocalTimePeriod = 'AM' | 'PM';

export type LocalTimePickerParts = {
  hour12: string;
  minute: string;
  period: LocalTimePeriod;
};

/**
 * Split a persisted local scheduled time (HH:MM or HH:MM:SS) into 12-hour
 * picker parts. Empty/invalid values yield an empty hour/minute with AM.
 */
export function localScheduledTimeToPickerParts(
  value: string | null | undefined
): LocalTimePickerParts {
  if (!value || value.length < 5) {
    return { hour12: '', minute: '', period: 'AM' };
  }
  const hour24 = Number(value.slice(0, 2));
  const minute = value.slice(3, 5);
  if (
    !Number.isInteger(hour24) ||
    hour24 < 0 ||
    hour24 > 23 ||
    !/^[0-5]\d$/.test(minute)
  ) {
    return { hour12: '', minute: '', period: 'AM' };
  }
  const period: LocalTimePeriod = hour24 < 12 ? 'AM' : 'PM';
  const hour12Num = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return {
    hour12: String(hour12Num).padStart(2, '0'),
    minute,
    period,
  };
}

/**
 * Compose HH:MM from 12-hour picker parts. Returns '' when hour or minute is
 * missing so the form can treat time as optional/cleared.
 */
export function composeLocalScheduledTimeFromPickerParts(
  hour12: string,
  minute: string,
  period: LocalTimePeriod
): string {
  if (!hour12 || !minute) return '';
  if (!/^(0?[1-9]|1[0-2])$/.test(hour12) || !/^[0-5]\d$/.test(minute)) {
    return '';
  }
  if (period !== 'AM' && period !== 'PM') return '';
  const hour12Num = Number(hour12);
  let hour24: number;
  if (period === 'AM') {
    hour24 = hour12Num === 12 ? 0 : hour12Num;
  } else {
    hour24 = hour12Num === 12 ? 12 : hour12Num + 12;
  }
  return `${String(hour24).padStart(2, '0')}:${minute}`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeTitle(value: unknown): RoutinePrepareResult<string> {
  if (typeof value !== 'string') {
    return { ok: false, error: ROUTINE_VALIDATION_MESSAGES.title };
  }
  const trimmed = value.trim();
  if (trimmed.length < 1) {
    return { ok: false, error: ROUTINE_VALIDATION_MESSAGES.title };
  }
  if (trimmed.length > PLANNING_TITLE_MAX_LENGTH) {
    return { ok: false, error: ROUTINE_VALIDATION_MESSAGES.titleTooLong };
  }
  if (!isValidPlanningTitle(trimmed)) {
    return { ok: false, error: ROUTINE_VALIDATION_MESSAGES.title };
  }
  return { ok: true, value: trimmed };
}

function normalizeDescription(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Rejects unknown keys. Dedupes while preserving first-seen order, then
 * requires exactly 1–3 canonical categories.
 */
export function normalizeRoutineCategories(
  value: unknown
): RoutinePrepareResult<PlanningCategoryKey[]> {
  if (!Array.isArray(value)) {
    return { ok: false, error: ROUTINE_VALIDATION_MESSAGES.categories };
  }

  const unique: PlanningCategoryKey[] = [];
  for (const item of value) {
    if (!isPlanningCategoryKey(item)) {
      return { ok: false, error: ROUTINE_VALIDATION_MESSAGES.categoriesUnknown };
    }
    if (!unique.includes(item)) unique.push(item);
  }

  if (unique.length < 1 || unique.length > 3) {
    return { ok: false, error: ROUTINE_VALIDATION_MESSAGES.categories };
  }

  return { ok: true, value: unique };
}

export function normalizeRoutineWeekdays(
  recurrenceType: PlanningRecurrenceType,
  value: unknown
): RoutinePrepareResult<PlanningIsoWeekday[] | null> {
  if (recurrenceType === 'daily') {
    if (value === null || value === undefined) {
      return { ok: true, value: null };
    }
    if (Array.isArray(value) && value.length === 0) {
      return { ok: true, value: null };
    }
    return { ok: false, error: ROUTINE_VALIDATION_MESSAGES.weekdaysDaily };
  }

  if (!Array.isArray(value) || value.length < 1) {
    return { ok: false, error: ROUTINE_VALIDATION_MESSAGES.weekdays };
  }

  const unique: PlanningIsoWeekday[] = [];
  for (const item of value) {
    const weekday =
      typeof item === 'string' && /^\d+$/.test(item) ? Number(item) : item;
    if (!isPlanningIsoWeekday(weekday)) {
      return { ok: false, error: ROUTINE_VALIDATION_MESSAGES.weekdays };
    }
    if (!unique.includes(weekday)) unique.push(weekday);
  }

  unique.sort((a, b) => a - b);

  if (unique.length < 1 || unique.length > 7) {
    return { ok: false, error: ROUTINE_VALIDATION_MESSAGES.weekdays };
  }

  return { ok: true, value: unique };
}

/**
 * Persistable shape: JSON object with string weekday keys, or null.
 * Empty / whitespace-only labels are dropped. Daily always stores null.
 */
export function normalizeRoutineWeekdayLabels(
  recurrenceType: PlanningRecurrenceType,
  weekdays: PlanningIsoWeekday[] | null,
  value: unknown
): RoutinePrepareResult<Record<string, string> | null> {
  if (recurrenceType === 'daily') {
    if (value === null || value === undefined) {
      return { ok: true, value: null };
    }
    if (
      (Array.isArray(value) && value.length === 0) ||
      (isPlainObject(value) && Object.keys(value).length === 0)
    ) {
      return { ok: true, value: null };
    }
    return { ok: false, error: ROUTINE_VALIDATION_MESSAGES.weekdayLabelsDaily };
  }

  if (value === null || value === undefined) {
    return { ok: true, value: null };
  }

  if (!isPlainObject(value)) {
    return { ok: false, error: ROUTINE_VALIDATION_MESSAGES.weekdayLabels };
  }

  const allowed = new Set(weekdays ?? []);
  const normalized: Record<string, string> = {};

  for (const [rawKey, rawValue] of Object.entries(value)) {
    const weekday =
      typeof rawKey === 'string' && /^\d+$/.test(rawKey)
        ? Number(rawKey)
        : NaN;
    if (!isPlanningIsoWeekday(weekday) || !allowed.has(weekday)) {
      return { ok: false, error: ROUTINE_VALIDATION_MESSAGES.weekdayLabels };
    }
    if (rawValue === null || rawValue === undefined || rawValue === '') {
      continue;
    }
    if (typeof rawValue !== 'string') {
      return { ok: false, error: ROUTINE_VALIDATION_MESSAGES.weekdayLabels };
    }
    const trimmed = rawValue.trim();
    if (trimmed.length < 1) continue;
    if (trimmed.length > PLANNING_TITLE_MAX_LENGTH) {
      return { ok: false, error: ROUTINE_VALIDATION_MESSAGES.weekdayLabels };
    }
    if (!isValidPlanningTitle(trimmed)) {
      return { ok: false, error: ROUTINE_VALIDATION_MESSAGES.weekdayLabels };
    }
    normalized[String(weekday)] = trimmed;
  }

  if (Object.keys(normalized).length === 0) {
    return { ok: true, value: null };
  }

  const domainLabels = mapWeekdayLabelsFromPersisted(normalized);
  if (!isValidRoutineWeekdayLabels(recurrenceType, weekdays, domainLabels)) {
    return { ok: false, error: ROUTINE_VALIDATION_MESSAGES.weekdayLabels };
  }

  return { ok: true, value: normalized };
}

function mapWeekdayLabelsFromPersisted(
  value: unknown
): RoutineWeekdayLabels | null {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value)) return null;
  const labels: RoutineWeekdayLabels = {};
  let count = 0;
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const weekday =
      typeof rawKey === 'string' && /^\d+$/.test(rawKey)
        ? Number(rawKey)
        : NaN;
    if (!isPlanningIsoWeekday(weekday)) return null;
    if (typeof rawValue !== 'string') return null;
    const trimmed = rawValue.trim();
    if (!trimmed || !isValidPlanningTitle(trimmed)) return null;
    labels[weekday] = trimmed;
    count += 1;
  }
  return count > 0 ? labels : null;
}

/**
 * Deterministic occurrence action for a local calendar date.
 * Uses the weekday-specific label when present; otherwise the Routine title.
 */
export function effectiveRoutineActionForLocalDate(
  routine: Pick<Routine, 'title' | 'recurrenceType' | 'weekdayLabels'>,
  localDate: string
): string {
  if (routine.recurrenceType !== 'weekly' || !routine.weekdayLabels) {
    return routine.title;
  }
  const weekday = isoWeekdayFromLocalDate(localDate);
  if (weekday === null) return routine.title;
  const label = routine.weekdayLabels[weekday];
  return label && label.trim() ? label.trim() : routine.title;
}

export type RoutineOccurrencePresentation = {
  /** Primary Today title — today's effective action. */
  actionTitle: string;
  /** Parent Routine title when it differs from the effective action. */
  parentRoutineTitle: string | null;
  /** Full weekday name when a weekday-specific label is shown. */
  weekdayFullLabel: string | null;
  /** Secondary context line, e.g. "Lifting Split · Wednesday". */
  contextLine: string | null;
  usesWeekdayLabel: boolean;
};

/**
 * Today/Planner presentation contract for a Routine occurrence.
 * Does not use the Routine description as today's completed action.
 */
export function presentRoutineOccurrence(
  routine: Pick<Routine, 'title' | 'recurrenceType' | 'weekdayLabels'>,
  localDate: string
): RoutineOccurrencePresentation {
  const actionTitle = effectiveRoutineActionForLocalDate(routine, localDate);
  const weekday = isoWeekdayFromLocalDate(localDate);
  const weekdayLabel =
    weekday !== null &&
    routine.recurrenceType === 'weekly' &&
    routine.weekdayLabels?.[weekday]
      ? routine.weekdayLabels[weekday]!
      : null;
  const usesWeekdayLabel = Boolean(
    weekdayLabel && weekdayLabel.trim() && weekdayLabel.trim() !== routine.title
  );

  if (!usesWeekdayLabel || weekday === null) {
    return {
      actionTitle,
      parentRoutineTitle: null,
      weekdayFullLabel: null,
      contextLine: null,
      usesWeekdayLabel: false,
    };
  }

  const weekdayFullLabel = WEEKDAY_FULL_LABELS[weekday];
  return {
    actionTitle,
    parentRoutineTitle: routine.title,
    weekdayFullLabel,
    contextLine: `${routine.title} · ${weekdayFullLabel}`,
    usesWeekdayLabel: true,
  };
}

function normalizeGoalId(value: unknown): RoutinePrepareResult<string | null> {
  if (value === null || value === undefined || value === '') {
    return { ok: true, value: null };
  }
  if (!isNonEmptyString(value)) {
    return { ok: false, error: ROUTINE_VALIDATION_MESSAGES.goal };
  }
  return { ok: true, value };
}

function normalizeScheduledTime(
  value: unknown
): RoutinePrepareResult<string | null> {
  if (value === null || value === undefined || value === '') {
    return { ok: true, value: null };
  }
  if (typeof value !== 'string' || !isLocalScheduledTime(value)) {
    return { ok: false, error: ROUTINE_VALIDATION_MESSAGES.scheduledTime };
  }
  return { ok: true, value: normalizeLocalScheduledTime(value) };
}

function normalizeDurationMinutes(
  value: unknown
): RoutinePrepareResult<number | null> {
  if (value === null || value === undefined || value === '') {
    return { ok: true, value: null };
  }
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;
  if (!isValidDurationMinutes(parsed)) {
    return { ok: false, error: ROUTINE_VALIDATION_MESSAGES.duration };
  }
  return { ok: true, value: parsed };
}

function normalizeTimezone(value: unknown): RoutinePrepareResult<string> {
  if (typeof value !== 'string' || !isIanaTimeZone(value)) {
    return { ok: false, error: ROUTINE_VALIDATION_MESSAGES.timezone };
  }
  if (value.length > 64) {
    return { ok: false, error: ROUTINE_VALIDATION_MESSAGES.timezone };
  }
  return { ok: true, value };
}

function requireOwnerId(ownerId: unknown): RoutinePrepareResult<string> {
  if (!isNonEmptyString(ownerId)) {
    return { ok: false, error: ROUTINE_VALIDATION_MESSAGES.signedIn };
  }
  return { ok: true, value: ownerId };
}

function normalizeExternalCalendarEnabled(
  value: unknown
): RoutinePrepareResult<boolean> {
  if (value === undefined) {
    return { ok: true, value: ROUTINE_CREATE_EXTERNAL_CALENDAR_ENABLED };
  }
  if (typeof value !== 'boolean') {
    return { ok: false, error: ROUTINE_VALIDATION_MESSAGES.calendar };
  }
  return { ok: true, value };
}

/** Still listed in Active or Archived. Tombstoned routines are not. */
export function isRoutineInLibrary(
  routine: Pick<Routine, 'deletedAt'>
): boolean {
  return routine.deletedAt == null;
}

export function isRoutineLiveForPlanning(
  routine: Pick<Routine, 'isActive' | 'deletedAt'>
): boolean {
  return routine.isActive && isRoutineInLibrary(routine);
}

export function routineAllowsExternalCalendar(
  routine: Pick<Routine, 'isActive' | 'deletedAt' | 'externalCalendarEnabled'>
): boolean {
  return isRoutineLiveForPlanning(routine) && routine.externalCalendarEnabled;
}

export function isRoutineOccurrenceActionable(
  routine: Pick<Routine, 'isActive' | 'deletedAt'>,
  occurrence: Pick<{ status: string }, 'status'>
): boolean {
  return occurrence.status === 'planned' && isRoutineLiveForPlanning(routine);
}

export function detectBrowserTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (isIanaTimeZone(zone) && zone.length <= 64) return zone;
  } catch {
    // fall through
  }
  return 'UTC';
}

/** Fallback IANA zones when Intl.supportedValuesOf is unavailable. */
const FALLBACK_IANA_TIME_ZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'America/Vancouver',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Stockholm',
  'Europe/Warsaw',
  'Europe/Moscow',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Pacific/Auckland',
] as const;

export type TimeZoneOption = {
  value: string;
  label: string;
  /** Letter abbreviations such as EST/EDT for search; not used for persistence. */
  abbreviations: string[];
};

function cityLabelFromIana(value: string): string {
  const city = value.includes('/')
    ? value.slice(value.lastIndexOf('/') + 1)
    : value;
  return city.replace(/_/g, ' ');
}

/**
 * Familiar US/Canada letter abbreviations when ICU only exposes GMT± offsets.
 * Kept small and explicit; storage remains the IANA id.
 */
const FAMILIAR_ZONE_ABBREVIATIONS: Record<string, readonly string[]> = {
  'America/New_York': ['EST', 'EDT'],
  'America/Detroit': ['EST', 'EDT'],
  'America/Kentucky/Louisville': ['EST', 'EDT'],
  'America/Indiana/Indianapolis': ['EST', 'EDT'],
  'America/Toronto': ['EST', 'EDT'],
  'America/Chicago': ['CST', 'CDT'],
  'America/Winnipeg': ['CST', 'CDT'],
  'America/Denver': ['MST', 'MDT'],
  'America/Edmonton': ['MST', 'MDT'],
  'America/Phoenix': ['MST'],
  'America/Los_Angeles': ['PST', 'PDT'],
  'America/Vancouver': ['PST', 'PDT'],
  'Pacific/Honolulu': ['HST'],
};

/**
 * Familiar short abbreviations (EST/EDT, PST/PDT, …) when ICU provides letter forms.
 * Samples winter and summer so DST pairs appear together. Persistence stays IANA.
 */
export function timeZoneShortAbbreviations(value: string): string[] {
  if (!isIanaTimeZone(value)) return [];
  const sampleDates = [
    new Date(Date.UTC(2024, 0, 15, 12, 0, 0)),
    new Date(Date.UTC(2024, 6, 15, 12, 0, 0)),
  ];
  const found: string[] = [];
  const seen = new Set<string>();
  for (const date of sampleDates) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: value,
        timeZoneName: 'short',
      }).formatToParts(date);
      const name = parts
        .find((part) => part.type === 'timeZoneName')
        ?.value?.trim();
      if (!name || !/^[A-Za-z]{2,5}$/.test(name)) continue;
      const upper = name.toUpperCase();
      if (seen.has(upper)) continue;
      seen.add(upper);
      found.push(upper);
    } catch {
      // ignore invalid ICU samples
    }
  }
  if (found.length > 0) return found;
  const fallback = FAMILIAR_ZONE_ABBREVIATIONS[value];
  return fallback ? [...fallback] : [];
}

/**
 * Human-readable label for an IANA zone. Storage remains the IANA id.
 */
export function formatTimeZoneLabel(value: string): string {
  if (!isIanaTimeZone(value)) return value;
  const city = cityLabelFromIana(value);
  const abbreviations = timeZoneShortAbbreviations(value);
  const abbrSuffix =
    abbreviations.length > 0 ? ` · ${abbreviations.join('/')}` : '';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: value,
      timeZoneName: 'longGeneric',
    }).formatToParts(new Date());
    const name = parts.find((part) => part.type === 'timeZoneName')?.value?.trim();
    if (name) return `${name} (${city})${abbrSuffix}`;
  } catch {
    // fall through
  }
  return `${city}${abbrSuffix}`;
}

/**
 * Case-insensitive timezone search across IANA id, city, label, and abbreviations.
 */
export function filterTimeZoneOptions(
  options: TimeZoneOption[],
  query: string
): TimeZoneOption[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return options;
  return options.filter((option) => {
    if (option.label.toLowerCase().includes(normalized)) return true;
    if (option.value.toLowerCase().includes(normalized)) return true;
    if (cityLabelFromIana(option.value).toLowerCase().includes(normalized)) {
      return true;
    }
    return option.abbreviations.some((abbr) =>
      abbr.toLowerCase().includes(normalized)
    );
  });
}

/**
 * Canonical IANA timezone choices for Routine schedule UI.
 * Values are IANA ids; labels are human-readable.
 */
export function listIanaTimeZoneOptions(
  preferred?: string | null
): TimeZoneOption[] {
  const supported =
    typeof Intl !== 'undefined' &&
    typeof (
      Intl as typeof Intl & {
        supportedValuesOf?: (key: string) => string[];
      }
    ).supportedValuesOf === 'function'
      ? (
          Intl as typeof Intl & {
            supportedValuesOf: (key: string) => string[];
          }
        ).supportedValuesOf('timeZone')
      : [...FALLBACK_IANA_TIME_ZONES];

  const unique = new Set<string>();
  for (const zone of supported) {
    if (isIanaTimeZone(zone) && zone.length <= 64) unique.add(zone);
  }

  const browser = detectBrowserTimeZone();
  unique.add(browser);
  if (preferred && isIanaTimeZone(preferred) && preferred.length <= 64) {
    unique.add(preferred);
  }
  unique.add('UTC');

  const options = [...unique]
    .map((value) => {
      const abbreviations = timeZoneShortAbbreviations(value);
      return {
        value,
        label: formatTimeZoneLabel(value),
        abbreviations,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  const pinned: TimeZoneOption[] = [];
  const rest: TimeZoneOption[] = [];
  for (const option of options) {
    if (option.value === browser || option.value === preferred) {
      pinned.push(option);
    } else {
      rest.push(option);
    }
  }

  const seen = new Set<string>();
  const ordered: TimeZoneOption[] = [];
  for (const option of [...pinned, ...rest]) {
    if (seen.has(option.value)) continue;
    seen.add(option.value);
    ordered.push(option);
  }
  return ordered;
}

export function prepareRoutineCreate(
  ownerId: unknown,
  input: RoutineWriteInput
): RoutinePrepareResult<RoutineInsertRow> {
  const owner = requireOwnerId(ownerId);
  if (!owner.ok) return owner;

  const title = normalizeTitle(input.title);
  if (!title.ok) return title;

  const categories = normalizeRoutineCategories(input.categories);
  if (!categories.ok) return categories;

  if (!isPlanningRecurrenceType(input.recurrenceType)) {
    return { ok: false, error: ROUTINE_VALIDATION_MESSAGES.recurrence };
  }

  const weekdays = normalizeRoutineWeekdays(
    input.recurrenceType,
    input.weekdays
  );
  if (!weekdays.ok) return weekdays;

  if (!isValidRoutineRecurrence(input.recurrenceType, weekdays.value)) {
    return {
      ok: false,
      error:
        input.recurrenceType === 'weekly'
          ? ROUTINE_VALIDATION_MESSAGES.weekdays
          : ROUTINE_VALIDATION_MESSAGES.weekdaysDaily,
    };
  }

  const weekdayLabels = normalizeRoutineWeekdayLabels(
    input.recurrenceType,
    weekdays.value,
    input.weekdayLabels
  );
  if (!weekdayLabels.ok) return weekdayLabels;

  const goalId = normalizeGoalId(input.goalId);
  if (!goalId.ok) return goalId;

  const scheduledTime = normalizeScheduledTime(input.scheduledTime);
  if (!scheduledTime.ok) return scheduledTime;

  const durationMinutes = normalizeDurationMinutes(input.durationMinutes);
  if (!durationMinutes.ok) return durationMinutes;

  const timezone = normalizeTimezone(input.timezone);
  if (!timezone.ok) return timezone;

  const externalCalendarEnabled = normalizeExternalCalendarEnabled(
    input.externalCalendarEnabled
  );
  if (!externalCalendarEnabled.ok) return externalCalendarEnabled;

  const mappedLabels = mapWeekdayLabelsFromPersisted(weekdayLabels.value);

  const row: RoutineInsertRow = {
    user_id: owner.value,
    title: title.value,
    description: normalizeDescription(input.description),
    categories: categories.value,
    goal_id: goalId.value,
    recurrence_type: input.recurrenceType,
    weekdays: weekdays.value,
    weekday_labels: weekdayLabels.value,
    scheduled_time: scheduledTime.value,
    duration_minutes: durationMinutes.value,
    timezone: timezone.value,
    is_active: ROUTINE_CREATE_IS_ACTIVE,
    external_calendar_enabled: externalCalendarEnabled.value,
  };

  if (
    !isValidRoutine({
      userId: row.user_id,
      title: row.title,
      description: row.description,
      categories: row.categories,
      goalId: row.goal_id,
      recurrenceType: row.recurrence_type,
      weekdays: row.weekdays,
      weekdayLabels: mappedLabels,
      scheduledTime: row.scheduled_time,
      durationMinutes: row.duration_minutes,
      timezone: row.timezone,
      isActive: row.is_active,
    })
  ) {
    return { ok: false, error: ROUTINE_VALIDATION_MESSAGES.title };
  }

  return { ok: true, value: row };
}

export function prepareRoutineUpdate(
  ownerId: unknown,
  input: RoutineWriteInput
): RoutinePrepareResult<RoutineUpdateRow> {
  const created = prepareRoutineCreate(ownerId, input);
  if (!created.ok) return created;

  return {
    ok: true,
    value: {
      title: created.value.title,
      description: created.value.description,
      categories: created.value.categories,
      goal_id: created.value.goal_id,
      recurrence_type: created.value.recurrence_type,
      weekdays: created.value.weekdays,
      weekday_labels: created.value.weekday_labels,
      scheduled_time: created.value.scheduled_time,
      duration_minutes: created.value.duration_minutes,
      timezone: created.value.timezone,
      external_calendar_enabled: created.value.external_calendar_enabled,
      updated_at: new Date().toISOString(),
    },
  };
}

export function prepareRoutineActiveTransition(
  nextActive: unknown
): RoutinePrepareResult<RoutineActiveUpdateRow> {
  if (typeof nextActive !== 'boolean') {
    return { ok: false, error: ROUTINE_VALIDATION_MESSAGES.active };
  }
  return {
    ok: true,
    value: {
      is_active: nextActive,
      updated_at: new Date().toISOString(),
    },
  };
}

export function prepareRoutineTombstone(
  nowIso: string
): RoutinePrepareResult<RoutineTombstoneUpdateRow> {
  if (!isNonEmptyString(nowIso)) {
    return { ok: false, error: ROUTINE_VALIDATION_MESSAGES.active };
  }
  return {
    ok: true,
    value: {
      is_active: false,
      deleted_at: nowIso,
      updated_at: nowIso,
    },
  };
}

function mapWeekdaysFromRow(value: unknown): PlanningIsoWeekday[] | null {
  if (value === null) return null;
  if (!Array.isArray(value)) return null;
  const weekdays: PlanningIsoWeekday[] = [];
  for (const item of value) {
    const weekday =
      typeof item === 'string' && /^\d+$/.test(item) ? Number(item) : item;
    if (!isPlanningIsoWeekday(weekday)) return null;
    if (!weekdays.includes(weekday)) weekdays.push(weekday);
  }
  weekdays.sort((a, b) => a - b);
  return weekdays;
}

export function routineFromRow(row: unknown, ownerId: string): Routine | null {
  if (!isPlainObject(row)) return null;

  const id = row.id;
  const userId = row.user_id;
  const title = row.title;
  const description = row.description;
  const rawCategories = row.categories;
  const goalId = row.goal_id;
  const recurrenceType = row.recurrence_type;
  const weekdays = mapWeekdaysFromRow(row.weekdays);
  // Backward compatible: missing column (pre-v11) reads as null.
  const weekdayLabels =
    row.weekday_labels === undefined
      ? null
      : mapWeekdayLabelsFromPersisted(row.weekday_labels);
  if (row.weekday_labels !== undefined && row.weekday_labels !== null && weekdayLabels === null) {
    return null;
  }
  const scheduledTime = row.scheduled_time;
  const durationMinutes = row.duration_minutes;
  const timezone = row.timezone;
  const isActive = row.is_active;
  const externalCalendarEnabled =
    row.external_calendar_enabled === undefined
      ? ROUTINE_CREATE_EXTERNAL_CALENDAR_ENABLED
      : row.external_calendar_enabled;
  const deletedAt =
    row.deleted_at === undefined || row.deleted_at === null
      ? null
      : row.deleted_at;
  const createdAt = row.created_at;
  const updatedAt = row.updated_at;

  if (!samePlanningOwner(ownerId, typeof userId === 'string' ? userId : null)) {
    return null;
  }
  if (!isNonEmptyString(id) || !isNonEmptyString(userId)) return null;
  if (typeof title !== 'string') return null;
  if (description !== null && typeof description !== 'string') return null;
  if (goalId !== null && typeof goalId !== 'string') return null;
  if (!isPlanningRecurrenceType(recurrenceType)) return null;
  if (scheduledTime !== null && typeof scheduledTime !== 'string') return null;
  if (durationMinutes !== null && typeof durationMinutes !== 'number') return null;
  if (typeof timezone !== 'string') return null;
  if (typeof isActive !== 'boolean') return null;
  if (typeof externalCalendarEnabled !== 'boolean') return null;
  if (deletedAt !== null && typeof deletedAt !== 'string') return null;
  if (!isNonEmptyString(createdAt) || !isNonEmptyString(updatedAt)) return null;
  if (!isValidPlanningCategories(rawCategories)) return null;
  if (!isValidRoutineRecurrence(recurrenceType, weekdays)) return null;
  if (!isValidRoutineWeekdayLabels(recurrenceType, weekdays, weekdayLabels)) {
    return null;
  }

  const routine: Routine = {
    id,
    userId,
    title: title.trim(),
    description:
      typeof description === 'string' && description.trim() ? description : null,
    categories: rawCategories,
    goalId,
    recurrenceType,
    weekdays,
    weekdayLabels,
    scheduledTime,
    durationMinutes,
    timezone,
    isActive,
    externalCalendarEnabled,
    deletedAt,
    createdAt,
    updatedAt,
  };

  if (
    !isValidRoutine({
      userId: routine.userId,
      title: routine.title,
      description: routine.description,
      categories: routine.categories,
      goalId: routine.goalId,
      recurrenceType: routine.recurrenceType,
      weekdays: routine.weekdays,
      weekdayLabels: routine.weekdayLabels,
      scheduledTime: routine.scheduledTime,
      durationMinutes: routine.durationMinutes,
      timezone: routine.timezone,
      isActive: routine.isActive,
    })
  ) {
    return null;
  }

  return routine;
}

export function mapOwnedRoutineRows(rows: unknown, ownerId: string): Routine[] {
  if (!Array.isArray(rows)) return [];
  const routines: Routine[] = [];
  for (const row of rows) {
    const routine = routineFromRow(row, ownerId);
    if (routine && isRoutineInLibrary(routine)) routines.push(routine);
  }
  return routines;
}

export function formatRoutineRecurrence(routine: Pick<
  Routine,
  'recurrenceType' | 'weekdays'
>): string {
  if (routine.recurrenceType === 'daily') return 'Daily';
  const days = (routine.weekdays ?? [])
    .filter((day): day is PlanningIsoWeekday =>
      (PLANNING_ISO_WEEKDAYS as readonly number[]).includes(day)
    )
    .map((day) => WEEKDAY_LABELS[day]);
  if (days.length === 0) return 'Weekly';
  return `Weekly · ${days.join(', ')}`;
}
