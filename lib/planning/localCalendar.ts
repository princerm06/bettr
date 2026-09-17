/**
 * Local calendar helpers for planning schedules.
 * Intention-only: no XP / semantic evaluation.
 */
import {
  isIanaTimeZone,
  isLocalScheduledDate,
} from './invariants';
import {
  PLANNING_ISO_WEEKDAYS,
  type PlanningIsoWeekday,
} from './types';

export function localCalendarPartsInTimeZone(
  now: Date,
  timeZone: string
): { date: string; time: string } | null {
  if (!isIanaTimeZone(timeZone)) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);

    const read = (type: string) => parts.find((part) => part.type === type)?.value;
    const year = read('year');
    const month = read('month');
    const day = read('day');
    const hour = read('hour');
    const minute = read('minute');
    const second = read('second');
    if (!year || !month || !day || !hour || !minute || !second) return null;
    return {
      date: `${year}-${month}-${day}`,
      time: `${hour}:${minute}:${second}`,
    };
  } catch {
    return null;
  }
}

export function localCalendarDateInTimeZone(
  now: Date,
  timeZone: string
): string | null {
  return localCalendarPartsInTimeZone(now, timeZone)?.date ?? null;
}

/**
 * ISO-8601 weekday from a local YYYY-MM-DD calendar date.
 * Monday = 1 … Sunday = 7. Uses the civil date, not a timezone conversion.
 */
export function isoWeekdayFromLocalDate(
  localDate: string
): PlanningIsoWeekday | null {
  if (!isLocalScheduledDate(localDate)) return null;
  const year = Number(localDate.slice(0, 4));
  const month = Number(localDate.slice(5, 7));
  const day = Number(localDate.slice(8, 10));
  const utc = new Date(Date.UTC(year, month - 1, day));
  const jsDay = utc.getUTCDay(); // 0 = Sunday
  const iso = (jsDay === 0 ? 7 : jsDay) as PlanningIsoWeekday;
  return (PLANNING_ISO_WEEKDAYS as readonly number[]).includes(iso) ? iso : null;
}
