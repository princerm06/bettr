'use client';

import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import {
  PLANNING_CATEGORIES,
  PLANNING_TITLE_MAX_LENGTH,
  planningCategoryDisplay,
  prepareTodoCreate,
  type Goal,
  type PlanningCategoryKey,
  type Todo,
} from '../../lib/planning';
import styles from './todos.module.css';

export type TodoFormValues = {
  title: string;
  description: string;
  categories: PlanningCategoryKey[];
  goalId: string;
};

export default function TodoForm({
  ownerId,
  existing,
  goals,
  busy,
  onClose,
  onSubmit,
}: {
  ownerId: string;
  existing?: Todo | null;
  goals: Goal[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (values: TodoFormValues) => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [categories, setCategories] = useState<PlanningCategoryKey[]>(
    existing?.categories ? [...existing.categories] : []
  );
  const [goalId, setGoalId] = useState(existing?.goalId ?? '');
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => categories.map((key) => planningCategoryDisplay(key)),
    [categories]
  );

  const linkableGoals = useMemo(
    () =>
      goals.filter(
        (goal) => goal.status === 'active' || goal.id === existing?.goalId
      ),
    [goals, existing?.goalId]
  );

  function toggleCategory(key: PlanningCategoryKey) {
    setError(null);
    setCategories((current) => {
      if (current.includes(key)) return current.filter((item) => item !== key);
      if (current.length >= 3) return current;
      return [...current, key];
    });
  }

  function submit() {
    const prepared = prepareTodoCreate(ownerId, {
      title,
      description,
      categories,
      goalId: goalId || null,
    });
    if (!prepared.ok) {
      setError(prepared.error);
      return;
    }
    onSubmit({
      title: prepared.value.title,
      description: prepared.value.description ?? '',
      categories: prepared.value.categories,
      goalId: prepared.value.goal_id ?? '',
    });
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className={`modal ${styles.formModal}`}
        onClick={(event) => event.stopPropagation()}
      >
        <button className="close" type="button" onClick={onClose} aria-label="Close">
          <X />
        </button>
        <p className="eyebrow">{existing ? 'EDIT TO-DO' : 'NEW TO-DO'}</p>
        <h2>{existing ? 'Update this to-do.' : 'What needs doing once?'}</h2>
        <p>
          To-dos are private intention. Marking one done is planning status only —
          it does not award XP or create a log.
        </p>

        <label className="fieldLabel" htmlFor="todo-title">
          Name
        </label>
        <input
          id="todo-title"
          className="textInput"
          value={title}
          maxLength={PLANNING_TITLE_MAX_LENGTH}
          autoFocus
          placeholder="e.g. Submit lab report"
          onChange={(event) => {
            setTitle(event.target.value);
            setError(null);
          }}
        />

        <label className="fieldLabel">
          Categories <span>1–3 areas this to-do supports</span>
        </label>
        <div className="categoryPicker multiCategoryPicker">
          {PLANNING_CATEGORIES.map((item) => {
            const isSelected = categories.includes(item.key);
            const disabled = !isSelected && categories.length >= 3;
            return (
              <button
                key={item.key}
                type="button"
                className={isSelected ? 'selected' : ''}
                disabled={disabled}
                title={item.label}
                onClick={() => toggleCategory(item.key)}
              >
                {item.emoji}
                <span>{item.short}</span>
              </button>
            );
          })}
        </div>
        <div className="selectedCategorySummary">
          {selected.map((item) => (
            <span key={item.key} className="selectedCategoryPill">
              {item.emoji} {item.short}
              <button
                type="button"
                className="selectedCategoryRemove"
                aria-label={`Remove ${item.short}`}
                onClick={() => toggleCategory(item.key)}
              >
                ×
              </button>
            </span>
          ))}
        </div>

        <label className="fieldLabel" htmlFor="todo-goal">
          Linked goal <span>optional</span>
        </label>
        {linkableGoals.length === 0 ? (
          <p className={styles.emptyGoalHint} id="todo-goal">
            No active goals to link yet. You can still save this to-do on its
            own.
          </p>
        ) : (
          <div className={styles.selectWrap}>
            <select
              id="todo-goal"
              className={styles.formSelect}
              value={goalId}
              onChange={(event) => {
                setGoalId(event.target.value);
                setError(null);
              }}
            >
              <option value="">No linked goal</option>
              {linkableGoals.map((goal) => (
                <option key={goal.id} value={goal.id}>
                  {goal.title}
                </option>
              ))}
            </select>
          </div>
        )}

        <label className="fieldLabel" htmlFor="todo-description">
          Notes <span>optional</span>
        </label>
        <textarea
          id="todo-description"
          className="textArea"
          value={description}
          placeholder="Details, context, or what done looks like."
          onChange={(event) => setDescription(event.target.value)}
        />

        {error && <p className="composerFieldError">{error}</p>}

        <button
          className={`primaryButton submitLog ${styles.saveButton}`}
          type="button"
          disabled={busy}
          onClick={submit}
        >
          {busy ? 'Saving…' : existing ? 'Save to-do' : 'Create to-do'}
        </button>
      </div>
    </div>
  );
}
