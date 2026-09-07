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
      select 1
      from public.profiles
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
