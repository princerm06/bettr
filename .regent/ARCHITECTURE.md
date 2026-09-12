# Architecture

Document the important systems, boundaries, and data flows Regent must preserve.

## Current architecture
- Web application with Supabase-backed authentication and persistent user data.
- Logs are the canonical record of actual completed developmental actions.
- Users create Logs that may belong to one or more self-improvement categories.
- Categories, priorities, scoring, XP/progress, profiles, and social features are separate concerns and should not be casually coupled.
- Phase 1 semantic analysis uses MiniLM embeddings plus Candidate 3A logistic probe with narrow 0.45/0.55 thresholds for conservative feedback.
- Semantic/ML output can suggest, classify, flag, or request clarification but is not the source of deterministic scoring.
- Phase 2 owns priority-weighted reward.
- user_priorities uses one row per user with priorities stored in jsonb; missing category keys are normalized in application code.
- The canonical production taxonomy currently contains 11 CategoryKeys, including `inner` for Inner Wellbeing.
- Existing History calendar is an actual-log/history surface, not a planner.
- There is currently no general planner reminder/cron/background scheduling system.
- There is currently no Google Calendar/OAuth integration.

## Phase 3 planning boundary
Phase 3 adds intention/planning around the existing action pipeline.

Plans represent intention.
Logs represent actual completed developmental actions.

Do not create a second action-history or reward system.

A planned item may later create or link to a normal Log, but that Log must continue through the existing Phase 1 semantic-validation and Phase 2 priority-weighted scoring pipeline.

Planning/adherence state does not directly award XP.

## Planned occurrence model
Initial persisted occurrence statuses:
- planned
- completed
- skipped
- rescheduled

Do not persist `unresolved`.

Unresolved is derived when:
- status = planned
- the expected local date/time has passed

Completion method is separate from status:

completion_mode:
- null
- light
- log

Expected meanings:
- planned: completion_mode=null, log_id=null, resolved_at=null
- lightweight completion: status=completed, completion_mode=light, log_id=null, resolved_at set
- Log-backed completion: status=completed, completion_mode=log, resolved_at set, log_id normally references logs.id
- skipped: status=skipped, completion_mode=null, log_id=null, resolved_at set
- rescheduled: status=rescheduled, completion_mode=null, log_id=null, resolved_at set, rescheduled_to_id references the replacement occurrence

Rescheduling preserves the original expectation and creates a new occurrence rather than mutating the historical scheduled date.

## Plan-to-Log relationship
The planned occurrence owns the optional Log reference.

Intended direction:
planned_occurrences.log_id -> logs.id

Do not add logs.planned_occurrence_id.

Do not introduce an M:N plan/Log linking table in Phase 3 v1.

Intended cardinality:
- one occurrence -> zero or one Log
- one Log -> zero or one occurrence

Non-null log_id should be unique.

Log deletion should use ON DELETE SET NULL so planning history remains meaningful.

A Log-backed completion whose Log is later deleted may remain:
- status=completed
- completion_mode=log
- log_id=null

Do not reinterpret it as lightweight completion.

## Planning object relationships
Initial first-class planning objects:
- goals
- routines
- todos
- planned_occurrences

A Routine may support zero or one Goal.
A To-Do may support zero or one Goal.
One Goal may have many Routines and To-Dos.

Do not introduce M:N Goal/Routine or Goal/To-Do relationship tables in the initial model.

A one-off planned developmental activity is modeled as a To-Do rather than a separate generic planner-action type.

## Categories
Phase 3 planning objects use the canonical 11 production CategoryKeys.

Goals, Routines, and To-Dos may use 1–3 categories.

Planning categories provide context only.
They do not automatically determine the categories of a future actual Log.

The resulting Log remains subject to the existing semantic/category pipeline.

## Privacy
Initial Phase 3 planning data is owner-only/private.

This includes:
- Goals
- Routines
- To-Dos
- planned occurrences
- unresolved/missed states
- check-in outcomes

Do not inherit friend-readable Log policies for planning data.

A private plan may later produce a friends-visible Log without exposing the private plan.

## Recurrence
Initial Routine recurrence is intentionally narrow:
- daily
- weekly

Weekly recurrence may support selected weekdays.

Do not build a general RRULE/cron/monthly recurrence engine in Slice 1.

Routine templates describe recurrence.
Persisted planned_occurrences should eventually use hybrid/lazy materialization for useful planning windows rather than pre-generating years of rows.

Routine edits must not rewrite historical expectations.

## Time model
Planning dates represent local human calendar intentions.

Intended occurrence fields:
- scheduled_date DATE
- scheduled_time TIME nullable
- timezone IANA timezone string

Do not model human scheduling intention primarily as a UTC timestamp.

Do not reuse existing UTC-based todayISO() behavior as the recurrence architecture.

A broad existing Log-date refactor is outside Slice 1.

## Architectural invariants
- Deterministic scoring/XP remains separate from ML confidence.
- Phase 1 owns actual Log semantic validity.
- Phase 2 owns priority-weighted reward.
- Goals, Routines, To-Dos, planner items, check-ins, and streaks do not directly award XP.
- Lightweight completion records adherence only.
- No planner, routine, goal, check-in, or streak XP multipliers.
- Phase 3 captures Discipline/Alignment signals but does not implement mature interpretation; that belongs to Phase 4.
- Category mismatch protection should remain conservative.
- Existing authenticated user data must remain isolated per user.
- Supabase access must respect row-level security and existing authorization boundaries.
- Planning RLS must be owner-only in v1.
- New features should prefer incremental extension over unnecessary rewrites.
- Do not move or rewrite frozen Phase 1/2 evaluation code to start Phase 3.
- Do not broadly refactor app/page.tsx merely to start Phase 3.
- New planning UI should eventually live in dedicated planning components/views.
- Google Calendar must remain a later adapter and must not shape the foundational schema.
- Existing logs.start_time / logs.duration_minutes migration-history drift is unrelated technical debt and must not be silently repaired inside Phase 3.
- Public-repository hygiene is mandatory.
