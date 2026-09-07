-- Himothy v5 logging migration: multi-category support.
-- Run once in the Supabase SQL Editor after the original schema.sql.

alter table public.logs
  add column if not exists categories text[];

update public.logs
set categories = array[category]
where categories is null or cardinality(categories) = 0;

alter table public.logs
  alter column categories set default '{}'::text[];

alter table public.logs
  drop constraint if exists logs_categories_valid;

alter table public.logs
  add constraint logs_categories_valid check (
    categories <@ array['appearance','fashion','academics','career','finance','nutrition','social','physical','mind','spirituality']::text[]
    and cardinality(categories) between 1 and 10
  );
