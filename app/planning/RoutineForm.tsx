'use client';

import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import {
  PLANNING_CATEGORIES,
  PLANNING_ISO_WEEKDAYS,
  PLANNING_TITLE_MAX_LENGTH,
  WEEKDAY_FULL_LABELS,
  WEEKDAY_LABELS,
  composeLocalScheduledTimeFromPickerParts,
  detectBrowserTimeZone,
  filterTimeZoneOptions,
  listIanaTimeZoneOptions,
  localScheduledTimeToPickerParts,
  planningCategoryDisplay,
  prepareRoutineCreate,
  type Goal,
  type LocalTimePeriod,
  type PlanningCategoryKey,
  type PlanningIsoWeekday,
  type PlanningRecurrenceType,
  type Routine,
} from '../../lib/planning';
import styles from './routines.module.css';

export type RoutineFormValues = {
  title: string;
  description: string;
  categories: PlanningCategoryKey[];
  goalId: string;
  recurrenceType: PlanningRecurrenceType;
  weekdays: PlanningIsoWeekday[];
  weekdayLabels: Partial<Record<PlanningIsoWeekday, string>>;
  scheduledTime: string;
  durationMinutes: string;
  timezone: string;
};

const HOUR_12_OPTIONS = Array.from({ length: 12 }, (_, index) =>
  String(index + 1).padStart(2, '0')
);
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, minute) =>
  String(minute).padStart(2, '0')
);

