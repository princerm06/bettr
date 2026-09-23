/**
 * Per-user outbound calendar reconcile.
 * Provider-neutral policy in eligibility.ts; Google transport via project/withdraw.
 * Does not mutate planning, Logs, XP, or Discipline.
 * Does not enable sync. Does not materialize future occurrences.
 */
import { decideAutomaticReconcileAction } from './eligibility';
import type { ProjectionOccurrence } from './eligibility';
import type { CalendarEventLinkRow } from './eventLinks';
import type { CalendarPageResult } from './listPages';
import { projectOccurrence, type ProjectOccurrenceStore } from './projection';
import { withdrawOccurrenceProjection } from './withdraw';

export type ReconcileResultCode =
  | 'reconciled'
  | 'sync_disabled'
  | 'not_connected'
  | 'error';

export type ReconcileSummary = {
  result: ReconcileResultCode;
  projected: number;
  updated: number;
  withdrawn: number;
  noop: number;
  errors: number;
};

export const CALENDAR_SOURCE_LOAD_ERROR =
  'Calendar source data could not be loaded.';

export type ReconcileStore = ProjectOccurrenceStore & {
  loadOccurrencesForUser: (
    userId: string
  ) => Promise<CalendarPageResult<ProjectionOccurrence>>;
  loadLinksForUser: (
    userId: string
  ) => Promise<CalendarPageResult<CalendarEventLinkRow>>;
  updateReconcileMeta: (
    userId: string,
    meta: { lastReconcileAt: string; lastError: string | null }
  ) => Promise<void>;
};

const inFlight = new Map<string, Promise<ReconcileSummary>>();
const pending = new Set<string>();

export function sanitizeReconcileErrorSummary(errorCount: number): string {
  if (errorCount < 1) return '';
  if (errorCount === 1) return '1 calendar item could not be updated.';
  return `${errorCount} calendar items could not be updated.`;
}

function emptySummary(result: ReconcileResultCode): ReconcileSummary {
  return {
    result,
    projected: 0,
    updated: 0,
    withdrawn: 0,
    noop: 0,
    errors: 0,
  };
}

export function reconcileUserCalendar(options: {
  actorUserId: string;
  store: ReconcileStore;
  now?: Date;
}): Promise<ReconcileSummary> {
  const { actorUserId } = options;
  pending.add(actorUserId);
  const existing = inFlight.get(actorUserId);
  if (existing) return existing;

  const run = pumpReconcile(options);
  inFlight.set(actorUserId, run);
  return run;
}

async function pumpReconcile(options: {
  actorUserId: string;
  store: ReconcileStore;
  now?: Date;
}): Promise<ReconcileSummary> {
  const { actorUserId } = options;
  let last = emptySummary('error');
  do {
    pending.delete(actorUserId);
    last = await reconcileUserCalendarUncoalesced(options);
  } while (pending.has(actorUserId));
  inFlight.delete(actorUserId);
  if (pending.has(actorUserId)) {
    return reconcileUserCalendar(options);
  }
  return last;
}

