-- Additive: accept production CategoryKey `inner` (Inner Wellbeing).
-- Does not rewrite historical rows or reassign Mind logs.

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.logs'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%appearance%fashion%academics%career%finance%nutrition%social%physical%mind%spirituality%'
  loop
    execute format('alter table public.logs drop constraint if exists %I', constraint_name);
  end loop;
end $$;

alter table public.logs
  add constraint logs_category_valid check (
    category in (
      'appearance',
      'fashion',
      'academics',
      'career',
      'finance',
      'nutrition',
      'social',
      'physical',
      'mind',
      'inner',
      'spirituality'
    )
  );

alter table public.logs
  add constraint logs_categories_valid check (
    categories <@ array[
      'appearance',
      'fashion',
      'academics',
      'career',
      'finance',
      'nutrition',
      'social',
      'physical',
      'mind',
      'inner',
      'spirituality'
    ]::text[]
    and cardinality(categories) between 1 and 11
  );
