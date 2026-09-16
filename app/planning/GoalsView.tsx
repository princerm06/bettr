'use client';

import { useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { Archive, Check, Pencil, Plus, RotateCcw, Target, X } from 'lucide-react';
import { supabase, supabaseConfigured } from '../../lib/supabase';
import {
  GOAL_STATUS_TRANSITIONS,
  planningCategoryDisplay,
  type Goal,
  type PlanningGoalStatus,
} from '../../lib/planning';
import {
  createOwnedGoal,
  listOwnedGoals,
  transitionOwnedGoalStatus,
  updateOwnedGoal,
} from '../../lib/planning/goalsAccess';
import GoalForm, { type GoalFormValues } from './GoalForm';
import styles from './goals.module.css';

type StatusFilter = 'active' | 'completed' | 'archived' | 'all';

const STATUS_COPY: Record<PlanningGoalStatus, string> = {
  active: 'Active',
  completed: 'Completed',
  archived: 'Archived',
};

const TRANSITION_COPY: Record<PlanningGoalStatus, string> = {
  active: 'Reopen',
  completed: 'Complete',
  archived: 'Archive',
};

function formatGoalDate(iso: string) {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso;
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function nextStatusActions(status: PlanningGoalStatus) {
  return GOAL_STATUS_TRANSITIONS[status];
}

function transitionIcon(status: PlanningGoalStatus) {
  if (status === 'completed') return <Check size={15} />;
  if (status === 'archived') return <Archive size={15} />;
  return <RotateCcw size={15} />;
}

export default function GoalsView({
  user,
  onNotice,
}: {
  user: User | null;
  onNotice: (message: string) => void;
}) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('active');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);

  const ownerId = user?.id ?? '';

  async function refresh() {
    if (!ownerId) {
      setGoals([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const result = await listOwnedGoals(supabase, ownerId);
    setGoals(result.data);
    setNotice(result.error);
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, [ownerId]);

  const counts = useMemo(() => {
    return {
      active: goals.filter((goal) => goal.status === 'active').length,
      completed: goals.filter((goal) => goal.status === 'completed').length,
      archived: goals.filter((goal) => goal.status === 'archived').length,
      all: goals.length,
    };
  }, [goals]);

  const visible = useMemo(() => {
    if (filter === 'all') return goals;
    return goals.filter((goal) => goal.status === filter);
  }, [filter, goals]);

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
    setNotice(null);
  }

  function openEdit(goal: Goal) {
    setEditing(goal);
    setFormOpen(true);
    setNotice(null);
  }

  async function saveGoal(values: GoalFormValues) {
    if (!ownerId) {
      setNotice('Sign in to manage goals.');
      return;
    }
    setSaving(true);
    const input = {
      title: values.title,
      description: values.description,
      categories: values.categories,
      targetDate: values.targetDate || null,
    };
    const result = editing
      ? await updateOwnedGoal(supabase, ownerId, editing.id, input)
      : await createOwnedGoal(supabase, ownerId, input);
    setSaving(false);
    if (result.error || !result.data) {
      setNotice(result.error || 'Could not save this goal.');
      return;
    }
    setFormOpen(false);
    setEditing(null);
    onNotice(editing ? 'Goal updated.' : 'Goal created.');
    await refresh();
  }

  async function changeStatus(goal: Goal, next: PlanningGoalStatus) {
    if (!ownerId) return;
    setStatusBusy(goal.id);
    const result = await transitionOwnedGoalStatus(supabase, ownerId, goal, next);
    setStatusBusy(null);
    if (result.error || !result.data) {
      setNotice(result.error || 'Could not update goal status.');
      return;
    }
    onNotice(`Goal ${STATUS_COPY[next].toLowerCase()}.`);
    await refresh();
  }

  const emptyCopy =
    filter === 'active'
      ? {
          title: 'No goals yet.',
          body: 'Name an outcome you are working toward. Routines and to-dos can support it later — this is just the direction.',
        }
      : filter === 'completed'
        ? {
            title: 'No completed goals.',
            body: 'When you finish something that mattered, mark it complete. Completing a goal does not award XP.',
          }
        : filter === 'archived'
          ? {
              title: 'Nothing archived.',
              body: 'Archive a goal when it is no longer the plan — without deleting the intention.',
            }
          : {
              title: 'No goals yet.',
              body: 'Create a private goal to start planning with intention.',
            };

  return (
    <section className={`pageSection ${styles.page}`}>
      <div className={styles.titleRow}>
        <div>
          <p className="eyebrow">PLANNING</p>
          <h2>Goals</h2>
          <p className="subtitle">
            Private intention only. Completing a goal does not award XP or change
            progress.
          </p>
        </div>
        <button
          className={`primaryButton ${styles.createButton}`}
          type="button"
          onClick={openCreate}
          disabled={!user || !supabaseConfigured}
        >
          <Plus size={16} /> New goal
        </button>
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
          <Target />
          <h3>Sign in to keep goals.</h3>
          <p>Goals are saved privately to your Bettr account.</p>
        </div>
      ) : (
        <>
          <div className={`viewSwitch ${styles.filters}`}>
            {(['active', 'completed', 'archived', 'all'] as const).map((key) => (
              <button
                key={key}
                type="button"
                className={filter === key ? 'active' : ''}
                onClick={() => setFilter(key)}
              >
                {key === 'all' ? 'All' : STATUS_COPY[key]} · {counts[key]}
              </button>
            ))}
          </div>

          {loading ? (
            <div className={`card ${styles.loading}`}>
              <div className="syncPulse">
                <i />
                <i />
                <i />
              </div>
              <p>Loading your goals…</p>
            </div>
          ) : visible.length === 0 ? (
            <div className={`card emptyFriendState ${styles.empty}`}>
              <Target />
              <h3>{emptyCopy.title}</h3>
              <p>{emptyCopy.body}</p>
              {filter === 'active' && (
                <button
                  className="primaryButton"
                  type="button"
                  onClick={openCreate}
                >
                  <Plus size={16} /> Create a goal
                </button>
              )}
            </div>
          ) : (
            <div className={styles.grid}>
              {visible.map((goal) => (
                <article className={`card ${styles.card}`} key={goal.id}>
                  <header className={styles.cardHead}>
                    <span className={`${styles.status} ${styles[goal.status]}`}>
                      {STATUS_COPY[goal.status]}
                    </span>
                    <div className={styles.cardActions}>
                      <button
                        type="button"
                        className={styles.editButton}
                        title="Edit goal"
                        aria-label="Edit goal"
                        onClick={() => openEdit(goal)}
                      >
                        <Pencil size={15} />
                      </button>
                    </div>
                  </header>
                  <h3>{goal.title}</h3>
                  {goal.description && <p>{goal.description}</p>}
                  {goal.targetDate && (
                    <small className={styles.target}>
                      Target {formatGoalDate(goal.targetDate)}
                    </small>
                  )}
                  <div className={styles.pills}>
                    {goal.categories.map((key) => {
                      const item = planningCategoryDisplay(key);
                      return (
                        <span key={key}>
                          {item.emoji} {item.short}
                        </span>
                      );
                    })}
                  </div>
                  <footer className={styles.transitions}>
                    {nextStatusActions(goal.status).map((next) => (
                      <button
                        key={next}
                        type="button"
                        disabled={statusBusy === goal.id}
                        onClick={() => void changeStatus(goal, next)}
                      >
                        {transitionIcon(next)}
                        {next === 'active' && goal.status === 'archived'
                          ? 'Restore'
                          : TRANSITION_COPY[next]}
                      </button>
                    ))}
                  </footer>
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {formOpen && user && (
        <GoalForm
          key={editing?.id ?? 'new'}
          ownerId={user.id}
          existing={editing}
          busy={saving}
          onClose={() => {
            if (!saving) {
              setFormOpen(false);
              setEditing(null);
            }
          }}
          onSubmit={(values) => void saveGoal(values)}
        />
      )}
    </section>
  );
}
