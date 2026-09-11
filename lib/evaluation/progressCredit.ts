/**
 * Downstream progress credit: whether stored log.points count as progress.
 * Does not award XP, run semantics, or change persistence.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function hasPositiveProgressCredit(points: unknown): boolean {
  return typeof points === 'number' && Number.isFinite(points) && points > 0;
}

export function isCreditedProgressLog(log: { points?: unknown }): boolean {
  return hasPositiveProgressCredit(log.points);
}

export function creditedProgressPoints(points: unknown): number {
  return hasPositiveProgressCredit(points) ? Number(points) : 0;
}

export function sumCreditedProgress(logs: readonly { points?: unknown }[]): number {
  return logs.reduce((sum, log) => sum + creditedProgressPoints(log.points), 0);
}

export function isIsoDateInInclusiveRange(
  logDate: string,
  start: string,
  end: string
): boolean {
  return ISO_DATE.test(logDate) && logDate >= start && logDate <= end;
}

export function countCreditedActiveDays(
  logs: readonly { date: string; points?: unknown }[]
): number {
  return new Set(
    logs.filter(isCreditedProgressLog).map((log) => log.date)
  ).size;
}

function previousIsoDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

/**
 * Consecutive credited-progress days ending today.
 * Same walk-back-from-today algorithm as the calendar; future dates never start it.
 * A gap or a zero-only today yields 0.
 */
export function countCreditedProgressStreak(
  logs: readonly { date: string; points?: unknown }[],
  today: string
): number {
  if (!ISO_DATE.test(today)) return 0;
  const creditedDates = new Set(
    logs
      .filter(isCreditedProgressLog)
      .filter((log) => ISO_DATE.test(log.date) && log.date <= today)
      .map((log) => log.date)
  );

  let streak = 0;
  let cursor = today;
  while (creditedDates.has(cursor)) {
    streak += 1;
    cursor = previousIsoDate(cursor);
  }
  return streak;
}
