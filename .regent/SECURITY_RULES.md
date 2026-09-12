# Security Rules

Security, privacy, secret-handling, and permission constraints.

- Never commit secrets, credentials, API keys, tokens, service-role keys, or private environment files.
- Never expose private user data in fixtures, logs, screenshots, documentation, prompts, or commits.
- Prefer least privilege.
- Preserve Supabase row-level security and authorization boundaries.
- Never move privileged server-side credentials into client code.
- Treat the GitHub repository as public.
- Review newly created files before staging them.
- Do not commit local-only caches, generated secrets, model artifacts, or machine-specific configuration unless intentionally public-safe.
- Any destructive data migration must require explicit review and a rollback plan.
