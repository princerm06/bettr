'use client';

import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import {
  PLANNING_CATEGORIES,
  PLANNING_TITLE_MAX_LENGTH,
  planningCategoryDisplay,
  prepareGoalCreate,
  type Goal,
  type PlanningCategoryKey,
} from '../../lib/planning';
import styles from './goals.module.css';

export type GoalFormValues = {
  title: string;
  description: string;
  categories: PlanningCategoryKey[];
  targetDate: string;
};

export default function GoalForm({
  ownerId,
  existing,
  busy,
  onClose,
  onSubmit,
}: {
  ownerId: string;
  existing?: Goal | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (values: GoalFormValues) => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [categories, setCategories] = useState<PlanningCategoryKey[]>(
    existing?.categories ? [...existing.categories] : []
  );
  const [targetDate, setTargetDate] = useState(existing?.targetDate ?? '');
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => categories.map((key) => planningCategoryDisplay(key)),
    [categories]
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
    const prepared = prepareGoalCreate(ownerId, {
      title,
      description,
      categories,
      targetDate: targetDate || null,
    });
    if (!prepared.ok) {
      setError(prepared.error);
      return;
    }
    onSubmit({
      title: prepared.value.title,
      description: prepared.value.description ?? '',
      categories: prepared.value.categories,
      targetDate: prepared.value.target_date ?? '',
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
        <p className="eyebrow">{existing ? 'EDIT GOAL' : 'NEW GOAL'}</p>
        <h2>{existing ? 'Update this goal.' : 'What are you working toward?'}</h2>
        <p>
          Goals are private intention. They do not award progress on their own —
          logs still record what you actually did.
        </p>

        <label className="fieldLabel" htmlFor="goal-title">
          Name
        </label>
        <input
          id="goal-title"
          className="textInput"
          value={title}
          maxLength={PLANNING_TITLE_MAX_LENGTH}
          autoFocus
          placeholder="e.g. Pass organic chemistry"
          onChange={(event) => {
            setTitle(event.target.value);
            setError(null);
          }}
        />

        <label className="fieldLabel">
          Categories <span>1–3 areas this goal supports</span>
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

        <label className="fieldLabel" htmlFor="goal-description">
          Notes <span>optional</span>
        </label>
        <textarea
          id="goal-description"
          className="textArea"
          value={description}
          placeholder="Why this matters, or what done looks like."
          onChange={(event) => setDescription(event.target.value)}
        />

        <label className="fieldLabel" htmlFor="goal-target-date">
          Target date <span>optional</span>
        </label>
        <div className="dateField">
          <input
            id="goal-target-date"
            className="textInput"
            type="date"
            value={targetDate}
            onChange={(event) => {
              setTargetDate(event.target.value);
              setError(null);
            }}
          />
        </div>

        {error && <p className="composerFieldError">{error}</p>}

        <button
          className={`primaryButton submitLog ${styles.saveButton}`}
          type="button"
          disabled={busy}
          onClick={submit}
        >
          {busy ? 'Saving…' : existing ? 'Save goal' : 'Create goal'}
        </button>
      </div>
    </div>
  );
}
