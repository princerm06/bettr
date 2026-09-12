# Decisions

Durable technical/product decisions Regent should preserve.

## Semantic validation
- Decision: Phase 1 uses MiniLM embeddings with Candidate 3A logistic probe and narrow 0.45/0.55 thresholds.
- Reason: Conservative semantic assistance is preferred over confident false positives.
- Rejected alternatives: Broad ML authority over scoring.
- Revisit when: Evaluation data shows a clearly safer/better semantic approach.

## Scoring boundary
- Decision: Deterministic scoring and XP remain separate from ML output.
- Reason: Progress should be explainable, stable, and not depend on probabilistic model behavior.
- Rejected alternatives: Letting the classifier directly decide XP.
- Revisit when: Only with an explicit product/architecture decision.

## Product complexity
- Decision: Use progressive disclosure and beginner simplicity.
- Reason: Bettr should become powerful without overwhelming new users.
- Rejected alternatives: Exposing the full planning/analytics system immediately.
- Revisit when: User testing demonstrates a better interaction model.

## Repository
- Decision: Treat the repository as public.
- Reason: The Bettr GitHub repository is public.
- Rejected alternatives: Depending on secrecy for safe configuration.
- Revisit when: Never for credential handling; secrets remain external.

## Phase 3 — Intention vs. actual
- Decision: Phase 3 planning objects represent intention; Logs remain the canonical record of actual completed developmental actions.
- Reason: Bettr should have one progression/action history rather than parallel planning and action systems.
- Rejected alternatives: Treating planner completion as a second canonical action history.
- Revisit when: Only through an explicit architecture/product decision.

## Phase 3 — Progression boundary
- Decision: Goals, Routines, To-Dos, planned occurrences, check-ins, and streaks do not directly award XP.
- Reason: Actual progression remains governed by the existing Phase 1 semantic-validation and Phase 2 deterministic priority-weighted reward pipeline.
- Rejected alternatives: Goal, routine, planner, check-in, or streak XP multipliers.
- Revisit when: Only through an explicit scoring-system redesign.

## Phase 3 — Lightweight completion
- Decision: Planned actions may be completed lightly without creating a Log.
- Reason: Adherence and progression credit are different concepts; simple/repetitive actions should not require unnecessary logging.
- Rejected alternatives: Requiring every completed plan to create a Log or awarding XP for lightweight completion.
- Revisit when: User testing demonstrates a better low-friction completion model.

## Phase 3 — Occurrence state
- Decision: Persist only planned, completed, skipped, and rescheduled occurrence statuses. Derive unresolved from an overdue occurrence that remains planned.
- Reason: Avoid background/cron state transitions while preserving accountability semantics.
- Rejected alternatives: Persisting `unresolved` as an independent status.
- Revisit when: A future scheduling architecture provides a compelling reason to persist it.

## Phase 3 — Plan/Log linkage
- Decision: planned_occurrences owns the optional unique log_id reference to logs.id.
- Reason: Planning surrounds the existing Log system without modifying the canonical Log schema to depend on planning.
- Rejected alternatives: logs.planned_occurrence_id or an M:N linking table in v1.
- Revisit when: Real product requirements require many-to-many linkage.

## Phase 3 — Planning privacy
- Decision: Initial Goals, Routines, To-Dos, occurrences, unresolved states, and check-in outcomes are owner-only/private.
- Reason: Intentions and missed expectations are more sensitive than shared completed actions.
- Rejected alternatives: Automatically inheriting friend-visible Log policies.
- Revisit when: Explicit plan-sharing/accountability features are designed.

## Phase 3 — Goal relationships
- Decision: A Routine or To-Do may support zero or one Goal; a Goal may have many Routines and To-Dos.
- Reason: Keep the initial model understandable and sufficient for v1.
- Rejected alternatives: Initial M:N Goal/Routine or Goal/To-Do join tables.
- Revisit when: Real use cases require an action to support multiple Goals.

## Phase 3 — Recurrence
- Decision: Initial Routine recurrence supports daily and weekly schedules, with selected weekdays for weekly recurrence.
- Reason: Cover common routines without prematurely building a general recurrence engine.
- Rejected alternatives: RRULE/cron/general monthly recurrence in the foundational slice.
- Revisit when: More complex scheduling is justified by real usage.

## Phase 3 — Time semantics
- Decision: Planning schedules model local human calendar intention using scheduled_date, optional scheduled_time, and an IANA timezone.
- Reason: "Monday at 6 PM" is fundamentally a local scheduling intention.
- Rejected alternatives: Making UTC timestamps the foundational recurrence representation.
- Revisit when: Cross-timezone scheduling requirements demonstrate a better model.

## Phase 3 — Calendar integration
- Decision: Google Calendar is a later adapter and must not shape the foundational planning schema.
- Reason: Bettr's internal planning model should function independently of an external provider.
- Rejected alternatives: Adding Google event IDs, calendar IDs, sync state, OAuth, or token fields to the initial schema.
- Revisit when: The internal Phase 3 planning model is stable and calendar integration is implemented.

## Phase 3 — Discipline boundary
- Decision: Phase 3 captures Discipline/Alignment evidence such as planned expectations, completion, skipping, rescheduling, unresolved expectations, and adherence, but does not implement mature interpretation.
- Reason: Phase 3 owns planning/action evidence; richer behavioral interpretation belongs to Phase 4.
- Rejected alternatives: Pulling Phase 4 analytics/scoring into the Phase 3 foundation.
- Revisit when: Phase 4 begins.

## Phase 3 — Schema deployment gate
- Decision: The initial Phase 3 schema migration must receive independent review of its constraints, RLS, foreign keys, and deletion behavior before being applied to live Supabase.
- Reason: Planning introduces new persistent user data and relationships, making schema mistakes significantly harder to reverse safely.
- Rejected alternatives: Automatically applying Cursor-generated migration SQL to production after implementation.
- Revisit when: After the Slice 1 migration has been implemented and reviewed.
