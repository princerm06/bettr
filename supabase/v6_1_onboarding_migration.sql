-- Himothy v6.1 onboarding
-- Safe to run once in Supabase SQL Editor before deploying the onboarding UI.

alter table public.profiles
  add column if not exists onboarding_completed boolean;

-- Rows that existed before this feature have NULL and should not be forced
-- through first-time onboarding. New accounts default to false.
update public.profiles
set onboarding_completed = true
where onboarding_completed is null;

alter table public.profiles
  alter column onboarding_completed set default false;

alter table public.profiles
  alter column onboarding_completed set not null;
