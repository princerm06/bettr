-- Himothy v6.2
-- Optional recovery/security email foundation.
-- Username + password remains the primary login.

alter table public.profiles
  add column if not exists recovery_email text;

alter table public.profiles
  add column if not exists recovery_email_verified boolean;

update public.profiles
set recovery_email_verified = false
where recovery_email_verified is null;

alter table public.profiles
  alter column recovery_email_verified set default false;

alter table public.profiles
  alter column recovery_email_verified set not null;

create unique index if not exists profiles_recovery_email_unique
  on public.profiles (lower(recovery_email))
  where recovery_email is not null;