async function reconcileUserCalendarUncoalesced(options: {
  actorUserId: string;
  store: ReconcileStore;
  now?: Date;
}): Promise<ReconcileSummary> {
  const { actorUserId, store } = options;
  const connection = await store.loadConnection(actorUserId);
  if (!connection) return emptySummary('not_connected');
  if (!connection.sync_enabled) return emptySummary('sync_disabled');

  const [occurrencePage, linkPage] = await Promise.all([
    store.loadOccurrencesForUser(actorUserId),
    store.loadLinksForUser(actorUserId),
  ]);
  if (!occurrencePage.ok || !linkPage.ok) {
    const failed = emptySummary('error');
    failed.errors = 1;
    const finishedAt = (options.now ?? new Date()).toISOString();
    try {
      await store.updateReconcileMeta(actorUserId, {
        lastReconcileAt: finishedAt,
        lastError: CALENDAR_SOURCE_LOAD_ERROR,
      });
    } catch {
      // Planning is still untouched; the run remains fail-closed.
    }
    return failed;
  }

  const occurrences = occurrencePage.rows;
  const links = linkPage.rows;

  const occurrenceById = new Map<string, ProjectionOccurrence>();
  for (const occurrence of occurrences) {
    if (occurrence.userId === actorUserId) {
      occurrenceById.set(occurrence.id, occurrence);
    }
  }
  const linkByOccurrenceId = new Map<string, CalendarEventLinkRow>();
  for (const link of links) {
    if (link.user_id === actorUserId) {
      linkByOccurrenceId.set(link.occurrence_id, link);
    }
  }

  const ids = new Set<string>([
    ...occurrenceById.keys(),
    ...linkByOccurrenceId.keys(),
  ]);
  const orderedIds = Array.from(ids).sort();

  const itemStore: ProjectOccurrenceStore = {
    loadConnection: store.loadConnection,
    loadOccurrence: async (occurrenceId) => occurrenceById.get(occurrenceId) ?? null,
    loadSource: (occurrence) => store.loadSource(occurrence),
    loadLink: async (occurrenceId) => linkByOccurrenceId.get(occurrenceId) ?? null,
    saveLink: async (row) => {
      const saved = await store.saveLink(row);
      if (saved.ok) {
        const previous = linkByOccurrenceId.get(row.occurrenceId);
        linkByOccurrenceId.set(row.occurrenceId, {
          id: previous?.id ?? row.occurrenceId,
          user_id: row.userId,
          occurrence_id: row.occurrenceId,
          google_event_id: row.googleEventId,
          calendar_id: row.calendarId,
          sync_status: row.syncStatus,
          last_error: row.lastError,
          created_at: previous?.created_at ?? new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
      return saved;
    },
    decryptRefreshToken: store.decryptRefreshToken,
    refreshAccessToken: store.refreshAccessToken,
    persistRotatedRefreshToken: store.persistRotatedRefreshToken,
    calendar: store.calendar,
  };

  const summary = emptySummary('reconciled');

  for (const occurrenceId of orderedIds) {
    const occurrence = occurrenceById.get(occurrenceId) ?? null;
    const link = linkByOccurrenceId.get(occurrenceId) ?? null;
    let sourceAllowsExternalCalendar: boolean | undefined;
    if (occurrence?.sourceType === 'routine') {
      const source = await store.loadSource(occurrence);
      if (!source) {
        sourceAllowsExternalCalendar = false;
      } else {
        sourceAllowsExternalCalendar = source.allowsExternalCalendar !== false;
      }
    }
    const action = decideAutomaticReconcileAction({
      actorUserId,
      occurrence,
      linkStatus: link?.sync_status ?? null,
      sourceAllowsExternalCalendar,
    });
    if (action === 'noop') {
      summary.noop += 1;
      continue;
    }
    try {
      if (action === 'project') {
        const outcome = await projectOccurrence({
          actorUserId,
          occurrenceId,
          store: itemStore,
          mode: 'automatic',
        });
        if (outcome.result === 'created') summary.projected += 1;
        else if (outcome.result === 'updated') summary.updated += 1;
        else if (outcome.result === 'ineligible' || outcome.result === 'denied') {
          summary.noop += 1;
        } else {
          summary.errors += 1;
        }
        continue;
      }

      const withdrawn = await withdrawOccurrenceProjection({
        actorUserId,
        occurrenceId,
        store: itemStore,
      });
      if (withdrawn.result === 'withdrawn') summary.withdrawn += 1;
      else if (withdrawn.result === 'noop') summary.noop += 1;
      else summary.errors += 1;
    } catch {
      summary.errors += 1;
    }
  }

  const finishedAt = (options.now ?? new Date()).toISOString();
  const lastError =
    summary.errors > 0 ? sanitizeReconcileErrorSummary(summary.errors) : null;
  try {
    await store.updateReconcileMeta(actorUserId, {
      lastReconcileAt: finishedAt,
      lastError,
    });
  } catch {
    summary.errors += 1;
    summary.result = 'reconciled';
  }

  return summary;
}
