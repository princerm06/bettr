'use client';

import { useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { Archive, Pencil, Plus, Repeat, RotateCcw, X } from 'lucide-react';
import { supabase, supabaseConfigured } from '../../lib/supabase';
import {
  formatRoutineRecurrence,
  planningCategoryDisplay,
  type Goal,
  type Routine,
} from '../../lib/planning';
import { listOwnedGoals } from '../../lib/planning/goalsAccess';
import {
  createOwnedRoutine,
  listOwnedRoutines,
  setOwnedRoutineActive,
  updateOwnedRoutine,
} from '../../lib/planning/routinesAccess';
import RoutineForm, { type RoutineFormValues } from './RoutineForm';
import styles from './routines.module.css';

type StatusFilter = 'active' | 'archived' | 'all';

function formatScheduledTime(value: string | null) {
  if (!value) return null;
  const hhmm = value.slice(0, 5);
  const [hourText, minuteText] = hhmm.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return hhmm;
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function RoutinesView({
  user,
  onNotice,
}: {
  user: User | null;
  onNotice: (message: string) => void;
}) {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('active');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Routine | null>(null);

  const ownerId = user?.id ?? '';

  const goalTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const goal of goals) map.set(goal.id, goal.title);
    return map;
  }, [goals]);

  async function refresh() {
    if (!ownerId) {
      setRoutines([]);
      setGoals([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [routineResult, goalResult] = await Promise.all([
      listOwnedRoutines(supabase, ownerId),
      listOwnedGoals(supabase, ownerId),
    ]);
    setRoutines(routineResult.data);
    setGoals(goalResult.data);
    setNotice(routineResult.error || goalResult.error);
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, [ownerId]);

  const counts = useMemo(() => {
    return {
      active: routines.filter((routine) => routine.isActive).length,
      archived: routines.filter((routine) => !routine.isActive).length,
      all: routines.length,
    };
  }, [routines]);

  const visible = useMemo(() => {
    if (filter === 'all') return routines;
    if (filter === 'active') return routines.filter((routine) => routine.isActive);
    return routines.filter((routine) => !routine.isActive);
  }, [filter, routines]);

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
    setNotice(null);
  }

  function openEdit(routine: Routine) {
    setEditing(routine);
    setFormOpen(true);
    setNotice(null);
  }

  async function saveRoutine(values: RoutineFormValues) {
    if (!ownerId) {
      setNotice('Sign in to manage routines.');
      return;
    }
    setSaving(true);
    const input = {
      title: values.title,
      description: values.description,
      categories: values.categories,
      goalId: values.goalId || null,
      recurrenceType: values.recurrenceType,
      weekdays: values.recurrenceType === 'daily' ? null : values.weekdays,
      weekdayLabels:
        values.recurrenceType === 'daily' ? null : values.weekdayLabels,
      scheduledTime: values.scheduledTime || null,
      durationMinutes: values.durationMinutes || null,
      timezone: values.timezone,
    };
    const result = editing
      ? await updateOwnedRoutine(supabase, ownerId, editing.id, input)
      : await createOwnedRoutine(supabase, ownerId, input);
    setSaving(false);
    if (result.error || !result.data) {
      setNotice(result.error || 'Could not save this routine.');
      return;
    }
    setFormOpen(false);
    setEditing(null);
    onNotice(editing ? 'Routine updated.' : 'Routine created.');
    await refresh();
  }

  async function changeActive(routine: Routine, nextActive: boolean) {
    if (!ownerId) return;
    setStatusBusy(routine.id);
    const result = await setOwnedRoutineActive(
      supabase,
      ownerId,
      routine,
      nextActive
    );
    setStatusBusy(null);
    if (result.error || !result.data) {
      setNotice(result.error || 'Could not update routine.');
      return;
    }
    onNotice(nextActive ? 'Routine restored.' : 'Routine archived.');
    await refresh();
  }

  const emptyCopy =
    filter === 'active'
      ? {
          title: 'No routines yet.',
          body: 'Name something you want to repeat. Completing a routine later does not award XP by itself.',
        }
      : filter === 'archived'
        ? {
            title: 'Nothing archived.',
            body: 'Archive a routine when it is no longer the plan — without deleting the intention.',
          }
        : {
            title: 'No routines yet.',
            body: 'Create a private routine to start repeating with intention.',
          };

  return (
    <section className={`pageSection ${styles.page}`}>
      <div className={styles.titleRow}>
        <div>
          <p className="eyebrow">PLANNING</p>
          <h2>Routines</h2>
          <p className="subtitle">
            Private intention only. Creating or archiving a routine does not award
            XP or change progress.
          </p>
        </div>
        <button
          className={`primaryButton ${styles.createButton}`}
          type="button"
          onClick={openCreate}
          disabled={!user || !supabaseConfigured}
        >
          <Plus size={16} /> New routine
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
          <Repeat />
          <h3>Sign in to keep routines.</h3>
          <p>Routines are saved privately to your Bettr account.</p>
        </div>
      ) : (
        <>
          <div className={`viewSwitch ${styles.filters}`}>
            {(['active', 'archived', 'all'] as const).map((key) => (
              <button
                key={key}
                type="button"
                className={filter === key ? 'active' : ''}
                onClick={() => setFilter(key)}
              >
                {key === 'all'
                  ? 'All'
                  : key === 'active'
                    ? 'Active'
                    : 'Archived'}{' '}
                · {counts[key]}
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
              <p>Loading your routines…</p>
            </div>
          ) : visible.length === 0 ? (
            <div className={`card emptyFriendState ${styles.empty}`}>
              <Repeat />
              <h3>{emptyCopy.title}</h3>
              <p>{emptyCopy.body}</p>
              {filter === 'active' && (
                <button
                  className="primaryButton"
                  type="button"
                  onClick={openCreate}
                >
                  <Plus size={16} /> Create a routine
                </button>
              )}
            </div>
          ) : (
            <div className={styles.grid}>
              {visible.map((routine) => {
                const timeLabel = formatScheduledTime(routine.scheduledTime);
                const linkedGoal = routine.goalId
                  ? goalTitleById.get(routine.goalId)
                  : null;
                return (
                  <article className={`card ${styles.card}`} key={routine.id}>
                    <header className={styles.cardHead}>
                      <span
                        className={`${styles.status} ${
                          routine.isActive ? styles.active : styles.archived
                        }`}
                      >
                        {routine.isActive ? 'Active' : 'Archived'}
                      </span>
                      <div className={styles.cardActions}>
                        <button
                          type="button"
                          className={styles.editButton}
                          title="Edit routine"
                          aria-label="Edit routine"
                          onClick={() => openEdit(routine)}
                        >
                          <Pencil size={15} />
                        </button>
                      </div>
                    </header>
                    <h3>{routine.title}</h3>
                    {routine.description && <p>{routine.description}</p>}
                    <div className={styles.meta}>
                      <small>{formatRoutineRecurrence(routine)}</small>
                      {timeLabel && <small>Around {timeLabel}</small>}
                      {routine.durationMinutes != null && (
                        <small>{routine.durationMinutes} min</small>
                      )}
                    </div>
                    {linkedGoal && (
                      <small className={styles.goalLink}>
                        Supports · {linkedGoal}
                      </small>
                    )}
                    <div className={styles.pills}>
                      {routine.categories.map((key) => {
                        const item = planningCategoryDisplay(key);
                        return (
                          <span key={key}>
                            {item.emoji} {item.short}
                          </span>
                        );
                      })}
                    </div>
                    <footer className={styles.transitions}>
                      {routine.isActive ? (
                        <button
                          type="button"
                          disabled={statusBusy === routine.id}
                          onClick={() => void changeActive(routine, false)}
                        >
                          <Archive size={15} />
                          Archive
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={statusBusy === routine.id}
                          onClick={() => void changeActive(routine, true)}
                        >
                          <RotateCcw size={15} />
                          Restore
                        </button>
                      )}
                    </footer>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}

      {formOpen && user && (
        <RoutineForm
          key={editing?.id ?? 'new'}
          ownerId={user.id}
          existing={editing}
          goals={goals}
          busy={saving}
          onClose={() => {
            if (!saving) {
              setFormOpen(false);
              setEditing(null);
            }
          }}
          onSubmit={(values) => void saveRoutine(values)}
        />
      )}
    </section>
  );
}
