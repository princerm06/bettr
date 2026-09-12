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
