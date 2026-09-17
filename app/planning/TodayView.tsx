'use client';

import { useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { Check, CalendarCheck, ChevronDown, ChevronUp, X } from 'lucide-react';
import { supabase, supabaseConfigured } from '../../lib/supabase';
import {
  deriveOccurrenceState,
  detectBrowserTimeZone,
  planningCategoryDisplay,
  presentRoutineOccurrence,
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
} from '../../lib/planning/occurrencesAccess';
import {
  buildPlannerLogDraft,
  evaluatePlannerLogCredit,
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
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [detailsFor, setDetailsFor] = useState<string | null>(null);
  const [activity, setActivity] = useState('');
  const [details, setDetails] = useState('');
  const [clarificationText, setClarificationText] = useState('');
  const [awaitingClarification, setAwaitingClarification] = useState(false);

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
        setGoals(goalResult.data);
        setLoading(false);
        return;
      }

      setGoals(goalResult.data);
      setItems(buildItems(ensured.data, routineResult.data, todoResult.data));
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
    setDetailsFor(item.occurrence.id);
    setActivity(saved?.activity?.trim() ? saved.activity : item.title);
    // New planned Log: details start blank. Saved Log: reopen its details.
    setDetails(saved ? saved.details || '' : '');
    setClarificationText('');
    setAwaitingClarification(false);
    setNotice(null);
  }

  /** Close Add Details without creating a Log, completing, or awarding XP. */
  function cancelDetails() {
    setDetailsFor(null);
    setActivity('');
    setDetails('');
    setClarificationText('');
    setAwaitingClarification(false);
    setNotice(null);
  }

  function closeDetails() {
    cancelDetails();
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
    if (result.error || !result.data) {
      setNotice(result.error || 'Could not mark this done.');
      return;
    }
    setItems((prev) =>
      prev.map((row) =>
        row.occurrence.id === item.occurrence.id
          ? { ...row, occurrence: result.data! }
          : row
      )
    );
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
    const credit = await evaluatePlannerLogCredit({
      activity: cleanActivity,
      details,
      categories: item.categories,
      hasImage: false,
      logDate: item.occurrence.scheduledDate,
      startTime: item.occurrence.scheduledTime,
      durationMinutes: item.occurrence.durationMinutes,
      clarificationPass: awaitingClarification,
      clarificationText,
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
        if (light.error || !light.data) {
          setBusyId(null);
          setNotice(light.error || 'Could not record adherence.');
          return;
        }
        setItems((prev) =>
          prev.map((row) =>
            row.occurrence.id === item.occurrence.id
              ? { ...row, occurrence: light.data! }
              : row
          )
        );
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
        hasImage: false,
        logDate: item.occurrence.scheduledDate,
        startTime: item.occurrence.scheduledTime,
        durationMinutes: item.occurrence.durationMinutes,
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
        setItems((prev) =>
          prev.map((row) =>
            row.occurrence.id === item.occurrence.id
              ? {
                  ...row,
                  occurrence: { ...row.occurrence, logId },
                }
              : row
          )
        );
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
    if (linked.error || !linked.data) {
      setNotice(linked.error || 'Log saved, but the plan link failed. Retry Add details.');
      return;
    }

    setItems((prev) =>
      prev.map((row) =>
        row.occurrence.id === item.occurrence.id
          ? { ...row, occurrence: linked.data! }
          : row
      )
    );
    closeDetails();
    onNotice(
      reuseLogId
        ? `Details updated · +${draft.points}`
        : `Logged · +${draft.points}`
    );
  }

  const now = new Date();

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
      ) : items.length === 0 ? (
        <div className={`card emptyFriendState ${styles.empty}`}>
          <CalendarCheck />
          <h3>Nothing planned for today.</h3>
          <p>
            Create a routine or to-do under Plan, then come back here to check it
            off.
          </p>
        </div>
      ) : (
        <div className={styles.list}>
          {items.map((item) => {
            const state = deriveOccurrenceState(item.occurrence, now);
            const linkedGoal = item.goalId
              ? goalTitleById.get(item.goalId)
              : null;
            const openDetailsFor = detailsFor === item.occurrence.id;
            const done =
              item.occurrence.status === 'completed' ||
              item.occurrence.status === 'skipped';

            return (
              <article className={`card ${styles.card}`} key={item.occurrence.id}>
                <header className={styles.cardHead}>
                  <span
                    className={`${styles.status} ${
                      state === 'unresolved'
                        ? styles.unresolved
                        : done
                          ? styles.done
                          : styles.planned
                    }`}
                  >
                    {state === 'unresolved'
                      ? 'Unresolved'
                      : item.occurrence.completionMode === 'log'
                        ? 'Logged'
                        : done
                          ? 'Done'
                          : 'Planned'}
                  </span>
                  <span className={styles.source}>{item.sourceLabel}</span>
                </header>

                <h3>{item.title}</h3>
                {item.parentContext && (
                  <p className={styles.parentContext}>{item.parentContext}</p>
                )}
                {item.occurrence.scheduledTime && (
                  <small className={styles.time}>
                    {item.occurrence.scheduledTime.slice(0, 5)}
                  </small>
                )}
                {linkedGoal && (
                  <small className={styles.goalLink}>
                    Supports · {linkedGoal}
                  </small>
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

                <footer className={styles.actions}>
                  {item.occurrence.status === 'planned' && (
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
                </footer>

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
                    <p className={styles.hint}>
                      Uses the same checks and scoring as +Log.
                    </p>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
