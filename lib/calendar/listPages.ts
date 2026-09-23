/**
 * Fail-closed pagination for Calendar source datasets.
 * A page error aborts; callers must not use a partial row list.
 */
export const CALENDAR_LIST_PAGE_SIZE = 500;

export type CalendarPageResult<T> =
  | { ok: true; rows: T[] }
  | { ok: false };

export async function loadAllCalendarPages<T>(options: {
  pageSize?: number;
  fetchPage: (range: {
    from: number;
    to: number;
  }) => Promise<CalendarPageResult<T>>;
}): Promise<CalendarPageResult<T>> {
  const pageSize = options.pageSize ?? CALENDAR_LIST_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1) return { ok: false };

  const rows: T[] = [];
  let from = 0;
  while (true) {
    const page = await options.fetchPage({ from, to: from + pageSize - 1 });
    if (!page.ok) return { ok: false };
    rows.push(...page.rows);
    if (page.rows.length < pageSize) return { ok: true, rows };
    from += pageSize;
  }
}
