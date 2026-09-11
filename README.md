# Bettr

Private self-improvement dashboard for close friends. Get Bettr. Together.

## Current build

- 10 life categories
- Two-tap quick logging
- Custom entries with notes and optional photos
- Daily philosopher quotes
- Priority-aware Discipline score
- Redesigned calendar and analytics
- Friend accountability prototype
- Responsive/mobile navigation
- Optional Supabase cloud mode

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Bettr Cloud (Supabase)

The app still runs in local prototype mode when Supabase environment variables are absent. To enable real accounts, cloud logs, priority sync, and private photo storage:

1. Create a Supabase project.
2. Open the Supabase SQL Editor and run `supabase/schema.sql` once.
3. Copy `.env.local.example` to `.env.local` and fill in your project URL and publishable key.
4. Run `npm install` to install the Supabase JavaScript client.
5. Restart `npm run dev`.

When cloud mode is enabled, Bettr presents sign-up/sign-in before the dashboard. Existing browser-local logs can migrate into the first signed-in account. That legacy migration is claimed by one account only so another user on the same browser cannot inherit those logs.

Cloud photos are stored in a private `log-images` bucket and loaded through expiring signed URLs. Row-level-security policies restrict the current cloud data to the signed-in owner. Friendships are scaffolded in the schema, but friend log visibility is intentionally not opened yet.

Do not commit `.env.local`; it is ignored by Git.

## Semantic evaluation (custom logs)

Trusted quick-log buttons do not go through this path. Custom free-text logs are interpreted locally in the browser (`$0`-first, no paid generative LLM for scoring).

The pipeline is:

1. **Embeddings** — `Xenova/all-MiniLM-L6-v2` (INT8, mean-pooled, L2-normalized, 384-d).
2. **Developmental eligibility** — a frozen linear logistic probe on those embeddings. The probe score is an internal eligibility signal, not a calibrated probability and not XP.
3. **Deterministic rules around the model** — validity checks, clarification when the log is ambiguous, and category-integrity checks. Category suggestions use a separate heuristic over the same embeddings; they are not the eligibility classifier.
4. **Deterministic scoring** — if the log is eligible, application logic awards fixed base XP, then applies the selected category priority. The model does not output XP.

Evaluation fixtures and related scripts live under `benchmarks/semantic/`. This is a measured first version of semantic log intelligence, not a claim of production-grade AI.
