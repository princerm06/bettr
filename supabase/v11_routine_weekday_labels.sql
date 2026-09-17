-- Phase 3 Slice 5 revision — Optional per-weekday action labels on weekly Routines.
-- Additive only. Do not apply to live Supabase until reviewed.
--
-- Weekly Routines may share one title across days, or optionally label what
-- happens on each selected weekday (e.g. Lifting Split → Wed = Legs & Abs).
-- Existing Routines without weekday_labels continue unchanged (NULL).
-- Does not alter logs, scoring, planned_occurrences uniqueness, or RLS.

alter table public.routines
  add column if not exists weekday_labels jsonb;

comment on column public.routines.weekday_labels is
  'Optional weekly per-ISO-weekday action labels. Object keys are weekday ints as text (1-7); values are non-empty trimmed labels. NULL means fall back to routine title.';

-- Integrity: daily routines must not store labels; weekly labels (when present)
-- must be a JSON object whose keys are a subset of selected weekdays.
alter table public.routines
  drop constraint if exists routines_weekday_labels_integrity;

alter table public.routines
  add constraint routines_weekday_labels_integrity check (
    weekday_labels is null
    or (
      recurrence_type = 'weekly'
      and weekdays is not null
      and jsonb_typeof(weekday_labels) = 'object'
      and weekday_labels <> '{}'::jsonb
      and not exists (
        select 1
        from jsonb_each_text(weekday_labels) as entry(key, value)
        where
          key !~ '^[1-7]$'
          or not (key::smallint = any (weekdays))
          or char_length(trim(value)) < 1
          or char_length(trim(value)) > 200
          or value <> trim(value)
      )
    )
  );
