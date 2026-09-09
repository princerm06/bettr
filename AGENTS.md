# Bettr — Engineering Agent Instructions

## 1. Purpose of This File

This repository contains Bettr, formerly called Himothy.

This file defines the persistent engineering rules for AI coding agents working in this repository. Follow these instructions unless the user explicitly gives a conflicting instruction.

Do not treat this file as the complete product roadmap. Product roadmap decisions are maintained separately. This file exists to help engineering agents modify the repository safely and consistently.

Before making meaningful changes:

1. Inspect the relevant existing implementation.
2. Understand how the change interacts with surrounding systems.
3. Prefer the smallest coherent change that satisfies the requirement.
4. Preserve existing working behavior unless the task explicitly changes it.
5. Test or build after changes when practical.
6. Report what was implemented separately from what has actually been verified by the user.

---

## 2. Product Overview

Bettr is a private/social self-improvement and accountability platform.

Its core interaction is:

**Do something → log quickly → claim credit → see progress → friends see it → accountability**

Logging should feel like claiming credit for meaningful action, not filling out paperwork.

The long-term product philosophy is:

**Priorities → Goals / Routines / To-Dos / Planner → Action → Semantic Understanding → Deterministic Credit → Priority Reward → Progress → Discipline / Alignment → Insights → Adjust Plans & Priorities**

Bettr should help users become more capable together.

The social system should promote accountability, encouragement, and meaningful progress rather than attention-maximizing social-media behavior.

---

## 3. Current Product State

Phase 0 — Stabilization & Mobile — is the current engineering baseline and is in Release Candidate / Testing status. Most Phase 0 implementation work is complete, but final broader two-account/realtime regression verification has been intentionally deferred until after the Phase 1 semantic system is working.

The application already contains substantial working functionality. Do not assume this is a blank prototype or rewrite working systems unnecessarily.

Existing functionality includes, among other things:

- authentication
- username-based accounts
- optional recovery email
- onboarding
- profiles
- account deletion
- Supabase-backed persistence
- activity logging
- multi-category logging
- backdated logs
- editing and deleting logs
- priorities
- XP / points
- progress/category statistics
- Start Time
- Duration
- private log images
- friends
- friend requests
- friend acceptance
- friend removal
- friend activity feed
- reactions
- comments
- threaded replies
- comment photos
- comment image lightbox
- comment deletion
- Friends / Private visibility
- notifications
- notification history
- unread notification badges
- exact comment/reply notification targeting
- realtime social updates
- mobile/responsive layouts

When modifying one system, consider whether it can regress any of these existing systems.

---

## 4. Current Technology Stack

The existing application primarily uses:

- Next.js
- React
- TypeScript
- plain CSS
- Supabase
  - authentication
  - PostgreSQL database
  - Row Level Security
  - Storage
  - Realtime
- Vercel for production deployment
- Git / GitHub for version control

Do not introduce major new frameworks, state-management libraries, UI systems, databases, authentication providers, or infrastructure without an explicit requirement.

Prefer working within the existing architecture.

---

## 5. Public Brand vs Internal Naming

The product is being publicly rebranded from **Himothy** to **Bettr**.

Public-facing product name:

**Bettr**

Current positioning direction:

**Get Bettr. Together.**

IMPORTANT:

A public rebrand does NOT mean every internal identifier containing `himothy` should automatically be renamed.

Examples may include:

- localStorage/sessionStorage keys
- internal constants
- migration history
- database identifiers
- old migration filenames
- implementation-specific identifiers
- other internal references that users never see

Do not perform a repository-wide `Himothy → Bettr` replacement.

During rebranding:

- change user-facing branding where required
- preserve internal identifiers when changing them provides no user benefit
- do not rewrite historical migrations merely to change branding
- avoid database migrations solely for cosmetic internal naming
- avoid introducing regression risk for an unnecessary internal rename

Internal names can be migrated later if there is an actual engineering reason.

---

## 6. Rebrand Safety

The first major task after Phase 0 is the public-facing Bettr rebrand.

When implementing rebrand work:

