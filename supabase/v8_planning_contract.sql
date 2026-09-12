-- Phase 3 Slice 1 — Planning contract + minimum data model.
-- Additive only. Do not apply to live Supabase until constraints, RLS,
-- foreign keys, and deletion behavior receive independent review.
--
-- Intention only: Goals / Routines / To-Dos / planned_occurrences.
-- Does not award XP or change Log scoring or the existing Log table.

-- Persist only planned/completed/skipped/rescheduled. Unresolved is derived, not stored.
-- Do not persist unresolved.

-- Log-backed completion lifecycle:
-- - INSERT or transition INTO completed/log requires a non-null log_id.
-- - A persisted completed/log row may keep log_id null after ON DELETE SET NULL.
-- - Do not rewrite completed/log to light, and do not remove ON DELETE SET NULL.

create or replace function public.planning_array_is_unique(input_values anyarray)
returns boolean
language sql
immutable
as $$
  select input_values is null
    or cardinality(input_values) = (select count(distinct element) from unnest(input_values) as element);
$$;

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 200),
  description text,
  categories text[] not null,
  target_date date,
  status text not null default 'active' check (status in ('active', 'completed', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goals_categories_valid check (
    cardinality(categories) between 1 and 3
    and public.planning_array_is_unique(categories)
    and categories <@ array[
      'appearance',
      'fashion',
      'academics',
      'career',
      'finance',
      'nutrition',
      'social',
      'physical',
      'mind',
      'inner',
      'spirituality'
    ]::text[]
  )
);

create table if not exists public.routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 200),
  description text,
  categories text[] not null,
  goal_id uuid references public.goals(id) on delete set null,
  recurrence_type text not null check (recurrence_type in ('daily', 'weekly')),
  weekdays smallint[],
  scheduled_time time,
  duration_minutes integer check (duration_minutes is null or duration_minutes > 0),
  timezone text not null check (
    timezone = trim(timezone)
    and char_length(timezone) between 1 and 64
  ),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint routines_id_user_key unique (id, user_id),
  constraint routines_categories_valid check (
    cardinality(categories) between 1 and 3
    and public.planning_array_is_unique(categories)
    and categories <@ array[
      'appearance',
      'fashion',
      'academics',
      'career',
      'finance',
      'nutrition',
      'social',
      'physical',
      'mind',
      'inner',
      'spirituality'
    ]::text[]
  ),
  constraint routines_recurrence_integrity check (
    (
      recurrence_type = 'daily'
      and weekdays is null
    )
    or (
      recurrence_type = 'weekly'
      and weekdays is not null
      and cardinality(weekdays) between 1 and 7
      and public.planning_array_is_unique(weekdays)
      and weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
    )
  )
);

create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 200),
  description text,
  categories text[] not null,
  goal_id uuid references public.goals(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint todos_id_user_key unique (id, user_id),
  constraint todos_categories_valid check (
    cardinality(categories) between 1 and 3
    and public.planning_array_is_unique(categories)
    and categories <@ array[
      'appearance',
      'fashion',
      'academics',
      'career',
      'finance',
      'nutrition',
      'social',
      'physical',
      'mind',
      'inner',
      'spirituality'
    ]::text[]
  )
);

create table if not exists public.planned_occurrences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null check (source_type in ('routine', 'todo')),
  routine_id uuid,
  todo_id uuid,
  scheduled_date date not null,
  scheduled_time time,
  timezone text not null check (
    timezone = trim(timezone)
    and char_length(timezone) between 1 and 64
  ),
  duration_minutes integer check (duration_minutes is null or duration_minutes > 0),
  status text not null check (status in ('planned', 'completed', 'skipped', 'rescheduled')),
  completion_mode text check (completion_mode in ('light', 'log')),
  log_id uuid unique references public.logs(id) on delete set null,
  resolved_at timestamptz,
  rescheduled_to_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint planned_occurrences_id_user_key unique (id, user_id),
  constraint planned_occurrences_source_integrity check (
    (
      source_type = 'routine'
      and routine_id is not null
      and todo_id is null
    )
    or (
      source_type = 'todo'
      and todo_id is not null
      and routine_id is null
    )
  ),
  -- Row CHECK permits preserved completed/log after Log deletion (log_id null).
  -- INSERT/UPDATE transition logic below rejects fabricating that state.
  constraint planned_occurrences_state_integrity check (
    (
      status = 'planned'
      and completion_mode is null
      and log_id is null
      and resolved_at is null
      and rescheduled_to_id is null
    )
    or (
      status = 'completed'
      and completion_mode = 'light'
      and log_id is null
      and resolved_at is not null
      and rescheduled_to_id is null
    )
    or (
      status = 'completed'
      and completion_mode = 'log'
      and resolved_at is not null
      and rescheduled_to_id is null
    )
    or (
      status = 'skipped'
      and completion_mode is null
      and log_id is null
      and resolved_at is not null
      and rescheduled_to_id is null
    )
    or (
      status = 'rescheduled'
      and completion_mode is null
      and log_id is null
      and resolved_at is not null
      and rescheduled_to_id is not null
    )
  ),
  constraint planned_occurrences_reschedule_not_self check (
    rescheduled_to_id is null or rescheduled_to_id <> id
  ),
  constraint planned_occurrences_routine_owner_fk
    foreign key (routine_id, user_id)
    references public.routines (id, user_id)
    on delete restrict,
  constraint planned_occurrences_todo_owner_fk
    foreign key (todo_id, user_id)
    references public.todos (id, user_id)
    on delete restrict,
  constraint planned_occurrences_rescheduled_owner_fk
    foreign key (rescheduled_to_id, user_id)
    references public.planned_occurrences (id, user_id)
    on delete restrict
);

