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
} from './types';

export const ROUTINE_CREATE_IS_ACTIVE = true as const;

export const ROUTINE_TABLE_COLUMNS = [
  'id',
  'user_id',
  'title',
  'description',
  'categories',
  'goal_id',
  'recurrence_type',
  'weekdays',
  'scheduled_time',
  'duration_minutes',
  'timezone',
  'is_active',
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
  'scheduledTime',
  'durationMinutes',
  'timezone',
  'isActive',
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
  goal: 'That goal could not be linked.',
  scheduledTime: 'Use a real local time.',
  duration: 'Duration must be a whole number of minutes.',
  timezone: 'Choose a real timezone.',
  active: 'That routine status is not available.',
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

export type RoutineRow = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  categories: string[];
  goal_id: string | null;
  recurrence_type: string;
  weekdays: number[] | null;
  scheduled_time: string | null;
  duration_minutes: number | null;
  timezone: string;
  is_active: boolean;
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
  scheduled_time: string | null;
  duration_minutes: number | null;
  timezone: string;
  is_active: boolean;
};

export type RoutineUpdateRow = {
  title: string;
  description: string | null;
  categories: PlanningCategoryKey[];
  goal_id: string | null;
  recurrence_type: PlanningRecurrenceType;
  weekdays: PlanningIsoWeekday[] | null;
  scheduled_time: string | null;
  duration_minutes: number | null;
  timezone: string;
  updated_at: string;
};

export type RoutineActiveUpdateRow = {
  is_active: boolean;
  updated_at: string;
};

export type RoutineWriteInput = {
  title: unknown;
  description?: unknown;
  categories: unknown;
  goalId?: unknown;
  recurrenceType: unknown;
  weekdays?: unknown;
  scheduledTime?: unknown;
  durationMinutes?: unknown;
  timezone: unknown;
};

export type RoutinePrepareSuccess<T> = { ok: true; value: T };
export type RoutinePrepareFailure = { ok: false; error: string };
export type RoutinePrepareResult<T> =
  | RoutinePrepareSuccess<T>
  | RoutinePrepareFailure;

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

  const goalId = normalizeGoalId(input.goalId);
  if (!goalId.ok) return goalId;

  const scheduledTime = normalizeScheduledTime(input.scheduledTime);
  if (!scheduledTime.ok) return scheduledTime;

  const durationMinutes = normalizeDurationMinutes(input.durationMinutes);
  if (!durationMinutes.ok) return durationMinutes;

  const timezone = normalizeTimezone(input.timezone);
  if (!timezone.ok) return timezone;

  const row: RoutineInsertRow = {
    user_id: owner.value,
    title: title.value,
    description: normalizeDescription(input.description),
    categories: categories.value,
    goal_id: goalId.value,
    recurrence_type: input.recurrenceType,
    weekdays: weekdays.value,
    scheduled_time: scheduledTime.value,
    duration_minutes: durationMinutes.value,
    timezone: timezone.value,
    is_active: ROUTINE_CREATE_IS_ACTIVE,
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
      scheduled_time: created.value.scheduled_time,
      duration_minutes: created.value.duration_minutes,
      timezone: created.value.timezone,
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
  const scheduledTime = row.scheduled_time;
  const durationMinutes = row.duration_minutes;
  const timezone = row.timezone;
  const isActive = row.is_active;
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
  if (!isNonEmptyString(createdAt) || !isNonEmptyString(updatedAt)) return null;
  if (!isValidPlanningCategories(rawCategories)) return null;
  if (!isValidRoutineRecurrence(recurrenceType, weekdays)) return null;

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
    scheduledTime,
    durationMinutes,
    timezone,
    isActive,
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
    if (routine) routines.push(routine);
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
