/**
 * Today list presentation only.
 * Occurrence history stays intact; this decides what is a full card vs compact feedback.
 */
import {
  isLocalScheduledDate,
  isLocalScheduledTime,
  normalizeLocalScheduledTime,
} from './invariants';
import type { PersistedOccurrenceStatus, PlannedOccurrence } from './types';

export function isTodayHistoryOccurrence(
  status: PersistedOccurrenceStatus
): boolean {
  return status === 'skipped' || status === 'rescheduled';
}

export function todayHistoryKind(
  status: PersistedOccurrenceStatus
): 'Skipped' | 'Moved' | null {
  if (status === 'skipped') return 'Skipped';
  if (status === 'rescheduled') return 'Moved';
  return null;
}

export function todayHistoryLabel(
  status: PersistedOccurrenceStatus
): 'Skipped' | 'Moved' | null {
  return todayHistoryKind(status);
}

export const MOVE_CHAIN_HOP_LIMIT = 32;

export function replacementForReschedule(
  occurrence: Pick<PlannedOccurrence, 'status' | 'rescheduledToId'>,
  byId: ReadonlyMap<string, PlannedOccurrence>
): PlannedOccurrence | null {
  if (occurrence.status !== 'rescheduled' || !occurrence.rescheduledToId) {
    return null;
  }
  return byId.get(occurrence.rescheduledToId) ?? null;
}

export type MoveChainResolution =
  | { ok: true; terminal: PlannedOccurrence }
  | { ok: false; reason: 'cycle' | 'unresolved' };

/**
 * Follow rescheduled_to_id until a non-rescheduled terminal.
 * Does not infer dates. Missing links and cycles fail closed.
 */
export function resolveMoveChain(
  start: PlannedOccurrence,
  byId: ReadonlyMap<string, PlannedOccurrence>
): MoveChainResolution {
  const visited = new Set<string>();
  let current = start;

  for (let hop = 0; hop <= MOVE_CHAIN_HOP_LIMIT; hop += 1) {
    if (current.status !== 'rescheduled') {
      return { ok: true, terminal: current };
    }
    if (visited.has(current.id)) {
      return { ok: false, reason: 'cycle' };
    }
    visited.add(current.id);
    if (!current.rescheduledToId) {
      return { ok: false, reason: 'unresolved' };
    }
    const next = byId.get(current.rescheduledToId);
    if (!next) {
      return { ok: false, reason: 'unresolved' };
    }
    current = next;
  }

  return { ok: false, reason: 'cycle' };
}

export function changeDateTerminalId(
  chain: MoveChainResolution
): string | null {
  if (!chain.ok) return null;
  if (chain.terminal.status !== 'planned') return null;
  return chain.terminal.id;
}

export function pendingReplacementIds(
  byId: ReadonlyMap<string, PlannedOccurrence>
): string[] {
  const pending: string[] = [];
  const seen = new Set<string>();
  for (const row of byId.values()) {
    if (
      row.status === 'rescheduled' &&
      row.rescheduledToId &&
      !byId.has(row.rescheduledToId) &&
      !seen.has(row.rescheduledToId)
    ) {
      seen.add(row.rescheduledToId);
      pending.push(row.rescheduledToId);
    }
  }
  return pending;
}

export function formatCompactLocalDate(localDate: string): string | null {
  if (!isLocalScheduledDate(localDate)) return null;
  const year = Number(localDate.slice(0, 4));
  const month = Number(localDate.slice(5, 7));
  const day = Number(localDate.slice(8, 10));
  const utc = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(utc);
}

export function formatCompactLocalTime(localTime: string): string | null {
  if (!isLocalScheduledTime(localTime)) return null;
  const normalized = normalizeLocalScheduledTime(localTime);
  const hour = Number(normalized.slice(0, 2));
  const minute = Number(normalized.slice(3, 5));
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
}

export function formatMovedToLabel(
  replacement: Pick<PlannedOccurrence, 'scheduledDate' | 'scheduledTime'> | null
): 'Moved' | `Moved to ${string}` {
  if (!replacement) return 'Moved';
  const dateLabel = formatCompactLocalDate(replacement.scheduledDate);
  if (!dateLabel) return 'Moved';
  if (replacement.scheduledTime) {
    const timeLabel = formatCompactLocalTime(replacement.scheduledTime);
    if (timeLabel) return `Moved to ${dateLabel} at ${timeLabel}`;
  }
  return `Moved to ${dateLabel}`;
}

export type TodayHistoryRowInput = {
  title: string;
  sourceLabel: string;
  status: PersistedOccurrenceStatus;
  movedToLabel?: string | null;
  changeDateTerminalId?: string | null;
};

export type CollapsedTodayHistoryRow = {
  key: string;
  title: string;
  sourceLabel: string;
  labels: string[];
  changeDateTerminalId: string | null;
};

function historyGroupKey(item: TodayHistoryRowInput): string {
  return `${item.sourceLabel}\0${item.title}`;
}

function isMovedLabel(label: string): boolean {
  return label === 'Moved' || label.startsWith('Moved to ');
}

function mergeHistoryLabel(labels: string[], next: string): void {
  if (next === 'Skipped') {
    if (!labels.includes('Skipped')) labels.push('Skipped');
    return;
  }
  const index = labels.findIndex(isMovedLabel);
  if (index === -1) {
    labels.push(next);
    return;
  }
  if (next.startsWith('Moved to ')) {
    labels[index] = next;
    return;
  }
  if (labels[index] === 'Moved') {
    labels[index] = next;
  }
}

/** Collapse same-title skip/move attempts into one compact row. */
export function collapseTodayHistoryRows(
  items: TodayHistoryRowInput[]
): CollapsedTodayHistoryRow[] {
  const order: string[] = [];
  const groups = new Map<string, CollapsedTodayHistoryRow>();

  for (const item of items) {
    const kind = todayHistoryKind(item.status);
    if (!kind) continue;
    const label =
      kind === 'Moved' ? item.movedToLabel || 'Moved' : 'Skipped';
    const key = historyGroupKey(item);
    const existing = groups.get(key);
    if (!existing) {
      const row: CollapsedTodayHistoryRow = {
        key,
        title: item.title,
        sourceLabel: item.sourceLabel,
        labels: [label],
        changeDateTerminalId: item.changeDateTerminalId ?? null,
      };
      groups.set(key, row);
      order.push(key);
      continue;
    }
    mergeHistoryLabel(existing.labels, label);
    if (item.changeDateTerminalId) {
      existing.changeDateTerminalId = item.changeDateTerminalId;
    }
  }

  return order.map((key) => groups.get(key)!);
}
