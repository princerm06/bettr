/**
 * Phase 3 planning domain boundary.
 * Intention only: no XP, semantic validation, UI, or Log-schema coupling.
 */

export {
  DERIVED_OCCURRENCE_STATE,
  PERSISTED_OCCURRENCE_STATUSES,
  PLANNING_CATEGORY_KEYS,
  PLANNING_COMPLETION_MODES,
  PLANNING_GOAL_STATUSES,
  PLANNING_ISO_WEEKDAYS,
  PLANNING_OCCURRENCE_SOURCES,
  PLANNING_RECURRENCE_TYPES,
  PLANNING_TITLE_MAX_LENGTH,
} from './types';

export type {
  DerivedOccurrenceState,
  Goal,
  OccurrenceCombinationInput,
  OccurrenceSchedule,
  OccurrenceSourceInput,
  PersistedOccurrenceStatus,
  PlannedOccurrence,
  PlanningCategoryKey,
  PlanningCompletionMode,
  PlanningGoalStatus,
  PlanningIsoWeekday,
  PlanningOccurrenceSource,
  PlanningRecurrenceType,
  Routine,
  Todo,
} from './types';

export {
  deriveOccurrenceState,
  isEnteringLogBackedCompletion,
  isIanaTimeZone,
  isLocalScheduledDate,
  isLocalScheduledTime,
  isLogBackedCompletion,
  isOccurrenceOverdue,
  isPersistedOccurrenceStatus,
  isPlanningCategoryKey,
  isPlanningCompletionMode,
  isPlanningGoalStatus,
  isPlanningIsoWeekday,
  isPlanningOccurrenceSource,
  isPlanningRecurrenceType,
  isPreservedLogBackedCompletion,
  isValidDurationMinutes,
  isValidGoal,
  isValidLogBackedCompletionEntry,
  isValidOccurrenceCombination,
  isValidOccurrenceSource,
  isValidOccurrenceWrite,
  isValidPlannedOccurrence,
  isValidPlanningCategories,
  isValidPlanningTitle,
  isValidRoutine,
  isValidRoutineRecurrence,
  isValidTodo,
  normalizeLocalScheduledTime,
  reinterpretsLogBackedAsLightweight,
  samePlanningOwner,
} from './invariants';
