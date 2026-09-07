-- Himothy cloud schema (run once in Supabase SQL Editor)

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  username text unique,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.logs (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('appearance','fashion','academics','career','finance','nutrition','social','physical','mind','spirituality')),
  categories text[] not null check (categories <@ array['appearance','fashion','academics','career','finance','nutrition','social','physical','mind','spirituality']::text[] and cardinality(categories) between 1 and 10),
  activity text not null,
  details text,
  log_date date not null default current_date,
  created_at timestamptz not null default now(),
  points integer not null default 5 check (points between 0 and 100),
  image_path text,
  ai_insight text,
  custom boolean not null default false
);

create index if not exists logs_user_date_idx on public.logs(user_id, log_date desc);

create table if not exists public.user_priorities (
  user_id uuid primary key references auth.users(id) on delete cascade,
  priorities jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> addressee_id),
  unique(requester_id, addressee_id)
);

alter table public.profiles enable row level security;
alter table public.logs enable row level security;
alter table public.user_priorities enable row level security;
alter table public.friendships enable row level security;

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.logs from anon, authenticated;
revoke all on table public.user_priorities from anon, authenticated;
revoke all on table public.friendships from anon, authenticated;

grant select, insert, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.logs to authenticated;
grant select, insert, update, delete on table public.user_priorities to authenticated;
grant select, insert, update, delete on table public.friendships to authenticated;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select to authenticated
  using ((select auth.uid()) = id);
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists "logs_select_own" on public.logs;
create policy "logs_select_own" on public.logs for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "logs_insert_own" on public.logs;
create policy "logs_insert_own" on public.logs for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "logs_update_own" on public.logs;
create policy "logs_update_own" on public.logs for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "logs_delete_own" on public.logs;
create policy "logs_delete_own" on public.logs for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "priorities_select_own" on public.user_priorities;
create policy "priorities_select_own" on public.user_priorities for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "priorities_insert_own" on public.user_priorities;
create policy "priorities_insert_own" on public.user_priorities for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "priorities_update_own" on public.user_priorities;
create policy "priorities_update_own" on public.user_priorities for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "priorities_delete_own" on public.user_priorities;
create policy "priorities_delete_own" on public.user_priorities for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Friendships are scaffolded now; friend-profile/log visibility will be enabled in the next build.
drop policy if exists "friendships_select_involved" on public.friendships;
create policy "friendships_select_involved" on public.friendships for select to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));
drop policy if exists "friendships_insert_requester" on public.friendships;
create policy "friendships_insert_requester" on public.friendships for insert to authenticated
  with check ((select auth.uid()) = requester_id);
drop policy if exists "friendships_update_involved" on public.friendships;
create policy "friendships_update_involved" on public.friendships for update to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));
drop policy if exists "friendships_delete_involved" on public.friendships;
create policy "friendships_delete_involved" on public.friendships for delete to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));

insert into storage.buckets (id, name, public)
values ('log-images', 'log-images', false)
on conflict (id) do update set public = false;

-- Private object policy: each user's files live under <user-id>/...
drop policy if exists "log_images_select_own" on storage.objects;
create policy "log_images_select_own" on storage.objects for select to authenticated
  using (bucket_id = 'log-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "log_images_insert_own" on storage.objects;
create policy "log_images_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'log-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "log_images_delete_own" on storage.objects;
create policy "log_images_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'log-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
