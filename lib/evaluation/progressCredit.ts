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
