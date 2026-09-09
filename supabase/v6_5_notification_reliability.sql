-- Himothy v6.5
-- Reliable notification targeting, friend-accept notifications,
-- and comment moderation by log owners.

alter table public.notifications
  add column if not exists comment_id uuid
  references public.log_comments(id) on delete set null;

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (
    type in (
      'friend_request',
      'friend_accept',
      'comment',
      'reply'
    )
  );

create index if not exists notifications_comment_idx
  on public.notifications(comment_id);


-- Reliable comment/reply notifications with exact target comment.
create or replace function public.notify_log_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  log_owner uuid;
  parent_author uuid;
begin
  select user_id
  into log_owner
  from public.logs
  where id = new.log_id;

  if new.parent_comment_id is not null then

    select user_id
    into parent_author
    from public.log_comments
    where id = new.parent_comment_id;

    -- Notify the person being replied to.
    if parent_author is not null
       and parent_author <> new.user_id then

      insert into public.notifications (
        user_id,
        actor_id,
        type,
        log_id,
        comment_id
      )
      values (
        parent_author,
        new.user_id,
        'reply',
        new.log_id,
        new.id
      );

    end if;

    -- If the log owner is a different person from both participants,
    -- also tell them there was activity on their post.
    if log_owner is not null
       and log_owner <> new.user_id
       and log_owner is distinct from parent_author then

      insert into public.notifications (
        user_id,
        actor_id,
        type,
        log_id,
        comment_id
      )
      values (
        log_owner,
        new.user_id,
        'comment',
        new.log_id,
        new.id
      );

    end if;

  elsif log_owner is not null
        and log_owner <> new.user_id then

    insert into public.notifications (
      user_id,
      actor_id,
      type,
      log_id,
      comment_id
    )
    values (
      log_owner,
      new.user_id,
      'comment',
      new.log_id,
      new.id
    );

  end if;

  return new;
end;
$$;


-- Notify the original requester when their request is accepted.
create or replace function public.notify_friend_accept()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'pending'
     and new.status = 'accepted' then

    insert into public.notifications (
      user_id,
      actor_id,
      type,
      friendship_id
    )
    values (
      new.requester_id,
      new.addressee_id,
      'friend_accept',
      new.id
    );

  end if;

  return new;
end;
$$;

drop trigger if exists on_friend_accept_notification
on public.friendships;

create trigger on_friend_accept_notification
after update on public.friendships
for each row
execute function public.notify_friend_accept();


-- Comment authors may delete their own comments.
-- Log owners may moderate comments/replies on their own posts.
grant delete on public.log_comments to authenticated;

drop policy if exists "log_comments_delete_author_or_log_owner"
on public.log_comments;

create policy "log_comments_delete_author_or_log_owner"
on public.log_comments
for delete
to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1
    from public.logs l
    where l.id = log_comments.log_id
      and l.user_id = (select auth.uid())
  )
);