1. Inventory user-visible Himothy references first.
2. Distinguish user-visible branding from internal implementation identifiers.
3. Update branding deliberately rather than with blind global replacement.
4. Preserve application functionality.
5. Do not change database behavior merely for branding.
6. Do not change scoring behavior merely for branding.
7. Do not change social behavior merely for branding.
8. Do not redesign unrelated systems unless explicitly requested.
9. Run regression/build checks after meaningful batches of changes.

Brand/art direction may evolve independently of this engineering file. Do not invent final visual assets or branding decisions when requirements have not been provided.

---

## 7. Categories

The locked Bettr v1 core progression categories are:

1. Appearance & Self-Care
2. Fashion & Style
3. Academics
4. Career
5. Finance
6. Nutrition & Cooking
7. Social
8. Physical Prowess
9. Mind & Craft
10. Inner Wellbeing
11. Spirituality

Discipline is not a normal user-selected category. It is intended to be derived from behavior/alignment.

Not every meaningful, healthy, responsible, or admirable action needs a progression category or XP. Bettr tracks deliberate self-development rather than everything in a user's life.

Examples:

- ordinary life administration or maintenance may deserve no progression credit
- health/recovery reflection may belong in Journal; deliberate rehabilitation that rebuilds physical capability may fit Physical Prowess
- community service may be meaningful without requiring a dedicated progression category; reflection about it may belong in Journal, while a specific developmental intent may support an existing category

Do not create new progression categories merely to make every meaningful activity fit somewhere.

Do not silently add, remove, rename, merge, or reorder core categories without an explicit product requirement.

---

## 8. Priority System

Current priority levels are:

- Critical
- High
- Normal
- Maintenance

Priority represents how important a category currently is to the user.

Priority should affect reward only AFTER an action has been determined to deserve credit.

Priority must never turn invalid progress into valid progress.

Conceptually:

**Semantic validity → base credit → priority adjustment → final XP**

Never:

**Priority → validity**

---

## 9. XP / Reward Invariants

The intended reward architecture is deterministic after semantic evaluation.

Current planned base credit:

### Standard valid progress

Base XP:

`5`

Priority-adjusted:

- Critical → 7
- High → 6
- Normal → 5
- Maintenance → 4

### Stronger / evidence-backed progress

Base XP:

`7`

Priority-adjusted:

- Critical → 9
- High → 8
- Normal → 7
- Maintenance → 6

### Invalid progress

Examples:

- junk
- semantic mismatch
- non-progress
- invalid action

Base XP:

`0`

Priority MUST NOT raise a zero-credit action above zero.

For multi-category logs, category tags must not multiply XP.

The intended approach is to use the average applicable priority bonus.

Do not casually change XP semantics.

Future Phase 2 planning also includes category focus/ranking in addition to priority levels. Priority level represents absolute importance; focus/ranking represents relative importance. Focus/rank should inform planning, alignment, insights, and later AI reasoning, but should NOT become an additional XP multiplier on top of priority weighting.

If scoring architecture needs to change, make the change explicit and explain its implications.

---

## 10. Zero-Point Log Invariants

A zero semantic/scoring outcome is intentionally different from credited progress.

Current Phase 0 behavior may still retain some zero-point entries. Do not redesign that behavior during unrelated work.

The intended Phase 1 direction is:

- clearly valid developmental action → save as a progress log and award deterministic credit
- clearly invalid, junk, mismatched, or non-developmental action → normally do not create a normal user-visible progress-history entry; allow correction/clarification where appropriate
- ambiguous action → request or support clarification/correction rather than pretending certainty
- zero/invalid outcomes must not increase progress, category statistics, Level, Discipline, Active Days, or appear in Friends activity as legitimate progress

Zero may remain an internal semantic/scoring result or minimal internal metadata where technically necessary, but it should not be treated as normal progression.

Do not accidentally count rejected activity through secondary aggregation logic.

---

## 11. Semantic Evaluator — Important Current Limitation

The existing custom-log evaluator/filter is known to be weak.

Do NOT spend significant engineering effort patching the old evaluator with an expanding collection of brittle keyword exceptions unless explicitly instructed.

Examples of known failures include:

### False negative

Input:

`Watched 6 ochem videos`

Category:

`Academics`

Expected conceptual result:

Valid academic progress.

