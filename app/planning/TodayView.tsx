'use client';

import { useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { Check, CalendarCheck, CalendarRange, ChevronDown, ChevronUp, Minus, Users, X } from 'lucide-react';
import { supabase, supabaseConfigured } from '../../lib/supabase';
import {
  MOVE_CHAIN_HOP_LIMIT,
  changeDateTerminalId,
  collapseTodayHistoryRows,
  deriveOccurrenceState,
  detectBrowserTimeZone,
  formatMovedToLabel,
  isTodayHistoryOccurrence,
  localCalendarDateInTimeZone,
  pendingReplacementIds,
  planningCategoryDisplay,
  presentRoutineOccurrence,
  isRoutineOccurrenceActionable,
  resolveMoveChain,
  shiftLocalCalendarDate,
  type CollapsedTodayHistoryRow,
  type Goal,
  type PlannedOccurrence,
  type PlanningCategoryKey,
  type Routine,
  type Todo,
} from '../../lib/planning';
import { listOwnedGoals } from '../../lib/planning/goalsAccess';
import { listOwnedRoutines } from '../../lib/planning/routinesAccess';
import { listOwnedTodos } from '../../lib/planning/todosAccess';
import {
  completeOwnedOccurrenceLight,
  ensureTodayOccurrences,
  linkOwnedOccurrenceLog,
  listOwnedOccurrencesByIds,
  listOwnedPastPlannedOccurrences,
  rescheduleOwnedOccurrence,
  skipOwnedOccurrence,
} from '../../lib/planning/occurrencesAccess';
import { requestCalendarReconcileAfterPlanning } from '../../lib/calendar/requestReconcile';
import {
  buildPlannerLogDraft,
  evaluatePlannerLogCredit,
  initialPlannerAddDetailsForm,
  planLightOccurrenceCompletion,
  planLogLinkedOccurrenceCompletion,
} from '../../lib/plannerExecution/completePlannedOccurrence';
import type { PriorityLevel } from '../../lib/evaluation/priorityReward';
import styles from './today.module.css';

type PriorityMap = Record<PlanningCategoryKey, PriorityLevel>;

export type PlannerCreditedLog = {
  id: string;
  category: PlanningCategoryKey;
  categories: PlanningCategoryKey[];
  activity: string;
  details?: string;
  date: string;
  timestamp: number;
  startTime?: string;
  durationMinutes?: number;
  points: number;
  custom?: boolean;
  visibility?: 'friends' | 'private';
};

export type PlannerSavedLogLookup = {
  id: string;
  activity: string;
  details?: string;
  visibility?: 'friends' | 'private';
  categories?: PlanningCategoryKey[];
  points?: number;
  image?: string;
  imagePath?: string;
};

type TodayItem = {
  occurrence: PlannedOccurrence;
  /** Effective action for this occurrence (weekday label or source title). */
  title: string;
  /** Parent Routine title when a weekday-specific label is shown. */
  parentContext: string | null;
  categories: PlanningCategoryKey[];
  goalId: string | null;
  sourceLabel: 'Routine' | 'To-Do';
};

export default function TodayView({
  user,
  priorities,
  onNotice,
  onCreditedLog,
  onUpdatedLog,
  getSavedLog,
}: {
  user: User | null;
  priorities: PriorityMap;
  onNotice: (message: string) => void;
  onCreditedLog: (log: PlannerCreditedLog) => Promise<void>;
  onUpdatedLog: (log: PlannerCreditedLog) => Promise<void>;
  /** Look up an already-saved Log for Add Details reopen. */
  getSavedLog?: (logId: string) => PlannerSavedLogLookup | null;
}) {
  const [items, setItems] = useState<TodayItem[]>([]);
  const [catchUp, setCatchUp] = useState<TodayItem[]>([]);
  const [replacements, setReplacements] = useState<PlannedOccurrence[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [detailsFor, setDetailsFor] = useState<string | null>(null);
  const [activity, setActivity] = useState('');
  const [details, setDetails] = useState('');
  const [clarificationText, setClarificationText] = useState('');
  const [awaitingClarification, setAwaitingClarification] = useState(false);
  const [visibility, setVisibility] = useState<'friends' | 'private'>('private');
  const [moveFor, setMoveFor] = useState<string | null>(null);
  const [moveDate, setMoveDate] = useState('');

  const ownerId = user?.id ?? '';

  const goalTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const goal of goals) map.set(goal.id, goal.title);
    return map;
  }, [goals]);

  function buildItems(
    occurrences: PlannedOccurrence[],
    routines: Routine[],
    todos: Todo[]
  ): TodayItem[] {
    const routineById = new Map(routines.map((row) => [row.id, row]));
    const todoById = new Map(todos.map((row) => [row.id, row]));
    const built: TodayItem[] = [];

    for (const occurrence of occurrences) {
      if (occurrence.sourceType === 'routine' && occurrence.routineId) {
        const routine = routineById.get(occurrence.routineId);
        if (!routine) continue;
        if (!isRoutineOccurrenceActionable(routine, occurrence) && occurrence.status === 'planned') {
          continue;
        }
        const presentation = presentRoutineOccurrence(
          routine,
          occurrence.scheduledDate
        );
        built.push({
          occurrence,
          title: presentation.actionTitle,
          parentContext: presentation.contextLine,
          categories: routine.categories,
          goalId: routine.goalId,
          sourceLabel: 'Routine',
        });
        continue;
      }
      if (occurrence.sourceType === 'todo' && occurrence.todoId) {
        const todo = todoById.get(occurrence.todoId);
        if (!todo) continue;
        built.push({
          occurrence,
          title: todo.title,
          parentContext: null,
          categories: todo.categories,
          goalId: todo.goalId,
          sourceLabel: 'To-Do',
        });
      }
    }

    return built;
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!ownerId) {
        setItems([]);
        setCatchUp([]);
        setReplacements([]);
        setGoals([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      const [routineResult, todoResult, goalResult] = await Promise.all([
        listOwnedRoutines(supabase, ownerId),
        listOwnedTodos(supabase, ownerId),
        listOwnedGoals(supabase, ownerId),
      ]);
      if (cancelled) return;
      if (routineResult.error || todoResult.error || goalResult.error) {
        setNotice(
          routineResult.error ||
            todoResult.error ||
            goalResult.error ||
            'Could not load Today.'
        );
        setLoading(false);
        return;
      }

      const ensured = await ensureTodayOccurrences(supabase, {
        ownerId,
        now: new Date(),
        viewerTimeZone: detectBrowserTimeZone(),
        routines: routineResult.data,
        todos: todoResult.data,
      });
      if (cancelled) return;
      if (ensured.error) {
        setNotice(ensured.error);
        setItems([]);
        setReplacements([]);
        setGoals(goalResult.data);
        setLoading(false);
        return;
      }
      requestCalendarReconcileAfterPlanning();

      setGoals(goalResult.data);
      const viewerTz = detectBrowserTimeZone();
      const viewerDate = localCalendarDateInTimeZone(new Date(), viewerTz);
      const todayItems = buildItems(
        ensured.data,
        routineResult.data,
        todoResult.data
      );
      setItems(todayItems);

      const pastPromise = viewerDate
        ? listOwnedPastPlannedOccurrences(supabase, ownerId, viewerDate)
        : Promise.resolve({ data: [] as PlannedOccurrence[], error: null });

      const chainPromise = (async () => {
        const byId = new Map(
          ensured.data.map((row) => [row.id, row] as const)
        );
        for (let hop = 0; hop < MOVE_CHAIN_HOP_LIMIT; hop += 1) {
          const missing = pendingReplacementIds(byId);
          if (missing.length === 0) break;
          const listed = await listOwnedOccurrencesByIds(
            supabase,
            ownerId,
            missing
          );
          if (listed.error) break;
          let added = 0;
          for (const row of listed.data) {
            if (!byId.has(row.id)) {
              byId.set(row.id, row);
              added += 1;
            }
          }
          if (added === 0) break;
        }
        return Array.from(byId.values());
      })();

      const [past, chainRows] = await Promise.all([pastPromise, chainPromise]);
      if (cancelled) return;

      const todayIds = new Set(todayItems.map((row) => row.occurrence.id));
      setReplacements(chainRows.filter((row) => !todayIds.has(row.id)));
      if (!viewerDate || past.error) {
        setCatchUp([]);
      } else {
        setCatchUp(
          buildItems(past.data, routineResult.data, todoResult.data).filter(
            (row) =>
              !todayIds.has(row.occurrence.id) &&
              deriveOccurrenceState(row.occurrence, new Date()) ===
                'unresolved'
          )
        );
      }
      setNotice(null);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [ownerId]);

  function openDetails(item: TodayItem) {
    const saved =
      item.occurrence.logId && getSavedLog
        ? getSavedLog(item.occurrence.logId)
        : null;
    const form = initialPlannerAddDetailsForm(saved);
    setDetailsFor(item.occurrence.id);
    setActivity(form.activity);
    setDetails(form.details);
    setClarificationText(form.clarificationText);
    setVisibility(form.visibility);
    setAwaitingClarification(false);
    setNotice(null);
  }

  /** Close Add Details without creating a Log, completing, or awarding XP. */
  function cancelDetails() {
    setDetailsFor(null);
    setActivity('');
    setDetails('');
    setClarificationText('');
    setVisibility('private');
    setAwaitingClarification(false);
    setNotice(null);
  }

  function closeDetails() {
    cancelDetails();
  }

  function applyOccurrence(next: PlannedOccurrence) {
    const patch = (list: TodayItem[]) =>
      list.map((row) =>
        row.occurrence.id === next.id ? { ...row, occurrence: next } : row
      );
    setItems(patch);
    setCatchUp((prev) =>
      patch(prev).filter((row) => {
        if (row.occurrence.id !== next.id) return true;
        return (
          next.status === 'planned' &&
          deriveOccurrenceState(next, new Date()) === 'unresolved'
        );
      })
    );
  }

  function defaultMoveDate(item: TodayItem): string {
    const tz = detectBrowserTimeZone();
    const today = localCalendarDateInTimeZone(new Date(), tz);
    if (!today) return item.occurrence.scheduledDate;
    if (item.occurrence.scheduledDate < today) return today;
    return shiftLocalCalendarDate(today, 1) || today;
  }

  async function markSkip(item: TodayItem) {
    if (!ownerId) {
      setNotice('Sign in to update your plan.');
      return;
    }
    const resolvedAt = new Date().toISOString();
    setBusyId(item.occurrence.id);
    const result = await skipOwnedOccurrence(
      supabase,
      ownerId,
      item.occurrence,
      resolvedAt
    );
    setBusyId(null);
    if (!result.data) {
      setNotice(result.error || 'Could not skip this item.');
      return;
    }
    applyOccurrence(result.data);
    requestCalendarReconcileAfterPlanning();
    if (result.error) {
      setNotice(result.error);
      return;
    }
    onNotice('Skipped — nothing logged, no XP.');
  }

  async function confirmMove(item: TodayItem) {
    if (!ownerId) {
      setNotice('Sign in to update your plan.');
      return;
    }
    const resolvedAt = new Date().toISOString();
    setBusyId(item.occurrence.id);
    const result = await rescheduleOwnedOccurrence(
      supabase,
      ownerId,
      item.occurrence,
      moveDate,
      resolvedAt
    );
    setBusyId(null);
    if (!result.data) {
      setNotice(result.error || 'Could not move this item.');
      return;
    }
    applyOccurrence(result.data.source);
    setReplacements((prev) => {
      const next = new Map(prev.map((row) => [row.id, row] as const));
      next.set(result.data!.source.id, result.data!.source);
      if (result.data!.replacement) {
        next.set(result.data!.replacement.id, result.data!.replacement);
      }
      return Array.from(next.values());
    });
    const viewerDate = localCalendarDateInTimeZone(
      new Date(),
      detectBrowserTimeZone()
    );
    if (
      result.data.replacement &&
      viewerDate &&
      result.data.replacement.scheduledDate === viewerDate
    ) {
      setItems((prev) => {
        if (prev.some((row) => row.occurrence.id === result.data!.replacement!.id)) {
          return prev.map((row) =>
            row.occurrence.id === result.data!.replacement!.id
              ? { ...row, occurrence: result.data!.replacement! }
              : row
          );
        }
        return [
          ...prev,
          {
            ...item,
            occurrence: result.data!.replacement!,
          },
        ];
      });
    }
    setMoveFor(null);
    requestCalendarReconcileAfterPlanning();
    if (result.error) {
      setNotice(result.error);
      return;
    }
    onNotice('Moved — original day kept as history.');
  }

  async function markDone(item: TodayItem) {
    if (!ownerId) {
      setNotice('Sign in to complete your plan.');
      return;
    }
    const resolvedAt = new Date().toISOString();
    const plan = planLightOccurrenceCompletion({
      occurrence: item.occurrence,
      resolvedAt,
      sourceGoalId: item.goalId,
    });
    if (plan.decision.kind === 'reject') {
      setNotice(plan.decision.error);
      return;
    }
    setBusyId(item.occurrence.id);
    const result = await completeOwnedOccurrenceLight(
      supabase,
      ownerId,
      item.occurrence,
      resolvedAt
    );
    setBusyId(null);
    if (!result.data) {
      setNotice(result.error || 'Could not mark this done.');
      return;
    }
    applyOccurrence(result.data);
    requestCalendarReconcileAfterPlanning();
    if (result.error) {
      setNotice(result.error);
      return;
    }
    onNotice('Marked done — adherence only, no XP until you log details.');
  }

  async function submitDetails(item: TodayItem) {
    if (!ownerId) {
      setNotice('Sign in to log details.');
      return;
    }
    const cleanActivity = activity.trim();
    if (!cleanActivity) {
      setNotice('Add a short description of what you did.');
      return;
    }

    setBusyId(item.occurrence.id);
    const saved =
      item.occurrence.logId && getSavedLog
        ? getSavedLog(item.occurrence.logId)
        : null;
    const credit = await evaluatePlannerLogCredit({
      activity: cleanActivity,
      details,
      categories: item.categories,
      hasImage: Boolean(saved?.image || saved?.imagePath),
      logDate: item.occurrence.scheduledDate,
      startTime: item.occurrence.scheduledTime,
      durationMinutes: item.occurrence.durationMinutes,
      visibility,
      clarificationPass: awaitingClarification,
      clarificationText,
      existingLog: saved
        ? {
            id: saved.id,
            activity: saved.activity,
            details: saved.details,
            categories: saved.categories || item.categories,
            hasImage: Boolean(saved.image || saved.imagePath),
            points: saved.points ?? 0,
          }
        : undefined,
      priorities,
    });

    if (credit.kind === 'ask_clarification') {
      setAwaitingClarification(true);
      setBusyId(null);
      setNotice('Add a bit more detail so Bettr can check this.');
      return;
    }
    if (credit.kind === 'need_clarification_text') {
      setBusyId(null);
      setNotice('Add a clarification before saving.');
      return;
    }
    if (credit.kind === 'technical') {
      setBusyId(null);
      setNotice(credit.message);
      return;
    }

    if (credit.kind === 'adherence_only') {
      const resolvedAt = new Date().toISOString();
      if (item.occurrence.status === 'planned') {
        const light = await completeOwnedOccurrenceLight(
          supabase,
          ownerId,
          item.occurrence,
          resolvedAt
        );
        if (!light.data) {
          setBusyId(null);
          setNotice(light.error || 'Could not record adherence.');
          return;
        }
        applyOccurrence(light.data);
        requestCalendarReconcileAfterPlanning();
        if (light.error) {
          setBusyId(null);
          setNotice(light.error);
          return;
        }
      }
      setBusyId(null);
      closeDetails();
      onNotice(
        'Recorded as done without progress credit. You can add a clearer log later from +Log.'
      );
      return;
    }

    const reuseLogId = item.occurrence.logId || credit.reuseLogId;
    const logId = reuseLogId || crypto.randomUUID();
    const draft = buildPlannerLogDraft({
      credit,
      request: {
        activity: cleanActivity,
        details,
        categories: item.categories,
        hasImage: Boolean(saved?.image || saved?.imagePath),
        logDate: item.occurrence.scheduledDate,
        startTime: item.occurrence.scheduledTime,
        durationMinutes: item.occurrence.durationMinutes,
        visibility,
        priorities,
      },
      logId,
    });

    const logPayload: PlannerCreditedLog = {
      ...draft,
      timestamp: Date.now(),
    };

    try {
      if (reuseLogId) {
        await onUpdatedLog(logPayload);
      } else {
        await onCreditedLog(logPayload);
        // Stash log id locally before DB link so retries cannot create a second Log.
        applyOccurrence({ ...item.occurrence, logId });
      }
    } catch (error) {
      setBusyId(null);
      setNotice(
        error instanceof Error ? error.message : 'Could not save the Log.'
      );
      return;
    }

    const resolvedAt = new Date().toISOString();
    const occurrenceForLink = {
      ...item.occurrence,
      logId: reuseLogId || logId,
    };
    const linkPlan = planLogLinkedOccurrenceCompletion({
      occurrence: occurrenceForLink,
      logId,
      resolvedAt,
      sourceGoalId: item.goalId,
    });
    if (linkPlan.decision.kind === 'reject') {
      setBusyId(null);
      setNotice(linkPlan.decision.error);
      return;
    }

    const linked = await linkOwnedOccurrenceLog(
      supabase,
      ownerId,
      item.occurrence,
      logId,
      resolvedAt
    );
    setBusyId(null);
    if (!linked.data) {
      setNotice(linked.error || 'Log saved, but the plan link failed. Retry Add details.');
      return;
    }

    applyOccurrence(linked.data);
    requestCalendarReconcileAfterPlanning();
    if (linked.error) {
      setNotice(linked.error);
      return;
    }
    closeDetails();
    onNotice(
      reuseLogId
        ? `Details updated · +${draft.points}`
        : `Logged · +${draft.points}`
    );
  }

  const now = new Date();
  const occurrenceById = useMemo(() => {
    const map = new Map<string, PlannedOccurrence>();
    for (const row of replacements) map.set(row.id, row);
    for (const item of items) map.set(item.occurrence.id, item.occurrence);
    return map;
  }, [items, replacements]);
  const actionableItems = items.filter(
    (item) => !isTodayHistoryOccurrence(item.occurrence.status)
  );
  const resolvedToday = collapseTodayHistoryRows(
    items.map((item) => {
      const chain = resolveMoveChain(item.occurrence, occurrenceById);
      const destination = chain.ok ? chain.terminal : null;
      return {
        title: item.title,
        sourceLabel: item.sourceLabel,
        status: item.occurrence.status,
        movedToLabel: formatMovedToLabel(destination),
        changeDateTerminalId: changeDateTerminalId(chain),
      };
    })
  );
  const hasAny =
    actionableItems.length > 0 || catchUp.length > 0 || resolvedToday.length > 0;

  function historyItemForTerminal(
    row: CollapsedTodayHistoryRow
  ): TodayItem | null {
    if (!row.changeDateTerminalId) return null;
    const occurrence = occurrenceById.get(row.changeDateTerminalId);
    if (!occurrence || occurrence.status !== 'planned') return null;
    const sample = items.find(
      (item) =>
        item.title === row.title && item.sourceLabel === row.sourceLabel
    );
    return {
      occurrence,
      title: row.title,
      parentContext: sample?.parentContext ?? null,
      categories: sample?.categories ?? [],
      goalId: sample?.goalId ?? null,
      sourceLabel: row.sourceLabel === 'Routine' ? 'Routine' : 'To-Do',
    };
  }

  function occurrenceBadge(occurrence: PlannedOccurrence) {
    const state = deriveOccurrenceState(occurrence, now);
    if (state === 'unresolved') {
      return { label: 'Unresolved', className: styles.unresolved };
    }
    if (occurrence.status === 'skipped') {
      return { label: 'Skipped', className: styles.skipped };
    }
    if (occurrence.status === 'rescheduled') {
      return { label: 'Moved', className: styles.moved };
    }
    if (occurrence.completionMode === 'log') {
      return { label: 'Logged', className: styles.done };
    }
    if (occurrence.status === 'completed') {
      return { label: 'Done', className: styles.done };
    }
    return { label: 'Planned', className: styles.planned };
  }

  function renderCard(item: TodayItem, promptWhatHappened: boolean) {
    const badge = occurrenceBadge(item.occurrence);
    const linkedGoal = item.goalId ? goalTitleById.get(item.goalId) : null;
    const openDetailsFor = detailsFor === item.occurrence.id;
    const planned = item.occurrence.status === 'planned';
    const unresolved =
      deriveOccurrenceState(item.occurrence, now) === 'unresolved';

    return (
      <article className={`card ${styles.card}`} key={item.occurrence.id}>
        <header className={styles.cardHead}>
          <span className={`${styles.status} ${badge.className}`}>
            {badge.label}
          </span>
          <span className={styles.source}>{item.sourceLabel}</span>
        </header>

        <h3>{item.title}</h3>
        {item.parentContext && (
          <p className={styles.parentContext}>{item.parentContext}</p>
        )}
        {item.occurrence.scheduledDate && (
          <small className={styles.time}>{item.occurrence.scheduledDate}</small>
        )}
        {item.occurrence.scheduledTime && (
          <small className={styles.time}>
            {item.occurrence.scheduledTime.slice(0, 5)}
          </small>
        )}
        {linkedGoal && (
          <small className={styles.goalLink}>Supports · {linkedGoal}</small>
        )}
        <div className={styles.pills}>
          {item.categories.map((key) => {
            const display = planningCategoryDisplay(key);
            return (
              <span key={key}>
                {display.emoji} {display.short}
              </span>
            );
          })}
        </div>

        {planned && promptWhatHappened && unresolved && (
          <p className={styles.whatHappened}>What happened?</p>
        )}

        {(planned || item.occurrence.completionMode === 'log') && (
          <footer className={styles.actions}>
            {planned && (
              <button
                type="button"
                disabled={busyId === item.occurrence.id}
                onClick={() => void markDone(item)}
              >
                <Check size={15} />
                Done
              </button>
            )}
            <button
              type="button"
              className={styles.detailsToggle}
              disabled={busyId === item.occurrence.id}
              onClick={() =>
                openDetailsFor ? cancelDetails() : openDetails(item)
              }
            >
              {openDetailsFor ? (
                <>
                  <ChevronUp size={15} /> Hide details
                </>
              ) : (
                <>
                  <ChevronDown size={15} /> Add details
                </>
              )}
            </button>
            {planned && (
              <>
                <button
                  type="button"
                  disabled={busyId === item.occurrence.id}
                  onClick={() => void markSkip(item)}
                >
                  <Minus size={15} />
                  Skip
                </button>
                <button
                  type="button"
                  disabled={busyId === item.occurrence.id}
                  onClick={() => {
                    setMoveFor(item.occurrence.id);
                    setMoveDate(defaultMoveDate(item));
                  }}
                >
                  <CalendarRange size={15} />
                  Move
                </button>
              </>
            )}
          </footer>
        )}

        {planned && moveFor === item.occurrence.id && (
          <div className={styles.movePanel}>
            <label className="fieldLabel" htmlFor={`move-${item.occurrence.id}`}>
              Move to
            </label>
            <input
              id={`move-${item.occurrence.id}`}
              className="textInput"
              type="date"
              value={moveDate}
              onChange={(event) => setMoveDate(event.target.value)}
            />
            <div className={styles.detailsActions}>
              <button
                type="button"
                className="primaryButton"
                disabled={busyId === item.occurrence.id}
                onClick={() => void confirmMove(item)}
              >
                Save move
              </button>
              <button
                type="button"
                className={styles.cancelDetails}
                onClick={() => setMoveFor(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {openDetailsFor && (
          <div className={styles.detailsPanel}>
            <label className="fieldLabel" htmlFor={`activity-${item.occurrence.id}`}>
              What did you do?
            </label>
            <input
              id={`activity-${item.occurrence.id}`}
              className="textInput"
              value={activity}
              onChange={(event) => setActivity(event.target.value)}
              placeholder="Short action…"
            />
            <label
              className="fieldLabel"
              htmlFor={`details-${item.occurrence.id}`}
            >
              Details <span>optional</span>
            </label>
            <textarea
              id={`details-${item.occurrence.id}`}
              className="textInput"
              rows={3}
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              placeholder="Anything that helps prove the work…"
            />
            <label className="fieldLabel">Who can see this?</label>
            <div className="visibilityPicker">
              <button
                type="button"
                className={visibility === 'friends' ? 'selected' : ''}
                onClick={() => setVisibility('friends')}
              >
                <Users size={15} /> Friends
              </button>
              <button
                type="button"
                className={visibility === 'private' ? 'selected' : ''}
                onClick={() => setVisibility('private')}
              >
                🔒 Private
              </button>
            </div>
            {awaitingClarification && (
              <>
                <label
                  className="fieldLabel"
                  htmlFor={`clarify-${item.occurrence.id}`}
                >
                  Clarification
                </label>
                <textarea
                  id={`clarify-${item.occurrence.id}`}
                  className="textInput"
                  rows={2}
                  value={clarificationText}
                  onChange={(event) =>
                    setClarificationText(event.target.value)
                  }
                  placeholder="What exactly did you do?"
                />
              </>
            )}
            <div className={styles.detailsActions}>
              <button
                type="button"
                className={`primaryButton ${styles.saveDetails}`}
                disabled={busyId === item.occurrence.id}
                onClick={() => void submitDetails(item)}
              >
                Save log
              </button>
              <button
                type="button"
                className={styles.cancelDetails}
                disabled={busyId === item.occurrence.id}
                onClick={cancelDetails}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </article>
    );
  }

  return (
    <section className={`pageSection ${styles.page}`}>
      <div className={styles.titleRow}>
        <div>
          <p className="eyebrow">PLANNER</p>
          <h2>Today</h2>
          <p className="subtitle">
            Check off what you planned. Done records adherence only — progress
            credit still requires a Log through Bettr&apos;s normal checks. It does
            not award XP by itself.
          </p>
        </div>
      </div>

      {notice && (
        <div className="socialNotice">
          {notice}
          <button type="button" onClick={() => setNotice(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      {!user || !supabaseConfigured ? (
        <div className={`card emptyFriendState ${styles.empty}`}>
          <CalendarCheck />
          <h3>Sign in to run Today.</h3>
          <p>Your private plan stays on your Bettr account.</p>
        </div>
      ) : loading ? (
        <div className={`card ${styles.loading}`}>
          <div className="syncPulse">
            <i />
            <i />
            <i />
          </div>
          <p>Loading today&apos;s plan…</p>
        </div>

      ) : !hasAny ? (
        <div className={`card emptyFriendState ${styles.empty}`}>
          <CalendarCheck />
          <h3>Nothing planned for today.</h3>
          <p>
            Create a routine or to-do under Plan, then come back here to check it
            off.
          </p>
        </div>
      ) : (
        <>
          {catchUp.length > 0 && (
            <div className={styles.catchUp}>
              <h3>Catch up</h3>
              <p className={styles.catchUpCopy}>What happened?</p>
              <div className={styles.catchUpList}>
                {catchUp.map((item) => renderCard(item, true))}
              </div>
            </div>
          )}
          {actionableItems.length > 0 ? (
            <div className={styles.list}>
              {actionableItems.map((item) =>
                renderCard(
                  item,
                  deriveOccurrenceState(item.occurrence, now) === 'unresolved'
                )
              )}
            </div>
          ) : catchUp.length > 0 && resolvedToday.length === 0 ? (
            <div className={`card emptyFriendState ${styles.empty}`}>
              <CalendarCheck />
              <h3>Nothing else planned for today.</h3>
            </div>
          ) : null}
          {resolvedToday.length > 0 && (
            <div className={styles.resolvedToday}>
              <h3>Resolved today</h3>
              <ul className={styles.resolvedList}>
                {resolvedToday.map((row) => {
                  const changeItem = historyItemForTerminal(row);
                  const changing = Boolean(
                    changeItem && moveFor === changeItem.occurrence.id
                  );
                  return (
                    <li key={row.key} className={styles.resolvedRow}>
                      <div className={styles.resolvedCopy}>
                        <span className={styles.resolvedTitle}>{row.title}</span>
                        <span className={styles.resolvedMeta}>
                          {row.sourceLabel} · {row.labels.join(' · ')}
                        </span>
                        {changeItem && (
                          <button
                            type="button"
                            className={styles.changeDate}
                            disabled={busyId === changeItem.occurrence.id}
                            onClick={() => {
                              setMoveFor(changeItem.occurrence.id);
                              setMoveDate(defaultMoveDate(changeItem));
                            }}
                          >
                            Change date
                          </button>
                        )}
                      </div>
                      {changing && changeItem && (
                        <div className={styles.resolvedMove}>
                          <label
                            className="fieldLabel"
                            htmlFor={`change-${changeItem.occurrence.id}`}
                          >
                            Move to
                          </label>
                          <input
                            id={`change-${changeItem.occurrence.id}`}
                            className="textInput"
                            type="date"
                            value={moveDate}
                            onChange={(event) =>
                              setMoveDate(event.target.value)
                            }
                          />
                          <div className={styles.detailsActions}>
                            <button
                              type="button"
                              className="primaryButton"
                              disabled={busyId === changeItem.occurrence.id}
                              onClick={() => void confirmMove(changeItem)}
                            >
                              Save move
                            </button>
                            <button
                              type="button"
                              className={styles.cancelDetails}
                              onClick={() => setMoveFor(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
