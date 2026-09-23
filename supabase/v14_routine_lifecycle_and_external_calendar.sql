-- Phase 3 Slice 3.4.2 — Routine lifecycle + provider-neutral external calendar.
-- Additive. Do not apply to live Supabase until reviewed.
--
-- 1. external_calendar_enabled: Routine preference, default true so existing
--    timed Routines keep projecting when global Calendar sync is on.
-- 2. deleted_at: tombstone for permanent library removal. planned_occurrences
--    reference routines ON DELETE RESTRICT, so a literal DELETE would be
--    blocked or would require destroying history. Tombstone preserves Logs,
--    XP, completed/skipped/rescheduled rows, and titles for history joins.
-- 3. Routine uniqueness becomes planned-only so archive→skip does not block
--    restore rematerialization of the same civil date.
--
-- Does not alter Logs, scoring, Discipline, or RLS.

alter table public.routines
  add column if not exists external_calendar_enabled boolean not null default true;

alter table public.routines
  add column if not exists deleted_at timestamptz;

comment on column public.routines.external_calendar_enabled is
  'Provider-neutral. When false, this routine is not copied to a connected external calendar.';

comment on column public.routines.deleted_at is
  'Tombstone for permanent removal from the Routine library. History rows remain.';

drop index if exists public.planned_occurrences_routine_date_uidx;

create unique index if not exists planned_occurrences_routine_date_planned_uidx
  on public.planned_occurrences (user_id, routine_id, scheduled_date)
  where source_type = 'routine'
    and routine_id is not null
    and status = 'planned';
