/**
 * Plan → To-Dos presentation only.
 * Does not persist a To-Do status column. Derives Open / Done / Skipped
 * from occurrence history plus archived_at.
 */
import { resolveMoveChain } from './todayPresentation';
import type { PlannedOccurrence, Todo } from './types';

export type TodoPlanPresentation = 'open' | 'done' | 'skipped';

function recencyStamp(row: PlannedOccurrence): string {
  return row.resolvedAt || row.updatedAt || row.createdAt;
}

function preferCurrentOutcome(
  candidate: PlannedOccurrence,
  incumbent: PlannedOccurrence
): boolean {
  const recency = recencyStamp(candidate).localeCompare(recencyStamp(incumbent));
  if (recency !== 0) return recency > 0;
  if (candidate.status !== incumbent.status) {
    return candidate.status === 'completed';
  }
  return candidate.id > incumbent.id;
}

/**
 * Current Plan bucket for a To-Do.
 * Planned (including a move-chain terminal) wins over historical skip/complete.
 * Broken/cyclic chains are ignored so they cannot relabel a newer attempt.
 */
export function deriveTodoPlanPresentation(
  todo: Pick<Todo, 'archivedAt'>,
  occurrences: readonly PlannedOccurrence[]
): TodoPlanPresentation {
  const byId = new Map(occurrences.map((row) => [row.id, row]));

  for (const row of occurrences) {
    if (row.status === 'planned') return 'open';
  }

  const outcomes = new Map<string, PlannedOccurrence>();

  for (const row of occurrences) {
    if (row.status === 'rescheduled') {
      const chain = resolveMoveChain(row, byId);
      if (!chain.ok) continue;
      if (chain.terminal.status === 'planned') return 'open';
      if (
        chain.terminal.status === 'completed' ||
        chain.terminal.status === 'skipped'
      ) {
        outcomes.set(chain.terminal.id, chain.terminal);
      }
      continue;
    }
    if (row.status === 'completed' || row.status === 'skipped') {
      if (!outcomes.has(row.id)) outcomes.set(row.id, row);
    }
  }

  let current: PlannedOccurrence | null = null;
  for (const row of outcomes.values()) {
    if (!current || preferCurrentOutcome(row, current)) current = row;
  }

  if (current?.status === 'skipped') return 'skipped';
  if (current?.status === 'completed') return 'done';

  if (todo.archivedAt) return 'done';
  return 'open';
}
