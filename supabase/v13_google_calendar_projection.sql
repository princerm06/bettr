-- Phase 3 Google Calendar projection — connection + event-link contract.
-- Additive only. Do not apply to live Supabase until reviewed.
--
-- Outbound Calendar copy of Bettr planned_occurrences. Bettr remains
-- source of truth. Does not alter Goals, Routines, To-Dos, occurrences,
-- Logs, scoring, or RLS on existing planning tables.
--
-- Refresh-token ciphertext is server-only. Authenticated clients must
-- not be able to SELECT it.

create table if not exists public.google_calendar_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  sync_enabled boolean not null default false,
  google_sub text,
  google_email text,
  calendar_id text not null default 'primary',
  refresh_token_ciphertext text not null,
  granted_scopes text not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_reconcile_at timestamptz,
  last_error text
);

create table if not exists public.google_calendar_event_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  occurrence_id uuid not null,
  google_event_id text not null,
  calendar_id text not null default 'primary',
  sync_status text not null check (sync_status in ('upserted', 'deleted', 'error')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_calendar_event_links_occurrence_uidx unique (occurrence_id),
  constraint google_calendar_event_links_occurrence_owner_fk
    foreign key (occurrence_id, user_id)
    references public.planned_occurrences (id, user_id)
    on delete cascade
);

create index if not exists google_calendar_event_links_user_idx
  on public.google_calendar_event_links (user_id);

alter table public.google_calendar_connections enable row level security;
alter table public.google_calendar_event_links enable row level security;

revoke all on table public.google_calendar_connections from anon, authenticated, public;
revoke all on table public.google_calendar_event_links from anon, authenticated, public;

-- No GRANT to authenticated/anon. Service role bypasses RLS for server routes.
-- Defensive deny-all policies so a future grant cannot silently expose ciphertext.

drop policy if exists "google_calendar_connections_deny_all" on public.google_calendar_connections;
create policy "google_calendar_connections_deny_all"
  on public.google_calendar_connections
  for all
  to authenticated, anon
  using (false)
  with check (false);

drop policy if exists "google_calendar_event_links_deny_all" on public.google_calendar_event_links;
create policy "google_calendar_event_links_deny_all"
  on public.google_calendar_event_links
  for all
  to authenticated, anon
  using (false)
  with check (false);
