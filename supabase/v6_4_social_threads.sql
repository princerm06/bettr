-- Himothy v6.4 — Social Threads
alter table public.log_comments
  add column if not exists parent_comment_id uuid references public.log_comments(id) on delete cascade;

alter table public.log_comments
  add column if not exists image_path text;

alter table public.log_comments
  drop constraint if exists log_comments_body_check;

alter table public.log_comments
  alter column body drop not null;

alter table public.log_comments
  drop constraint if exists log_comments_content_check;

alter table public.log_comments
  add constraint log_comments_content_check
  check (
    (body is not null and char_length(trim(body)) between 1 and 500)
    or image_path is not null
  );

create index if not exists log_comments_parent_idx
  on public.log_comments(parent_comment_id, created_at);

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type in ('friend_request', 'comment', 'reply'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'comment-images',
  'comment-images',
  false,
  5242880,
  array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif'];

drop policy if exists "comment_images_insert_own" on storage.objects;
create policy "comment_images_insert_own"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'comment-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "comment_images_select_friend" on storage.objects;
create policy "comment_images_select_friend"
on storage.objects for select to authenticated
using (
  bucket_id = 'comment-images'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and (
          (f.requester_id = (select auth.uid()) and f.addressee_id::text = (storage.foldername(name))[1])
          or
          (f.addressee_id = (select auth.uid()) and f.requester_id::text = (storage.foldername(name))[1])
        )
    )
  )
);

drop policy if exists "comment_images_delete_own" on storage.objects;
create policy "comment_images_delete_own"
on storage.objects for delete to authenticated
using (
  bucket_id = 'comment-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

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
  select user_id into log_owner from public.logs where id = new.log_id;

  if new.parent_comment_id is not null then
    select user_id into parent_author
    from public.log_comments
    where id = new.parent_comment_id;

    if parent_author is not null and parent_author <> new.user_id then
      insert into public.notifications (user_id, actor_id, type, log_id)
      values (parent_author, new.user_id, 'reply', new.log_id);
    end if;

    if log_owner is not null
       and log_owner <> new.user_id
       and log_owner is distinct from parent_author then
      insert into public.notifications (user_id, actor_id, type, log_id)
      values (log_owner, new.user_id, 'comment', new.log_id);
    end if;

  elsif log_owner is not null and log_owner <> new.user_id then
    insert into public.notifications (user_id, actor_id, type, log_id)
    values (log_owner, new.user_id, 'comment', new.log_id);
  end if;

  return new;
end;
$$;

drop trigger if exists on_log_comment_notification on public.log_comments;

create trigger on_log_comment_notification
after insert on public.log_comments
for each row
execute function public.notify_log_comment();
