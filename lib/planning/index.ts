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
  RoutineWeekdayLabels,
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
  isValidRoutineWeekdayLabels,
  isValidTodo,
  normalizeLocalScheduledTime,
  reinterpretsLogBackedAsLightweight,
  reinterpretsResolvedAsPlanned,
  samePlanningOwner,
} from './invariants';

export {
  isoWeekdayFromLocalDate,
  localCalendarDateInTimeZone,
  localCalendarPartsInTimeZone,
  shiftLocalCalendarDate,
} from './localCalendar';

export {
  COMPLETION_VALIDATION_MESSAGES,
  completionModeLabel,
  decideLightCompletion,
  decideLogLinkedCompletion,
  decideSkip,
  goalAttributionFromSource,
  linkedLogIdForReuse,
  todoIdToCloseOnOccurrenceCompletion,
} from './completion';

export type { CompletionDecision } from './completion';

export {
  RECONCILIATION_VALIDATION_MESSAGES,
  decideReschedule,
  routineMoveCollides,
  todoHasOtherPlannedOccurrence,
} from './reconciliation';

export type { RescheduleDecision } from './reconciliation';

export {
  MOVE_CHAIN_HOP_LIMIT,
  changeDateTerminalId,
  collapseTodayHistoryRows,
  formatCompactLocalDate,
  formatCompactLocalTime,
  formatMovedToLabel,
  isTodayHistoryOccurrence,
  pendingReplacementIds,
  replacementForReschedule,
  resolveMoveChain,
  todayHistoryKind,
  todayHistoryLabel,
} from './todayPresentation';

export type {
  CollapsedTodayHistoryRow,
  TodayHistoryRowInput,
} from './todayPresentation';

export {
  buildMissingTodayOccurrenceDrafts,
  draftRoutineOccurrenceForDate,
  draftTodoOccurrenceForDate,
  logicalOccurrenceIdentityKey,
  routineAppliesOnLocalDate,
  selectLogicalTodayOccurrences,
  todayScheduledDates,
} from './materialize';

export type {
  MaterializeTodayInput,
  OccurrenceInsertDraft,
} from './materialize';

export {
  OCCURRENCE_TABLE_COLUMNS,
  OCCURRENCE_VALIDATION_MESSAGES,
  mapOwnedOccurrenceRows,
  occurrenceCombinationFromRow,
  occurrenceFromRow,
  prepareOccurrenceCompletionUpdate,
  prepareOccurrenceInsert,
} from './occurrences';

export type {
  OccurrenceCompletionUpdateRow,
  OccurrenceInsertRow,
  OccurrencePrepareFailure,
  OccurrencePrepareResult,
  OccurrencePrepareSuccess,
  OccurrenceRow,
} from './occurrences';

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
  WEEKDAY_FULL_LABELS,
  WEEKDAY_LABELS,
  composeLocalScheduledTimeFromPickerParts,
  detectBrowserTimeZone,
  effectiveRoutineActionForLocalDate,
  filterTimeZoneOptions,
  formatRoutineRecurrence,
  formatTimeZoneLabel,
  listIanaTimeZoneOptions,
  localScheduledTimeToPickerParts,
  timeZoneShortAbbreviations,
  mapOwnedRoutineRows,
  normalizeRoutineCategories,
  normalizeRoutineWeekdayLabels,
  normalizeRoutineWeekdays,
  prepareRoutineActiveTransition,
  prepareRoutineCreate,
  prepareRoutineUpdate,
  presentRoutineOccurrence,
  routineFromRow,
} from './routines';

export type {
  LocalTimePeriod,
  LocalTimePickerParts,
  RoutineActiveUpdateRow,
  RoutineInsertRow,
  RoutineOccurrencePresentation,
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
