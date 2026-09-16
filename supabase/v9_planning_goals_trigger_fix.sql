-- Phase 3 Slice 2 stabilization — Goal insert trigger fix.
-- Additive only. Do not apply to live Supabase until reviewed.
--
-- Root cause: planning_enforce_owner_integrity() is shared across goals,
-- routines, todos, and planned_occurrences, but references NEW.goal_id /
-- NEW.log_id / NEW.completion_mode. Those columns do not exist on public.goals,
-- so Goal INSERT fails with: record "new" has no field "goal_id".
--
-- Fix: resolve row fields through to_jsonb so the same function is safe on every
-- planning table. No schema/table changes. Owner-only RLS unchanged.
-- Does not award XP, touch logs scoring, or invoke semantic evaluation.

create or replace function public.planning_enforce_owner_integrity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  owner uuid;
  new_row jsonb := to_jsonb(new);
  old_row jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  new_goal_id uuid;
  new_log_id uuid;
begin
  if tg_op = 'UPDATE'
     and (new_row->>'user_id') is distinct from (old_row->>'user_id') then
    raise exception 'planning user_id is immutable';
  end if;

  if tg_table_name in ('routines', 'todos') then
    new_goal_id := nullif(new_row->>'goal_id', '')::uuid;
    if new_goal_id is not null then
      select user_id into owner from public.goals where id = new_goal_id;
      if owner is null or owner is distinct from (new_row->>'user_id')::uuid then
        raise exception 'planning goal must belong to the same owner';
      end if;
    end if;
  end if;

  if tg_table_name = 'planned_occurrences' then
    new_log_id := nullif(new_row->>'log_id', '')::uuid;
    if new_log_id is not null then
      select user_id into owner from public.logs where id = new_log_id;
      if owner is null or owner is distinct from (new_row->>'user_id')::uuid then
        raise exception 'planning log_id must belong to the same owner';
      end if;
    end if;

    if tg_op = 'UPDATE'
       and (old_row->>'completion_mode') = 'log'
       and (new_row->>'completion_mode') is distinct from 'log' then
      raise exception 'log-backed completion cannot be reinterpreted';
    end if;

    -- New rows and transitions INTO completed/log need a real Log.
    -- Remaining completed/log after ON DELETE SET NULL may keep log_id null.
    if (new_row->>'status') = 'completed'
       and (new_row->>'completion_mode') = 'log' then
      if tg_op = 'INSERT'
         or (old_row->>'status') is distinct from 'completed'
         or (old_row->>'completion_mode') is distinct from 'log' then
        if new_log_id is null then
          raise exception 'log-backed completion requires a log_id';
        end if;
      end if;
    end if;
  end if;

  return new;
end;
$$;
