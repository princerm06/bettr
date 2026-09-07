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