create index if not exists goals_user_idx on public.goals (user_id);
create index if not exists routines_user_idx on public.routines (user_id);
create index if not exists routines_goal_idx on public.routines (goal_id);
create index if not exists todos_user_idx on public.todos (user_id);
create index if not exists todos_goal_idx on public.todos (goal_id);
create index if not exists planned_occurrences_user_date_idx
  on public.planned_occurrences (user_id, scheduled_date);
create index if not exists planned_occurrences_routine_idx
  on public.planned_occurrences (routine_id);
create index if not exists planned_occurrences_todo_idx
  on public.planned_occurrences (todo_id);
create index if not exists planned_occurrences_rescheduled_to_idx
  on public.planned_occurrences (rescheduled_to_id);

create or replace function public.planning_enforce_owner_integrity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  owner uuid;
begin
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'planning user_id is immutable';
  end if;

  if tg_table_name in ('routines', 'todos') and new.goal_id is not null then
    select user_id into owner from public.goals where id = new.goal_id;
    if owner is null or owner is distinct from new.user_id then
      raise exception 'planning goal must belong to the same owner';
    end if;
  end if;

  if tg_table_name = 'planned_occurrences' then
    if new.log_id is not null then
      select user_id into owner from public.logs where id = new.log_id;
      if owner is null or owner is distinct from new.user_id then
        raise exception 'planning log_id must belong to the same owner';
      end if;
    end if;

    if tg_op = 'UPDATE'
       and old.completion_mode = 'log'
       and new.completion_mode is distinct from 'log' then
      raise exception 'log-backed completion cannot be reinterpreted';
    end if;

    -- New rows and transitions INTO completed/log need a real Log.
    -- Remaining completed/log after ON DELETE SET NULL may keep log_id null.
    if new.status = 'completed' and new.completion_mode = 'log' then
      if tg_op = 'INSERT'
         or old.status is distinct from 'completed'
         or old.completion_mode is distinct from 'log' then
        if new.log_id is null then
          raise exception 'log-backed completion requires a log_id';
        end if;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists goals_owner_integrity on public.goals;
create trigger goals_owner_integrity
before insert or update on public.goals
for each row execute function public.planning_enforce_owner_integrity();

drop trigger if exists routines_owner_integrity on public.routines;
create trigger routines_owner_integrity
before insert or update on public.routines
for each row execute function public.planning_enforce_owner_integrity();

drop trigger if exists todos_owner_integrity on public.todos;
create trigger todos_owner_integrity
before insert or update on public.todos
for each row execute function public.planning_enforce_owner_integrity();

drop trigger if exists planned_occurrences_owner_integrity on public.planned_occurrences;
create trigger planned_occurrences_owner_integrity
before insert or update on public.planned_occurrences
for each row execute function public.planning_enforce_owner_integrity();

alter table public.goals enable row level security;
alter table public.routines enable row level security;
alter table public.todos enable row level security;
alter table public.planned_occurrences enable row level security;

revoke all on table public.goals from anon, authenticated;
revoke all on table public.routines from anon, authenticated;
revoke all on table public.todos from anon, authenticated;
revoke all on table public.planned_occurrences from anon, authenticated;

grant select, insert, update, delete on table public.goals to authenticated;
grant select, insert, update, delete on table public.routines to authenticated;
grant select, insert, update, delete on table public.todos to authenticated;
grant select, insert, update, delete on table public.planned_occurrences to authenticated;

drop policy if exists "goals_select_own" on public.goals;
create policy "goals_select_own" on public.goals for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "goals_insert_own" on public.goals;
create policy "goals_insert_own" on public.goals for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "goals_update_own" on public.goals;
create policy "goals_update_own" on public.goals for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "goals_delete_own" on public.goals;
create policy "goals_delete_own" on public.goals for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "routines_select_own" on public.routines;
create policy "routines_select_own" on public.routines for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "routines_insert_own" on public.routines;
create policy "routines_insert_own" on public.routines for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "routines_update_own" on public.routines;
create policy "routines_update_own" on public.routines for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "routines_delete_own" on public.routines;
create policy "routines_delete_own" on public.routines for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "todos_select_own" on public.todos;
create policy "todos_select_own" on public.todos for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "todos_insert_own" on public.todos;
create policy "todos_insert_own" on public.todos for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "todos_update_own" on public.todos;
create policy "todos_update_own" on public.todos for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "todos_delete_own" on public.todos;
create policy "todos_delete_own" on public.todos for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "planned_occurrences_select_own" on public.planned_occurrences;
create policy "planned_occurrences_select_own" on public.planned_occurrences for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "planned_occurrences_insert_own" on public.planned_occurrences;
create policy "planned_occurrences_insert_own" on public.planned_occurrences for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "planned_occurrences_update_own" on public.planned_occurrences;
create policy "planned_occurrences_update_own" on public.planned_occurrences for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "planned_occurrences_delete_own" on public.planned_occurrences;
create policy "planned_occurrences_delete_own" on public.planned_occurrences for delete to authenticated
  using ((select auth.uid()) = user_id);
