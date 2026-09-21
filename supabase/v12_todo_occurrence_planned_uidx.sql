-- Phase 3 Slice 6 — To-Do planned uniqueness + atomic reschedule.
-- Additive only. Do not apply to live Supabase until reviewed.
--
-- Replaces v10 planned_occurrences_todo_active_uidx (planned|completed|skipped)
-- with at most one status='planned' row per (user_id, todo_id).
-- Completed/skipped/rescheduled rows are historical and may coexist with a
-- new planned attempt.
--
-- Routine uniqueness is unchanged.
--
-- To-Do Move cannot INSERT a second planned row while the source is still
-- planned, and rescheduled_to_id must exist for the FK. The reschedule FK is
-- therefore DEFERRABLE, and planning_reschedule_occurrence runs source update
-- + replacement insert in one transaction.
--
-- Does not alter logs, scoring, Goals/Routines/To-Dos templates, or RLS.
-- Does not add skip-reason columns.

drop index if exists public.planned_occurrences_todo_active_uidx;

create unique index if not exists planned_occurrences_todo_planned_uidx
  on public.planned_occurrences (user_id, todo_id)
  where source_type = 'todo'
    and todo_id is not null
    and status = 'planned';

alter table public.planned_occurrences
  drop constraint if exists planned_occurrences_rescheduled_owner_fk;

alter table public.planned_occurrences
  add constraint planned_occurrences_rescheduled_owner_fk
    foreign key (rescheduled_to_id, user_id)
    references public.planned_occurrences (id, user_id)
    on delete restrict
    deferrable initially deferred;

create or replace function public.planning_reschedule_occurrence(
  p_occurrence_id uuid,
  p_replacement_id uuid,
  p_target_date date,
  p_target_time time,
  p_resolved_at timestamptz
)
returns json
language plpgsql
security invoker
set search_path = public
as $$
declare
  src public.planned_occurrences%rowtype;
  repl public.planned_occurrences%rowtype;
  owner uuid;
begin
  owner := auth.uid();
  if owner is null then
    raise exception 'Sign in to manage your plan.';
  end if;
  if p_occurrence_id is null or p_replacement_id is null then
    raise exception 'That planned item is not valid.';
  end if;
  if p_occurrence_id = p_replacement_id then
    raise exception 'That planned item is not valid.';
  end if;
  if p_target_date is null then
    raise exception 'Choose a date to move this to.';
  end if;

  select * into src
  from public.planned_occurrences
  where id = p_occurrence_id
    and user_id = owner
  for update;

  if not found then
    raise exception 'That planned item could not be found.';
  end if;

  if src.status = 'rescheduled' and src.rescheduled_to_id is not null then
    select * into repl
    from public.planned_occurrences
    where id = src.rescheduled_to_id
      and user_id = owner;
    return json_build_object(
      'noop', true,
      'source', row_to_json(src),
      'replacement', row_to_json(repl)
    );
  end if;

  if src.status <> 'planned' then
    raise exception 'Only a planned item can be skipped or moved.';
  end if;

  if src.source_type = 'routine' then
    if src.scheduled_date = p_target_date then
      raise exception 'Pick a different day for this routine.';
    end if;
    if exists (
      select 1
      from public.planned_occurrences
      where user_id = owner
        and source_type = 'routine'
        and routine_id = src.routine_id
        and scheduled_date = p_target_date
        and id <> src.id
    ) then
      raise exception 'That day already has this routine.';
    end if;
  end if;

  if src.source_type = 'todo' then
    if exists (
      select 1
      from public.planned_occurrences
      where user_id = owner
        and source_type = 'todo'
        and todo_id = src.todo_id
        and status = 'planned'
        and id <> src.id
    ) then
      raise exception 'This to-do already has a planned attempt.';
    end if;
  end if;

  update public.planned_occurrences
  set
    status = 'rescheduled',
    completion_mode = null,
    log_id = null,
    resolved_at = p_resolved_at,
    rescheduled_to_id = p_replacement_id,
    updated_at = p_resolved_at
  where id = src.id
    and user_id = owner;

  insert into public.planned_occurrences (
    id,
    user_id,
    source_type,
    routine_id,
    todo_id,
    scheduled_date,
    scheduled_time,
    timezone,
    duration_minutes,
    status,
    completion_mode,
    log_id,
    resolved_at,
    rescheduled_to_id
  ) values (
    p_replacement_id,
    owner,
    src.source_type,
    src.routine_id,
    src.todo_id,
    p_target_date,
    coalesce(p_target_time, src.scheduled_time),
    src.timezone,
    src.duration_minutes,
    'planned',
    null,
    null,
    null,
    null
  );

  select * into src
  from public.planned_occurrences
  where id = p_occurrence_id
    and user_id = owner;

  select * into repl
  from public.planned_occurrences
  where id = p_replacement_id
    and user_id = owner;

  return json_build_object(
    'noop', false,
    'source', row_to_json(src),
    'replacement', row_to_json(repl)
  );
end;
$$;

revoke all on function public.planning_reschedule_occurrence(uuid, uuid, date, time, timestamptz)
  from public;
grant execute on function public.planning_reschedule_occurrence(uuid, uuid, date, time, timestamptz)
  to authenticated;
