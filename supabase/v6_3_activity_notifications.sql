-- Himothy v6.3
-- Activity notifications for friend requests and comments.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete cascade,
  type text not null check (type in ('friend_request', 'comment')),
  log_id uuid references public.logs(id) on delete cascade,
  friendship_id uuid references public.friendships(id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_idx
  on public.notifications(user_id, created_at desc);

create index if not exists notifications_user_unread_idx
  on public.notifications(user_id, read_at);

alter table public.notifications enable row level security;

revoke all on table public.notifications from anon, authenticated;

grant select, update on table public.notifications to authenticated;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own"
on public.notifications
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own"
on public.notifications
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- Friend request notification
create or replace function public.notify_friend_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'pending' then
    insert into public.notifications (
      user_id,
      actor_id,
      type,
      friendship_id
    )
    values (
      new.addressee_id,
      new.requester_id,
      'friend_request',
      new.id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists on_friend_request_notification
on public.friendships;

create trigger on_friend_request_notification
after insert on public.friendships
for each row
execute function public.notify_friend_request();

-- Comment notification
create or replace function public.notify_log_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  log_owner uuid;
begin
  select user_id
  into log_owner
  from public.logs
  where id = new.log_id;

  if log_owner is not null and log_owner <> new.user_id then
    insert into public.notifications (
      user_id,
      actor_id,
      type,
      log_id
    )
    values (
      log_owner,
      new.user_id,
      'comment',
      new.log_id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists on_log_comment_notification
on public.log_comments;

create trigger on_log_comment_notification
after insert on public.log_comments
for each row
execute function public.notify_log_comment();
