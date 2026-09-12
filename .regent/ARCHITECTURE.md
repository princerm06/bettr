# Architecture

Document the important systems, boundaries, and data flows Regent must preserve.

## Current architecture
- Web application with Supabase-backed authentication and persistent user data.
- Users create logs/actions that may belong to one or more self-improvement categories.
- Categories, priorities, scoring, XP/progress, profiles, and social features are separate concerns and should not be casually coupled.
- Phase 1 semantic analysis uses MiniLM embeddings plus a narrow logistic-probe classifier for conservative feedback.
- Semantic/ML output can suggest or clarify meaning but is not the source of deterministic scoring.
- Phase 2 adds meaningful user priorities and priority-aware progress while preserving deterministic credit.
- Social functionality includes profiles, friendships, feed activity, comments/replies, and notifications.
- Regent development work should preserve existing data compatibility unless a migration is explicitly planned.

## Architectural invariants
- Deterministic scoring/XP remains separate from ML confidence.
- ML may advise, classify, flag, or request clarification; it must not silently award or remove credit.
- Category mismatch protection should remain conservative.
- Existing authenticated user data must remain isolated per user.
- Supabase access must respect row-level security and existing authorization boundaries.
- New features should prefer incremental extension over unnecessary rewrites.
- Realtime/social behavior must not be broken while implementing unrelated features.
- Public-repository hygiene is mandatory.
