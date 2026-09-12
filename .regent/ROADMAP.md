# Roadmap

Current milestones and near-term priorities.

## Completed / frozen
- Phase 0: Stabilization and mobile fixes.
- Phase 1: Semantic log feedback.
- Phase 2: Meaningful priorities / discipline foundation.
- Pre-Phase-3 taxonomy cleanup: Inner Wellbeing added as the 11th production category and verified against the live database/application.

Completed phases should not be casually redesigned while implementing later work.

## Current checkpoint
Phase 3 architecture/data-model contract is locked, but Phase 3 implementation has not yet started.

Completed:
- Phase 3 Slice 0 repository/architecture audit.
- Phase 3 Slice 1 contract and minimum data-model design.

Not yet implemented:
- goals table
- routines table
- todos table
- planned_occurrences table
- planning RLS
- lib/planning/
- Phase 3 planning UI
- recurrence materialization
- accountability/reconciliation UI
- Google Calendar integration

## Now
Phase 3 Slice 1 — Planning Contract + Minimum Data Mode

Immediate implementation scope:
1. Add a dedicated planning domain boundary under lib/planning/ or equivalent.
2. Add planning types and state/invariant helpers.
3. Create a new additive Supabase migration after v7.
4. Add private owner-only goals, routines, todos, and planned_occurrences tables.
5. Add canonical category, occurrence-state, completion-mode, source-integrity, and Log-link constraints.
6. Add conservative FK/delete behavior and owner-only RLS.
7. Add focused planning-domain/schema checks.
8. Run the relevant frozen Phase 1/2/category regression suite and build.
9. Do not build Phase 3 UI in this slice.
10. Do not apply the Phase 3 migration to live Supabase until its SQL constraints and deletion behavior receive independent review.

## Known technical debt
The application uses logs.start_time and logs.duration_minutes, but checked-in Supabase migration history does not define those columns. Do not silently repair this unrelated schema drift as part of Phase 3 unless explicitly required.

## Deferred verification debt
Existing Phase 0 dual-account/realtime verification debt remains separate from Phase 3 unless work directly touches friendship, visibility, realtime, notification, or multi-account systems.
