/**
 * Phase 3 planning domain boundary.
 * Intention only: no XP, semantic validation, UI, or Log-schema coupling.
 */

export {
  DERIVED_OCCURRENCE_STATE,
  GOAL_STATUS_TRANSITIONS,
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
  PLANNING_CATEGORIES,
  PLANNING_CATEGORY_DISPLAY,
  planningCategoryDisplay,
} from './categories';

export type { PlanningCategoryDisplay } from './categories';

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
  isValidGoalStatusTransition,
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

export {
  GOAL_CREATE_STATUS,
  GOAL_DOMAIN_FIELDS,
  GOAL_TABLE_COLUMNS,
  GOAL_VALIDATION_MESSAGES,
  goalFromRow,
  mapOwnedGoalRows,
  normalizeGoalCategories,
  prepareGoalCreate,
  prepareGoalStatusTransition,
  prepareGoalUpdate,
} from './goals';

export type {
  GoalInsertRow,
  GoalRow,
  GoalStatusUpdateRow,
  GoalUpdateRow,
  GoalWriteInput,
} from './goals';

export {
  ROUTINE_CREATE_IS_ACTIVE,
  ROUTINE_DOMAIN_FIELDS,
  ROUTINE_TABLE_COLUMNS,
  ROUTINE_VALIDATION_MESSAGES,
  WEEKDAY_LABELS,
  detectBrowserTimeZone,
  filterTimeZoneOptions,
  formatRoutineRecurrence,
  formatTimeZoneLabel,
  listIanaTimeZoneOptions,
  timeZoneShortAbbreviations,
  mapOwnedRoutineRows,
  normalizeRoutineCategories,
  normalizeRoutineWeekdays,
  prepareRoutineActiveTransition,
  prepareRoutineCreate,
  prepareRoutineUpdate,
  routineFromRow,
} from './routines';

export type {
  RoutineActiveUpdateRow,
  RoutineInsertRow,
  RoutineRow,
  RoutineUpdateRow,
  RoutineWriteInput,
  TimeZoneOption,
} from './routines';

export {
  TODO_CREATE_ARCHIVED_AT,
  TODO_DOMAIN_FIELDS,
  TODO_TABLE_COLUMNS,
  TODO_VALIDATION_MESSAGES,
  isTodoOpen,
  mapOwnedTodoRows,
  normalizeTodoCategories,
  prepareTodoArchiveTransition,
  prepareTodoCreate,
  prepareTodoUpdate,
  todoFromRow,
} from './todos';

export type {
  TodoArchiveUpdateRow,
  TodoInsertRow,
  TodoRow,
  TodoUpdateRow,
  TodoWriteInput,
} from './todos';
