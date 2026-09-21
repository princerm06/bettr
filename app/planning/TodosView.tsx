'use client';

import { useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { Check, ListTodo, Pencil, Plus, RotateCcw, X } from 'lucide-react';
import { supabase, supabaseConfigured } from '../../lib/supabase';
import {
  isTodoOpen,
  detectBrowserTimeZone,
  planningCategoryDisplay,
  type Goal,
  type Todo,
} from '../../lib/planning';
import { listOwnedGoals } from '../../lib/planning/goalsAccess';
import {
  completeOwnedOccurrenceLight,
  listOwnedOccurrencesForSources,
  reopenOwnedTodoForAnotherAttempt,
} from '../../lib/planning/occurrencesAccess';
import {
  createOwnedTodo,
  listOwnedTodos,
  setOwnedTodoArchived,
  updateOwnedTodo,
} from '../../lib/planning/todosAccess';
import TodoForm, { type TodoFormValues } from './TodoForm';
import styles from './todos.module.css';

type StatusFilter = 'open' | 'done' | 'all';

export default function TodosView({
  user,
  onNotice,
}: {
  user: User | null;
  onNotice: (message: string) => void;
}) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('open');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Todo | null>(null);

  const ownerId = user?.id ?? '';

  const goalTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const goal of goals) map.set(goal.id, goal.title);
    return map;
  }, [goals]);

  async function refresh() {
    if (!ownerId) {
      setTodos([]);
      setGoals([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [todoResult, goalResult] = await Promise.all([
      listOwnedTodos(supabase, ownerId),
      listOwnedGoals(supabase, ownerId),
    ]);
    setTodos(todoResult.data);
    setGoals(goalResult.data);
    setNotice(todoResult.error || goalResult.error);
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, [ownerId]);

  const counts = useMemo(() => {
    return {
      open: todos.filter((todo) => isTodoOpen(todo)).length,
      done: todos.filter((todo) => !isTodoOpen(todo)).length,
      all: todos.length,
    };
  }, [todos]);

  const visible = useMemo(() => {
    if (filter === 'all') return todos;
    if (filter === 'open') return todos.filter((todo) => isTodoOpen(todo));
    return todos.filter((todo) => !isTodoOpen(todo));
  }, [filter, todos]);

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
    setNotice(null);
  }

  function openEdit(todo: Todo) {
    setEditing(todo);
    setFormOpen(true);
    setNotice(null);
  }

  async function saveTodo(values: TodoFormValues) {
    if (!ownerId) {
      setNotice('Sign in to manage to-dos.');
      return;
    }
    setSaving(true);
    const input = {
      title: values.title,
      description: values.description,
      categories: values.categories,
      goalId: values.goalId || null,
    };
    const result = editing
      ? await updateOwnedTodo(supabase, ownerId, editing.id, input)
      : await createOwnedTodo(supabase, ownerId, input);
    setSaving(false);
    if (result.error || !result.data) {
      setNotice(result.error || 'Could not save this to-do.');
      return;
    }
    setFormOpen(false);
    setEditing(null);
    onNotice(editing ? 'To-do updated.' : 'To-do created.');
    await refresh();
  }

  async function changeDone(todo: Todo, nextDone: boolean) {
    if (!ownerId) return;
    setStatusBusy(todo.id);
    const result = await setOwnedTodoArchived(
      supabase,
      ownerId,
      todo,
      nextDone
    );
    if (result.error || !result.data) {
      setStatusBusy(null);
      setNotice(result.error || 'Could not update to-do.');
      return;
    }

    if (nextDone) {
      const listed = await listOwnedOccurrencesForSources(supabase, ownerId, {
        todoIds: [todo.id],
      });
      if (listed.error) {
        setStatusBusy(null);
        setNotice(listed.error);
        await refresh();
        return;
      }
      const resolvedAt = new Date().toISOString();
      for (const occurrence of listed.data) {
        if (occurrence.status !== 'planned') continue;
        const light = await completeOwnedOccurrenceLight(
          supabase,
          ownerId,
          occurrence,
          resolvedAt
        );
        if (light.error && !light.data) {
          setStatusBusy(null);
          setNotice(light.error);
          await refresh();
          return;
        }
      }
      onNotice('To-do marked done (planning status only).');
    } else {
      const reopened = await reopenOwnedTodoForAnotherAttempt(
        supabase,
        ownerId,
        result.data,
        new Date(),
        detectBrowserTimeZone()
      );
      if (reopened.error) {
        setStatusBusy(null);
        setNotice(reopened.error);
        await refresh();
        return;
      }
      onNotice('To-do reopened for another attempt. Earlier history stays.');
    }

    setStatusBusy(null);
    await refresh();
  }

  const emptyCopy =
    filter === 'open'
      ? {
          title: 'No open to-dos.',
          body: 'Capture a one-off intention. Marking it done later is planning status — it does not award XP.',
        }
      : filter === 'done'
        ? {
            title: 'Nothing marked done.',
            body: 'When you finish a planned item, mark it done. That does not award XP or create a log.',
          }
        : {
            title: 'No to-dos yet.',
            body: 'Create a private to-do for a one-off developmental intention.',
          };

  return (
    <section className={`pageSection ${styles.page}`}>
      <div className={styles.titleRow}>
        <div>
          <p className="eyebrow">PLANNING</p>
          <h2>To-Dos</h2>
          <p className="subtitle">
            Private intention only. Marking a to-do done is planning status — it
            does not award XP or change progress.
          </p>
        </div>
        <button
          className={`primaryButton ${styles.createButton}`}
          type="button"
          onClick={openCreate}
          disabled={!user || !supabaseConfigured}
        >
          <Plus size={16} /> New to-do
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
          <ListTodo />
          <h3>Sign in to keep to-dos.</h3>
          <p>To-dos are saved privately to your Bettr account.</p>
        </div>
      ) : (
        <>
          <div className={`viewSwitch ${styles.filters}`}>
            {(
              [
                ['open', 'Open'],
                ['done', 'Done'],
                ['all', 'All'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={filter === key ? 'active' : ''}
                onClick={() => setFilter(key)}
              >
                {label} · {counts[key]}
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
              <p>Loading your to-dos…</p>
            </div>
          ) : visible.length === 0 ? (
            <div className={`card emptyFriendState ${styles.empty}`}>
              <ListTodo />
              <h3>{emptyCopy.title}</h3>
              <p>{emptyCopy.body}</p>
              {filter === 'open' && (
                <button
                  className="primaryButton"
                  type="button"
                  onClick={openCreate}
                >
                  <Plus size={16} /> Create a to-do
                </button>
              )}
            </div>
          ) : (
            <div className={styles.grid}>
              {visible.map((todo) => {
                const open = isTodoOpen(todo);
                const linkedTitle = todo.goalId
                  ? goalTitleById.get(todo.goalId)
                  : null;
                return (
                  <article className={`card ${styles.card}`} key={todo.id}>
                    <header className={styles.cardHead}>
                      <span
                        className={`${styles.status} ${
                          open ? styles.open : styles.done
                        }`}
                      >
                        {open ? 'Open' : 'Done'}
                      </span>
                      <div className={styles.cardActions}>
                        <button
                          type="button"
                          className={styles.editButton}
                          title="Edit to-do"
                          aria-label="Edit to-do"
                          onClick={() => openEdit(todo)}
                        >
                          <Pencil size={15} />
                        </button>
                      </div>
                    </header>
                    <h3>{todo.title}</h3>
                    {todo.description && <p>{todo.description}</p>}
                    {linkedTitle && (
                      <small className={styles.goalLink}>
                        Supports · {linkedTitle}
                      </small>
                    )}
                    <div className={styles.pills}>
                      {todo.categories.map((key) => {
                        const item = planningCategoryDisplay(key);
                        return (
                          <span key={key}>
                            {item.emoji} {item.short}
                          </span>
                        );
                      })}
                    </div>
                    <footer className={styles.transitions}>
                      {open ? (
                        <button
                          type="button"
                          disabled={statusBusy === todo.id}
                          onClick={() => void changeDone(todo, true)}
                        >
                          <Check size={15} />
                          Mark done
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={statusBusy === todo.id}
                          onClick={() => void changeDone(todo, false)}
                        >
                          <RotateCcw size={15} />
                          Reopen
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
        <TodoForm
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
          onSubmit={(values) => void saveTodo(values)}
        />
      )}
    </section>
  );
}