The current evaluator has incorrectly rejected this.

### False positive / mismatch

Input:

`Lifted the moon`

Category:

`Fashion & Accessories`

Expected conceptual result:

Zero credit due to semantic mismatch and/or implausible/junk activity.

The current evaluator has incorrectly accepted this.

These examples should eventually become permanent semantic benchmark/regression cases.

The poor quality of the current evaluator is NOT justification for rewriting unrelated Phase 0 infrastructure.

---

## 12. Phase 1 Semantic Intelligence Direction

The next major intelligence phase is Semantic Log Intelligence.

The intended architecture is approximately:

**Log**
→ **semantic understanding**
→ **progress validity**
→ **category support / mismatch**
→ **junk / ambiguity assessment**
→ **evidence assessment**
→ **deterministic base credit**
→ **priority adjustment**
→ **final XP**

The initial implementation should favor a low-cost / $0-first architecture.

Current direction:

- local/open-source transformer or embedding model
- deterministic scoring/rules after semantic interpretation
- avoid requiring a paid generative LLM API for the first version
- optional fallback systems may be considered later

The semantic layer should eventually reason about:

- whether the user described a concrete action
- whether the action represents meaningful, creditworthy self-development
- whether the action is real/plausible-looking but still non-developmental or non-creditworthy
- whether the selected category is semantically supported
- category mismatch
- junk/spam
- obvious structural nonsense or implausible/junk claims, without pretending the system can verify every real-world claim
- ambiguous logs
- meaningful supporting detail/evidence
- attempts to game XP

Do not reduce this problem to simple keyword matching.

Do not allow an ML model to arbitrarily determine final XP.

The preferred separation is:

**ML/semantic system interprets the action.**

**Deterministic application logic awards credit.**

This separation is important for consistency, debuggability, testing, and portfolio quality.

Phase 1 should also support semantic category suggestions. The semantic system answers, conceptually, "What does this action appear to support?" If a selected category is missing or mismatched, Bettr may suggest an appropriate category (for example, `+ Add Career`) while keeping the user in control. More nuanced explanatory coaching belongs to later AI Coach work, not Phase 1.

---

## 13. Semantic Benchmarking

Phase 1 should be evaluated rather than merely described as "AI-powered."

Maintain or create a benchmark containing categories such as:

- normal valid logs
- unusual but valid logs
- ambiguous logs
- category mismatches
- junk
- real-world but non-developmental actions
- obvious structural nonsense or implausible/junk claims
- adversarial/gaming attempts
- multi-category cases
- short logs
- detailed logs

Known regression examples should be preserved.

Where practical, evaluation should produce measurable results so improvements can be compared against the old evaluator.

Do not optimize only for a handful of manually chosen examples.

---

## 14. Supabase Safety Rules

Supabase contains important production behavior.

Before changing:

- tables
- columns
- constraints
- triggers
- RLS policies
- storage policies
- realtime configuration
- authentication behavior

inspect the relevant existing migrations and application usage first.

Never casually weaken Row Level Security to make a feature work.

Never solve an authorization bug by simply making data broadly public.

Database migrations should:

- be additive/safe where practical
- have clear names
- preserve existing production data
- avoid destructive operations unless explicitly required
- account for RLS
- account for foreign keys
- account for existing triggers
- account for Storage behavior when applicable

Do not rewrite historical migrations that may already have been applied to production.

Create a new migration when production schema behavior needs to change.

---

## 15. Security and Secrets

NEVER expose, print, commit, or place into source code:

- Supabase service role keys
- private API keys
- passwords
- authentication secrets
- production credentials
- `.env.local` contents
- other secrets

`.env.local` is sensitive.

Do not include secrets in:

- commits
- logs
- screenshots
- generated documentation
- AGENTS.md
- README examples
- client-side source code

Service-role operations must remain server-side.

Never move privileged credentials into browser/client code.

If a task appears to require exposing a secret to the client, stop and propose a safe architecture instead.

---

## 16. Authentication and Account Safety

Authentication is already functioning.

Do not casually rewrite auth flows during unrelated work.

Preserve:

- username/password login behavior
- profile relationships
- optional recovery email behavior
- onboarding behavior
- account deletion behavior
- ownership/RLS relationships