export default function RoutineForm({
  ownerId,
  existing,
  goals,
  busy,
  onClose,
  onSubmit,
}: {
  ownerId: string;
  existing?: Routine | null;
  goals: Goal[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (values: RoutineFormValues) => void;
}) {
  const browserTimeZone = useMemo(() => detectBrowserTimeZone(), []);
  const initialTime = localScheduledTimeToPickerParts(existing?.scheduledTime);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [categories, setCategories] = useState<PlanningCategoryKey[]>(
    existing?.categories ? [...existing.categories] : []
  );
  const [goalId, setGoalId] = useState(existing?.goalId ?? '');
  const [recurrenceType, setRecurrenceType] = useState<PlanningRecurrenceType>(
    existing?.recurrenceType ?? 'daily'
  );
  const [weekdays, setWeekdays] = useState<PlanningIsoWeekday[]>(
    existing?.weekdays ? [...existing.weekdays] : []
  );
  const [weekdayLabels, setWeekdayLabels] = useState<
    Partial<Record<PlanningIsoWeekday, string>>
  >(() => (existing?.weekdayLabels ? { ...existing.weekdayLabels } : {}));
  const [showDayLabels, setShowDayLabels] = useState(
    Boolean(
      existing?.weekdayLabels && Object.keys(existing.weekdayLabels).length > 0
    )
  );
  const [timeHour, setTimeHour] = useState(initialTime.hour12);
  const [timeMinute, setTimeMinute] = useState(initialTime.minute);
  const [timePeriod, setTimePeriod] = useState<LocalTimePeriod>(
    initialTime.period
  );
  const [durationMinutes, setDurationMinutes] = useState(
    existing?.durationMinutes != null ? String(existing.durationMinutes) : ''
  );
  const [timezone, setTimezone] = useState(
    existing?.timezone ?? browserTimeZone
  );
  const [timezoneQuery, setTimezoneQuery] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(
    Boolean(
      existing?.scheduledTime ||
        existing?.durationMinutes != null ||
        (existing?.timezone && existing.timezone !== browserTimeZone)
    )
  );
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

  const timezoneOptions = useMemo(
    () => listIanaTimeZoneOptions(timezone),
    [timezone]
  );

  const filteredTimezoneOptions = useMemo(() => {
    const filtered = filterTimeZoneOptions(timezoneOptions, timezoneQuery);
    if (filtered.some((option) => option.value === timezone)) return filtered;
    const current = timezoneOptions.find((option) => option.value === timezone);
    return current ? [current, ...filtered] : filtered;
  }, [timezoneOptions, timezoneQuery, timezone]);

  const scheduledTime = composeLocalScheduledTimeFromPickerParts(
    timeHour,
    timeMinute,
    timePeriod
  );

  function toggleCategory(key: PlanningCategoryKey) {
    setError(null);
    setCategories((current) => {
      if (current.includes(key)) return current.filter((item) => item !== key);
      if (current.length >= 3) return current;
      return [...current, key];
    });
  }

  function toggleWeekday(day: PlanningIsoWeekday) {
    setError(null);
    setWeekdays((current) => {
      if (current.includes(day)) {
        setWeekdayLabels((labels) => {
          if (!(day in labels)) return labels;
          const next = { ...labels };
          delete next[day];
          return next;
        });
        return current.filter((item) => item !== day);
      }
      return [...current, day].sort((a, b) => a - b);
    });
  }

  function chooseRecurrence(next: PlanningRecurrenceType) {
    setError(null);
    setRecurrenceType(next);
    if (next === 'daily') {
      setWeekdays([]);
      setWeekdayLabels({});
      setShowDayLabels(false);
    }
  }

  function setDayLabel(day: PlanningIsoWeekday, value: string) {
    setError(null);
    setWeekdayLabels((current) => {
      const next = { ...current };
      if (!value.trim()) {
        delete next[day];
        return next;
      }
      next[day] = value;
      return next;
    });
  }

  function setHour(next: string) {
    setError(null);
    setTimeHour(next);
    if (next && !timeMinute) setTimeMinute('00');
    if (!next) setTimeMinute('');
  }

  function setMinute(next: string) {
    setError(null);
    setTimeMinute(next);
    if (next && !timeHour) setTimeHour('07');
    if (!next) setTimeHour('');
  }

  function setPeriod(next: LocalTimePeriod) {
    setError(null);
    setTimePeriod(next);
  }

  function clearUsualTime() {
    setError(null);
    setTimeHour('');
    setTimeMinute('');
    setTimePeriod('AM');
  }

  function submit() {
    if ((timeHour && !timeMinute) || (!timeHour && timeMinute)) {
      setError('Choose both an hour and minute, or clear Usual time.');
      return;
    }
    const prepared = prepareRoutineCreate(ownerId, {
      title,
      description,
      categories,
      goalId: goalId || null,
      recurrenceType,
      weekdays: recurrenceType === 'daily' ? null : weekdays,
      weekdayLabels: recurrenceType === 'daily' ? null : weekdayLabels,
      scheduledTime: scheduledTime || null,
      durationMinutes: durationMinutes || null,
      timezone,
    });
    if (!prepared.ok) {
      setError(prepared.error);
      return;
    }
    const persistedLabels = prepared.value.weekday_labels ?? {};
    const formLabels: Partial<Record<PlanningIsoWeekday, string>> = {};
    for (const [key, value] of Object.entries(persistedLabels)) {
      const day = Number(key) as PlanningIsoWeekday;
      formLabels[day] = value;
    }
    onSubmit({
      title: prepared.value.title,
      description: prepared.value.description ?? '',
      categories: prepared.value.categories,
      goalId: prepared.value.goal_id ?? '',
      recurrenceType: prepared.value.recurrence_type,
      weekdays: prepared.value.weekdays ?? [],
      weekdayLabels: formLabels,
      scheduledTime: prepared.value.scheduled_time
        ? prepared.value.scheduled_time.slice(0, 5)
        : '',
      durationMinutes:
        prepared.value.duration_minutes != null
          ? String(prepared.value.duration_minutes)
          : '',
      timezone: prepared.value.timezone,
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
        <p className="eyebrow">{existing ? 'EDIT ROUTINE' : 'NEW ROUTINE'}</p>
        <h2>{existing ? 'Update this routine.' : 'What do you repeat?'}</h2>
        <p>
          Routines are private intention. Creating or archiving one does not award
          XP — logs still record what you actually did.
        </p>

        <label className="fieldLabel" htmlFor="routine-title">
          Name
        </label>
        <input
          id="routine-title"
          className="textInput"
          value={title}
          maxLength={PLANNING_TITLE_MAX_LENGTH}
          autoFocus
          placeholder="e.g. Morning lift"
          onChange={(event) => {
            setTitle(event.target.value);
            setError(null);
          }}
        />

        <label className="fieldLabel">
          Categories <span>1–3 areas this routine supports</span>
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

        <label className="fieldLabel" id="routine-recurrence-label">
          Recurrence
        </label>
        <div
          className={styles.recurrenceRow}
          role="group"
          aria-labelledby="routine-recurrence-label"
        >
          <button
            type="button"
            className={
              recurrenceType === 'daily'
                ? `${styles.choice} ${styles.choiceSelected}`
                : styles.choice
            }
            aria-pressed={recurrenceType === 'daily'}
            onClick={() => chooseRecurrence('daily')}
          >
            Daily
          </button>
          <button
            type="button"
            className={
              recurrenceType === 'weekly'
                ? `${styles.choice} ${styles.choiceSelected}`
                : styles.choice
            }
            aria-pressed={recurrenceType === 'weekly'}
            onClick={() => chooseRecurrence('weekly')}
          >
            Weekly
          </button>
        </div>

        {recurrenceType === 'weekly' && (
          <div className={styles.weekdayBlock}>
            <label className="fieldLabel" id="routine-weekdays-label">
              Weekdays <span>pick at least one</span>
            </label>
            <div
              className={styles.weekdayRow}
              role="group"
              aria-labelledby="routine-weekdays-label"
            >
              {PLANNING_ISO_WEEKDAYS.map((day) => {
                const isSelected = weekdays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    className={
                      isSelected
                        ? `${styles.choice} ${styles.choiceSelected}`
                        : styles.choice
                    }
                    aria-pressed={isSelected}
                    onClick={() => toggleWeekday(day)}
                  >
                    {WEEKDAY_LABELS[day]}
                  </button>
                );
              })}
            </div>

            {weekdays.length > 0 && (
              <>
                <button
                  type="button"
                  className={styles.advancedToggle}
                  aria-expanded={showDayLabels}
                  onClick={() => setShowDayLabels((open) => !open)}
                >
                  {showDayLabels
                    ? 'Hide day-specific actions'
                    : '+ Different action on some days?'}
                </button>
                {showDayLabels && (
                  <div className={styles.dayLabelBlock}>
                    <p className={styles.dayLabelHint}>
                      Optional. Leave blank to use the routine name on that day.
                    </p>
                    {weekdays.map((day) => (
                      <label
                        key={day}
                        className={styles.dayLabelRow}
                        htmlFor={`routine-day-label-${day}`}
                      >
                        <span>{WEEKDAY_FULL_LABELS[day]}</span>
                        <input
                          id={`routine-day-label-${day}`}
                          className="textInput"
                          value={weekdayLabels[day] ?? ''}
                          maxLength={PLANNING_TITLE_MAX_LENGTH}
                          placeholder={title.trim() || 'Same as routine name'}
                          onChange={(event) =>
                            setDayLabel(day, event.target.value)
                          }
                        />
                      </label>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <label className="fieldLabel" htmlFor="routine-goal">
          Linked goal <span>optional</span>
        </label>
        {linkableGoals.length === 0 ? (
          <p className={styles.emptyGoalHint} id="routine-goal">
            No active goals to link yet. You can still save this routine on its
            own.
          </p>
        ) : (
          <div className={styles.selectWrap}>
            <select
              id="routine-goal"
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

        <label className="fieldLabel" htmlFor="routine-description">
          Notes <span>optional</span>
        </label>
        <textarea
          id="routine-description"
          className="textArea"
          value={description}
          placeholder="When, where, or what good looks like."
          onChange={(event) => setDescription(event.target.value)}
        />

        <button
          type="button"
          className={styles.advancedToggle}
          aria-expanded={showAdvanced}
          onClick={() => setShowAdvanced((open) => !open)}
        >
          {showAdvanced ? 'Hide schedule details' : '+ Add schedule details'}
        </button>

        {showAdvanced && (
          <div className={styles.advancedBlock}>
            <div className={styles.timeLabelRow}>
              <label className="fieldLabel" id="routine-time-label">
                Usual time <span>optional</span>
              </label>
              {(timeHour || timeMinute) && (
                <button
                  type="button"
                  className={styles.clearTime}
                  onClick={clearUsualTime}
                >
                  Clear time
                </button>
              )}
            </div>
            <div
              className={`customTimePicker ${styles.timePicker}`}
              role="group"
              aria-labelledby="routine-time-label"
            >
              <select
                id="routine-time-hour"
                className={`textInput ${styles.timeSelect}`}
                value={timeHour}
                aria-label="Usual hour"
                onChange={(event) => setHour(event.target.value)}
              >
                <option value="">Hour</option>
                {HOUR_12_OPTIONS.map((hour) => (
                  <option key={hour} value={hour}>
                    {Number(hour)}
                  </option>
                ))}
              </select>
              <span className="timeSeparator" aria-hidden="true">
                :
              </span>
              <select
                id="routine-time-minute"
                className={`textInput ${styles.timeSelect}`}
                value={timeMinute}
                aria-label="Usual minute"
                onChange={(event) => setMinute(event.target.value)}
              >
                <option value="">Min</option>
                {MINUTE_OPTIONS.map((minute) => (
                  <option key={minute} value={minute}>
                    {minute}
                  </option>
                ))}
              </select>
              <div className="periodToggle" role="group" aria-label="AM or PM">
                <button
                  type="button"
                  className={timePeriod === 'AM' ? 'selected' : ''}
                  aria-pressed={timePeriod === 'AM'}
                  onClick={() => setPeriod('AM')}
                >
                  AM
                </button>
                <button
                  type="button"
                  className={timePeriod === 'PM' ? 'selected' : ''}
                  aria-pressed={timePeriod === 'PM'}
                  onClick={() => setPeriod('PM')}
                >
                  PM
                </button>
              </div>
            </div>

            <label className="fieldLabel" htmlFor="routine-duration">
              Duration (minutes) <span>optional</span>
            </label>
            <input
              id="routine-duration"
              className="textInput"
              inputMode="numeric"
              value={durationMinutes}
              placeholder="e.g. 45"
              onChange={(event) => {
                setDurationMinutes(event.target.value);
                setError(null);
              }}
            />

            <label className="fieldLabel" htmlFor="routine-timezone-filter">
              Timezone
            </label>
            <input
              id="routine-timezone-filter"
              className="textInput"
              value={timezoneQuery}
              placeholder="Search timezones"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setTimezoneQuery(event.target.value)}
            />
            <div className={styles.selectWrap}>
              <select
                id="routine-timezone"
                className={styles.formSelect}
                value={timezone}
                aria-label="Timezone"
                onChange={(event) => {
                  setTimezone(event.target.value);
                  setError(null);
                }}
              >
                {filteredTimezoneOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <p className={styles.timezoneHint}>
              Stored as an IANA timezone. Defaults to your current timezone.
            </p>
          </div>
        )}

        {error && <p className="composerFieldError">{error}</p>}

        <button
          className={`primaryButton submitLog ${styles.saveButton}`}
          type="button"
          disabled={busy}
          onClick={submit}
        >
          {busy ? 'Saving…' : existing ? 'Save routine' : 'Create routine'}
        </button>
      </div>
    </div>
  );
}
