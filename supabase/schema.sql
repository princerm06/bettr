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
-- Himothy v6 social foundation

alter table public.logs
  add column if not exists visibility text not null default 'friends'
  check (visibility in ('friends','private'));

create index if not exists logs_social_feed_idx on public.logs(visibility, created_at desc);
create index if not exists friendships_requester_idx on public.friendships(requester_id, status);
create index if not exists friendships_addressee_idx on public.friendships(addressee_id, status);

create table if not exists public.log_reactions (
  id uuid primary key default gen_random_uuid(),
  log_id uuid not null references public.logs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction text not null check (reaction in ('🔥','W','💪')),
  created_at timestamptz not null default now(),
  unique(log_id, user_id, reaction)
);

create table if not exists public.log_comments (
  id uuid primary key default gen_random_uuid(),
  log_id uuid not null references public.logs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists log_reactions_log_idx on public.log_reactions(log_id, created_at);
create index if not exists log_comments_log_idx on public.log_comments(log_id, created_at);

alter table public.log_reactions enable row level security;
alter table public.log_comments enable row level security;
revoke all on table public.log_reactions from anon, authenticated;
revoke all on table public.log_comments from anon, authenticated;
grant select, insert, delete on table public.log_reactions to authenticated;
grant select, insert, delete on table public.log_comments to authenticated;

-- Profiles are intentionally lightweight social discovery records.
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated" on public.profiles for select to authenticated using (true);

-- A friend can read only logs explicitly shared with friends.
drop policy if exists "logs_select_own" on public.logs;
drop policy if exists "logs_select_own_or_friend" on public.logs;
create policy "logs_select_own_or_friend" on public.logs for select to authenticated
using (
  (select auth.uid()) = user_id
  or (
    visibility = 'friends'
    and exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.requester_id = (select auth.uid()) and f.addressee_id = logs.user_id)
          or (f.addressee_id = (select auth.uid()) and f.requester_id = logs.user_id))
    )
  )
);

-- Only the recipient may accept a pending request. Either side may delete it.
drop policy if exists "friendships_update_involved" on public.friendships;
drop policy if exists "friendships_update_addressee" on public.friendships;
create policy "friendships_update_addressee" on public.friendships for update to authenticated
  using ((select auth.uid()) = addressee_id)
  with check ((select auth.uid()) = addressee_id and status in ('accepted','blocked'));

-- Reactions/comments are visible and writable only when the underlying log is visible.
drop policy if exists "reactions_select_visible_log" on public.log_reactions;
create policy "reactions_select_visible_log" on public.log_reactions for select to authenticated
using (exists (select 1 from public.logs l where l.id = log_reactions.log_id));
drop policy if exists "reactions_insert_self_visible_log" on public.log_reactions;
create policy "reactions_insert_self_visible_log" on public.log_reactions for insert to authenticated
with check ((select auth.uid()) = user_id and exists (select 1 from public.logs l where l.id = log_reactions.log_id));
drop policy if exists "reactions_delete_self" on public.log_reactions;
create policy "reactions_delete_self" on public.log_reactions for delete to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "comments_select_visible_log" on public.log_comments;
create policy "comments_select_visible_log" on public.log_comments for select to authenticated
using (exists (select 1 from public.logs l where l.id = log_comments.log_id));
drop policy if exists "comments_insert_self_visible_log" on public.log_comments;
create policy "comments_insert_self_visible_log" on public.log_comments for insert to authenticated
with check ((select auth.uid()) = user_id and exists (select 1 from public.logs l where l.id = log_comments.log_id));
drop policy if exists "comments_delete_self" on public.log_comments;
create policy "comments_delete_self" on public.log_comments for delete to authenticated
using ((select auth.uid()) = user_id);

-- Friend-visible private-bucket images: the first path segment is the log owner's user id.
drop policy if exists "log_images_select_own" on storage.objects;
drop policy if exists "log_images_select_own_or_friend" on storage.objects;
create policy "log_images_select_own_or_friend" on storage.objects for select to authenticated
using (
  bucket_id = 'log-images'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.requester_id = (select auth.uid()) and f.addressee_id::text = (storage.foldername(name))[1])
          or (f.addressee_id = (select auth.uid()) and f.requester_id::text = (storage.foldername(name))[1]))
    )
  )
);

-- Himothy v6 onboarding: unique usernames at account creation
alter table public.profiles
  drop constraint if exists profiles_username_format;
alter table public.profiles
  add constraint profiles_username_format check (
    username is null
    or (
      char_length(username) between 3 and 30
      and username = lower(username)
      and username ~ '^[a-z0-9_][a-z0-9_.]{1,28}[a-z0-9_]$'
    )
  );

create or replace function public.username_available(candidate text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    candidate is not null
    and char_length(trim(candidate)) between 3 and 30
    and lower(trim(candidate)) ~ '^[a-z0-9_][a-z0-9_.]{1,28}[a-z0-9_]$'
    and not exists (
      select 1 from public.profiles
      where username = lower(trim(candidate))
    );
$$;
revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, username)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1)),
    lower(nullif(trim(new.raw_user_meta_data ->> 'username'), ''))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