Account deletion currently includes privileged server-side cleanup behavior.

Be especially careful with:

- user deletion
- storage cleanup
- cascading database deletes
- service-role access
- profile creation
- onboarding state

Changes in these areas require deliberate testing.

---

## 17. Social / Privacy Invariants

Bettr is intended to be private/social, not globally public by default.

Existing visibility concepts include:

- Friends
- Private

Preserve privacy boundaries.

Private logs must not appear in friend-facing surfaces.

Zero-point/invalid logs must not leak into friend activity as legitimate progress.

When implementing:

- feeds
- comments
- notifications
- reactions
- profiles
- search
- friend relationships

consider authorization and privacy, not merely UI visibility.

Do not rely only on hiding something in React if database authorization should also protect it.

---

## 18. Notifications and Realtime

The existing notification architecture distinguishes:

### Bell

Unread inbox.

### Activity

Recent notification history, including read notifications.

Reading a notification should not automatically mean deleting its history unless explicitly designed that way.

Existing notification concepts include:

- friend request
- friend acceptance
- comment
- reply

Exact comment/reply targeting may use notification `comment_id`.

Realtime behavior is important for:

- notification badges
- social updates
- friend activity

Do not introduce polling when the existing Realtime architecture can correctly solve the problem.

Do not claim realtime behavior has been verified merely because subscription code compiles.

Cross-account behavior requires actual runtime verification.

---

## 19. Comments

The application currently supports:

- top-level comments
- threaded replies
- comment images
- signed image URLs
- image lightbox
- comment deletion
- exact notification targeting

Deletion permissions may depend on:

- comment ownership
- log ownership
- database RLS

Parent-comment deletion can affect replies through database relationships.

Before modifying comment behavior, inspect both frontend logic and database policies.

Do not assume UI permission checks are sufficient security.

---

## 20. Storage

The application uses private Supabase Storage buckets for user content.

Signed URLs may be used to display private content.

When deleting database objects associated with stored files, consider whether storage cleanup is also required.

Do not make private buckets public merely to simplify image rendering.

Preserve ownership and privacy policies.

---

## 21. Mobile-First Regression Awareness

Bettr is used on mobile.

A desktop-only implementation is not sufficient.

When modifying user-facing UI, consider:

- narrow viewport layout
- touch targets
- input font size
- accidental mobile browser zoom
- scroll behavior
- sticky/fixed elements
- long comment threads
- modal sizing
- image sizing
- overflow
- navigation order
- keyboard interaction

Recent Phase 0 work deliberately improved mobile behavior.

Do not regress it.

For example, the Friends experience intentionally avoids forcing mobile users to scroll through the entire activity feed just to reach their friend/circle controls.

---

## 22. UI / CSS Rules

The current product uses plain CSS.

Do not introduce Tailwind, a component framework, or a new design-system dependency simply for convenience unless explicitly requested.

Reuse existing variables/classes/patterns where sensible.

During the lightweight Bettr rebrand, centralize reusable brand tokens/conventions where sensible instead of hard-coding emerald/mint/teal values independently throughout components. Build enough theme-readiness to support later design work, but do not turn the rebrand into the Phase 5 visual overhaul.

Avoid broad CSS selectors that unintentionally affect unrelated UI.

When reusing an existing class, inspect its current styles first.

A previous regression occurred when a class designed for a small composer photo button was reused for a posted comment image, causing layout overlap.

Prefer scoped selectors when the same conceptual element appears in different contexts.

Always consider both desktop and mobile behavior.

---

## 23. Change Discipline

Do not make unrelated "cleanup" changes during a scoped feature task.

Avoid:

- giant refactors without need
- renaming large numbers of files without need
- replacing libraries without need
- changing formatting across unrelated files
- redesigning APIs while fixing UI
- rewriting working components because another implementation seems cleaner

Small coherent changes are preferred.

If substantial refactoring would materially improve the system, explain the proposal before doing it unless the user explicitly requested the refactor.

---

## 24. Inspect Before Editing

Never guess where functionality lives if the repository can answer the question.

Before editing:

1. Search the codebase.
2. Read the relevant implementation.
3. Trace important call sites.
4. Inspect relevant types.
5. Inspect relevant database migrations if data behavior is involved.
6. Understand current CSS before reusing classes.
7. Then modify.

Do not generate a replacement implementation from assumptions when an existing implementation already exists.

---

## 25. Build and Testing Expectations

After meaningful code changes, run appropriate checks.

At minimum for significant frontend/TypeScript work:

`npm run build`

If the repository later contains dedicated tests, run the relevant tests as well.

A successful build means:

**the project compiled successfully**

It does NOT automatically mean:

**the feature works correctly**

Distinguish:

- Implemented
- Build passed
- Automated tests passed
- Manually verified
- Cross-account verified
- Production verified

Never report a feature as fully working merely because code was written or the build passed.

---

## 26. Regression Testing

When modifying an established system, identify nearby behavior that could regress.

Examples:

Changing notifications may require checking:

- unread badge
- Activity history
- exact targeting
- friend requests
- friend acceptance
- comments
- replies
- realtime updates

Changing logging may require checking:

- History
- Progress
- XP
- category statistics
- priorities
- zero-point behavior
- Friends feed
- privacy
- editing
- backdating

Prefer targeted regression checks over assuming isolation.

---

## 27. Git Rules

GitHub is the source of truth/checkpoint system.

Before large or risky work:

- inspect `git status`
- understand the current branch
- preserve a clean checkpoint when practical

Do not automatically commit or push unless the user requests it or the current workflow explicitly authorizes it.

Do not:

- force push
- rewrite shared history
- delete branches
- reset destructive history
- discard uncommitted user work

without explicit authorization.

Before suggesting a commit, summarize the meaningful changes.

Keep commits logically scoped.

---

## 28. Current Baseline

The Phase 0 implementation baseline was checkpointed on `main`.

At the time this engineering instruction file was introduced, the repository had a clean working tree and was synchronized with `origin/main`.

The Phase 0 implementation / pre-rebrand safety checkpoint commit was:

`2a3ba61 complete phase 0 regression fixes and mobile polish`

Treat that commit as the pre-Cursor / pre-Bettr-rebrand safety checkpoint unless later project history supersedes it.

---

## 29. Production Awareness

The application has been deployed through Vercel.

Do not assume local-only consequences.

Changes involving:

- environment variables
- Supabase schema
- authentication
- storage
- API/server routes
- Next.js configuration

may affect production deployment.

Do not modify production infrastructure casually.

When a database migration is required, clearly distinguish:

1. code change
2. migration file creation
3. migration application
4. deployment
5. runtime verification

These are separate events.

---

## 30. Cost Awareness

Bettr should be developed cost-consciously.

Prefer free/open-source/local solutions where they satisfy the product requirement.

Do not introduce recurring paid APIs or infrastructure without identifying:

- why they are needed
- expected benefit
- likely cost
- whether a free/local alternative exists

This is particularly important for ML/AI features.

Phase 1 is intentionally designed around a $0-first semantic architecture.

---

## 31. Engineering Quality / Portfolio Quality

Bettr is both a real product effort and an important technical portfolio project.

Prefer architectures that are:

- understandable
- testable
- measurable
- explainable
- maintainable
- technically defensible

Do not add "AI" merely for marketing.

For ML features, prefer measurable evaluation and clear separation of responsibilities.

For example:

Semantic model: **interpretation**

Deterministic scoring: **product/business logic**

Benchmark: **measurement**

This is stronger than an opaque LLM call that directly outputs arbitrary XP.

---

## 32. User Learning / Collaboration Style

The user is actively developing their software-engineering and ML skills.

Do not unnecessarily hide all reasoning behind autonomous changes.

For substantial changes:

- explain the implementation approach
- identify important files
- explain architectural decisions
- summarize what changed
- identify what still needs verification

Do not flood the user with irrelevant implementation detail, but make important engineering decisions understandable.

When multiple valid architectures exist, explain meaningful tradeoffs before making a high-impact choice.

---

## 33. Product Decisions vs Engineering Decisions

Do not invent major product behavior because it is convenient to implement.

If a requirement affects:

