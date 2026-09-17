-- Phase 3 Slice 5 — Planned occurrence uniqueness for lazy Today materialization.
-- Additive only. Do not apply to live Supabase until reviewed.
--
-- Supports idempotent ensure-today inserts without unsafe fuzzy deduplication.
-- Does not alter logs, scoring, Goals/Routines/To-Dos templates, or RLS.

-- One routine expectation per local calendar date.
create unique index if not exists planned_occurrences_routine_date_uidx
  on public.planned_occurrences (user_id, routine_id, scheduled_date)
  where source_type = 'routine'
    and routine_id is not null;

-- At most one active (non-rescheduled) expectation per to-do.
-- Rescheduled rows are excluded so a replacement occurrence may exist later.
create unique index if not exists planned_occurrences_todo_active_uidx
  on public.planned_occurrences (user_id, todo_id)
  where source_type = 'todo'
    and todo_id is not null
    and status in ('planned', 'completed', 'skipped');
