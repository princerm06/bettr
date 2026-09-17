/**
 * Planner execution: planned-occurrence completion that may create/reuse a Log.
 *
 * Lives outside lib/planning so planning stays intention-only (no evaluation/XP).
 * Log credit always goes through Phase 1 gate + Phase 2 priority reward.
 * Lightweight / non-creditable outcomes record adherence only (zero XP).
 */
import {
  decideCustomComposerSubmit,
  type ComposerGateDecision,
} from '../evaluation/customComposerGateDecision';
import { persistDetailsAfterGate } from '../evaluation/customComposerSemantic';
import {
  canPersistComposerResult,
} from '../evaluation/composerPersistence';
import {
  evaluateComposerSubmission,
  type DevelopmentalGateResult,
} from '../evaluation/developmentalGate';
import type { DevelopmentalGateStatus } from '../evaluation/developmentalProductPolicy';
import {
  calculateDeterministicBasePoints,
  type CategoryKey,
} from '../evaluation/legacyEvaluator';
import {
  applyPriorityReward,
  type PriorityMap,
} from '../evaluation/priorityReward';
import {
  resolveEditedPoints,
  type EditCreditSnapshot,
} from '../evaluation/editScoring';
import {
  decideLightCompletion,
  decideLogLinkedCompletion,
  goalAttributionFromSource,
  linkedLogIdForReuse,
  type CompletionDecision,
} from '../planning/completion';
import type {
  OccurrenceCombinationInput,
  PlannedOccurrence,
  PlanningCategoryKey,
} from '../planning/types';

export type PlannerLogDraft = {
  id: string;
  category: CategoryKey;
  categories: CategoryKey[];
  activity: string;
  details: string;
  date: string;
  startTime?: string;
  durationMinutes?: number;
  points: number;
  custom: true;
  visibility: 'friends' | 'private';
  image?: string;
  imagePath?: string;
  aiInsight?: string;
};

export type PlannerCreditRequest = {
  activity: string;
  details: string;
  categories: readonly PlanningCategoryKey[];
  hasImage: boolean;
  logDate: string;
  startTime?: string | null;
  durationMinutes?: number | null;
  visibility?: 'friends' | 'private';
  clarificationPass?: boolean;
  clarificationText?: string;
  /** Existing linked Log snapshot for Add Details / retries. */
  existingLog?: EditCreditSnapshot & { id: string };
  priorities: PriorityMap;
  evaluate?: (options: {
    activity: string;
    details: string;
    clarificationPass?: boolean;
    clarificationText?: string;
  }) => Promise<DevelopmentalGateResult>;
};

export type PlannerCreditResult =
  | {
      kind: 'credited';
      decision: Extract<ComposerGateDecision, { kind: 'save' }>;
      points: number;
      details: string;
      reuseLogId: string | null;
    }
  | {
      kind: 'adherence_only';
      reason: 'non_creditable' | 'gate_rejected';
      gateStatus: DevelopmentalGateStatus | null;
      notice: string | null;
    }
  | {
      kind: 'ask_clarification';
    }
  | {
      kind: 'need_clarification_text';
    }
  | {
      kind: 'technical';
      message: string;
    };

/**
 * Run Phase 1 + Phase 2 for a planned completion / Add Details payload.
 * Does not write to the database. Non-creditable outcomes never invent XP.
 */
export async function evaluatePlannerLogCredit(
  request: PlannerCreditRequest
): Promise<PlannerCreditResult> {
  const categories = [...request.categories] as CategoryKey[];
  if (categories.length < 1) {
    return {
      kind: 'adherence_only',
      reason: 'non_creditable',
      gateStatus: null,
      notice: 'invalid',
    };
  }

  const evaluate = request.evaluate ?? evaluateComposerSubmission;
  const clarificationPass = Boolean(request.clarificationPass);
  const result = await evaluate({
    activity: request.activity,
    details: request.details,
    clarificationPass,
    clarificationText: request.clarificationText,
  });

  if (result.status === 'TECHNICAL_FAILURE') {
    return {
      kind: 'technical',
      message: result.error || 'Semantic evaluation failed.',
    };
  }

  const decision = decideCustomComposerSubmit({
    clarificationPass,
    clarificationText: request.clarificationText || '',
    status: result.status,
  });

  if (decision.kind === 'need_clarification_text') {
    return { kind: 'need_clarification_text' };
  }
  if (decision.kind === 'ask_clarification') {
    return { kind: 'ask_clarification' };
  }
  if (decision.kind === 'reject') {
    return {
      kind: 'adherence_only',
      reason: 'gate_rejected',
      gateStatus: result.status,
      notice: decision.notice,
    };
  }

  const details = persistDetailsAfterGate({
    details: request.details,
    clarificationPass,
    clarificationText: request.clarificationText || '',
  });

  const points = request.existingLog
    ? resolveEditedPoints({
        previous: request.existingLog,
        next: {
          activity: request.activity,
          details,
          categories,
          hasImage: request.hasImage,
        },
        priorities: request.priorities,
      })
    : applyPriorityReward(
        calculateDeterministicBasePoints(details, request.hasImage),
        categories,
        request.priorities
      );

  if (!canPersistComposerResult(decision, points) || points <= 0) {
    return {
      kind: 'adherence_only',
      reason: 'non_creditable',
      gateStatus: result.status,
      notice: 'scoring_conflict',
    };
  }

  return {
    kind: 'credited',
    decision,
    points,
    details,
    reuseLogId: request.existingLog?.id ?? null,
  };
}

export function buildPlannerLogDraft(options: {
  credit: Extract<PlannerCreditResult, { kind: 'credited' }>;
  request: PlannerCreditRequest;
  logId: string;
}): PlannerLogDraft {
  const categories = [...options.request.categories] as CategoryKey[];
  return {
    id: options.logId,
    category: categories[0],
    categories,
    activity: options.request.activity.trim(),
    details: options.credit.details,
    date: options.request.logDate,
    startTime: options.request.startTime || undefined,
    durationMinutes: options.request.durationMinutes || undefined,
    points: options.credit.points,
    custom: true,
    visibility: options.request.visibility || 'private',
  };
}

export type OccurrenceCompletionPlan =
  | {
      kind: 'light';
      decision: CompletionDecision;
      goalId: string | null;
    }
  | {
      kind: 'log_link';
      decision: CompletionDecision;
      logId: string;
      goalId: string | null;
      reuse: boolean;
    };

/** Pure plan for light completion (adherence, zero XP). */
export function planLightOccurrenceCompletion(options: {
  occurrence: OccurrenceCombinationInput;
  resolvedAt: string;
  sourceGoalId: string | null;
}): OccurrenceCompletionPlan {
  return {
    kind: 'light',
    decision: decideLightCompletion(options.occurrence, options.resolvedAt),
    goalId: goalAttributionFromSource({ goalId: options.sourceGoalId }),
  };
}

/**
 * Pure plan for linking/reusing one Log on an occurrence.
 * Call only after Phase 1/2 credited a Log (or reuse existing log id).
 */
export function planLogLinkedOccurrenceCompletion(options: {
  occurrence: PlannedOccurrence;
  logId: string;
  resolvedAt: string;
  sourceGoalId: string | null;
}): OccurrenceCompletionPlan {
  const reuseId = linkedLogIdForReuse(options.occurrence);
  const logId = reuseId || options.logId;
  return {
    kind: 'log_link',
    decision: decideLogLinkedCompletion(
      options.occurrence,
      logId,
      options.resolvedAt
    ),
    logId,
    goalId: goalAttributionFromSource({ goalId: options.sourceGoalId }),
    reuse: Boolean(reuseId),
  };
}