- scoring philosophy
- category definitions
- privacy
- social behavior
- goals
- priorities
- progression
- semantic evaluation policy
- major UX direction

and the intended behavior is unclear, surface the decision rather than silently choosing a product direction.

Engineering agents implement the product strategy; they do not independently redefine it.

---

## 34. Future Product Architecture Principles

These are future-facing constraints, not permission to implement later phases early.

- Bettr's future planner is development-scoped, not a generic life-admin/to-do system. Plans create expectations; logs remain the universal record of actual self-development actions. Completing a plan/routine does not automatically mean progression XP.
- Journal/reflections are conceptually distinct from logs: logs represent what the user did; Journal represents what the user thought, felt, noticed, or learned. Journal content does not automatically earn progression XP.
- Universal Bettr progression is distinct from category-specific outcome/performance data. Different domains may eventually use different measurements such as running pace, strength PRs, finance metrics, nutrition targets, or skill ratings.
- Future integrations should map useful outside data into Bettr-owned self-development/domain models rather than tightly coupling Bettr to one provider's schema. External services provide specialized evidence/data; Bettr owns the self-development model and interpretation.
- Integration principle: **Open-ended, not open-to-anything.**
- Imported/connected data does not automatically become XP-worthy.
- The major visual/art/theme overhaul belongs primarily in Phase 5. The current Bettr rebrand should establish public branding and a theme-ready foundation without unnecessarily redesigning every screen.

---

## 35. Future Roadmap Awareness

The broad roadmap currently includes:

- Phase 0 — Stabilization & Mobile
- Bettr public-facing rebrand checkpoint
- Phase 1 — Semantic Log Intelligence
- Phase 2 — Meaningful Priorities
- Phase 3 — Goals, Routines, To-Dos & Planner
- Phase 3.5 — Native Mobile App
- Phase 4 — Insights, Alignment & Reflection
- Phase 5 — Progression, Advanced Analytics & Identity
- Phase 6 — Social Accountability 2.0 & Connected Ecosystem
- Phase 7 — Security, Feedback & Public Production
- Phase 8 — Semantic Intelligence 2.0 & AI Coach

This is included only to provide architectural direction.

Do NOT begin implementing future phases merely because they appear here.

Only work on the task/phase explicitly requested.

Do not silently pull future features into the current implementation.

---

## 36. Immediate Engineering Sequence

The current intended sequence is:

1. Preserve the Phase 0 implementation / pre-rebrand safety checkpoint.
2. Establish Cursor engineering instructions.
3. Perform the lightweight public-facing Himothy → Bettr rebrand and establish basic theme/design readiness without a major visual overhaul.
4. Regression-test the rebrand as appropriate.
5. Checkpoint the Bettr-branded version in Git.
6. Use the locked Bettr v1 category taxonomy and define the Phase 1 semantic contract.
7. Build the initial semantic benchmark/evaluation cases before or alongside implementation.
8. Begin Phase 1 Semantic Log Intelligence.
9. Evaluate and improve the semantic system against the benchmark.
10. Integrate semantic evaluation with deterministic scoring and existing priority behavior.
11. After the semantic system is working, return to the intentionally deferred broader Phase 0/multi-user realtime regression verification and perform the appropriate broader regression pass.

Do not skip directly into later roadmap phases unless explicitly instructed.

---

## 37. Known Deferred Verification

Phase 0 is in Release Candidate / Testing status, not fully verified Complete.

The remaining broader two-account/realtime verification has been intentionally deferred until after the Phase 1 semantic system is working. Known outstanding checks include:

- A comments/replies → B receives the notification essentially immediately
- A sends B a friend request → B receives it essentially immediately
- B accepts → A receives the friend-acceptance notification essentially immediately

This deferred verification is not a blocker to the rebrand or Phase 1 work, but it must remain visible and should be completed during the broader regression pass after the semantic system is working.

Do not interpret deferred additional testing as permission to break those systems.

If future work touches notifications, realtime, social feeds, comments, friend relationships, or privacy, regression-test the affected behavior.

---

## 38. General Rule

When uncertain:

**Preserve working behavior, inspect the existing system, make the smallest coherent change, protect user data/privacy, and ask before making a major product or architectural assumption.**