/** Civil YYYY-MM-DD helpers. Does not convert through local Date() timezone. */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_TIME = /^(\d{2}):(\d{2})(?::(\d{2}))?/;

export function isCivilDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
}

export function nextCivilDate(localDate: string): string | null {
  if (!isCivilDate(localDate)) return null;
  const year = Number(localDate.slice(0, 4));
  const month = Number(localDate.slice(5, 7));
  const day = Number(localDate.slice(8, 10));
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

export function normalizeCivilTime(value: string): string | null {
  const match = LOCAL_TIME.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] ? Number(match[3]) : 0;
  if (hour > 23 || minute > 59 || second > 59) return null;
  return `${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

export function addMinutesToCivilDateTime(
  date: string,
  time: string,
  minutes: number
): { date: string; time: string } | null {
  if (!isCivilDate(date) || !Number.isInteger(minutes) || minutes <= 0) {
    return null;
  }
  const normalized = normalizeCivilTime(time);
  if (!normalized) return null;
  const hour = Number(normalized.slice(0, 2));
  const minute = Number(normalized.slice(3, 5));
  const second = Number(normalized.slice(6, 8));
  let total = hour * 60 + minute + minutes;
  let days = Math.floor(total / (24 * 60));
  total = total % (24 * 60);
  const nextHour = Math.floor(total / 60);
  const nextMinute = total % 60;
  let nextDate: string | null = date;
  while (days > 0) {
    nextDate = nextCivilDate(nextDate);
    if (!nextDate) return null;
    days -= 1;
  }
  return {
    date: nextDate,
    time: `${pad(nextHour)}:${pad(nextMinute)}:${pad(second)}`,
  };
}

export function isoWeekdayFromCivilDate(localDate: string): number | null {
  if (!isCivilDate(localDate)) return null;
  const year = Number(localDate.slice(0, 4));
  const month = Number(localDate.slice(5, 7));
  const day = Number(localDate.slice(8, 10));
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
