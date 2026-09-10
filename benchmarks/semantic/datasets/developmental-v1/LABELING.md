# Candidate #3A labeling guide

This guide is for the **developmental-validity** dataset only. It is not a full semantic contract, not a category classifier, and not a junk detector.

## Research question

Can a frozen MiniLM embedding plus a Bettr-specific **binary** classifier distinguish realistic developmental actions from realistic non-developmental activity?

## Official trained labels

Train only on clear rows:

- `DEVELOPMENTAL`
- `NON_DEVELOPMENTAL`

Do **not** train a third `UNCERTAIN` class.

## Definition

A **developmental** action is a deliberate action that meaningfully develops, improves, practices, intentionally expresses, or intentionally maintains an aspect of the person’s capabilities or wellbeing.

Topical association is not enough. Buying gear related to a domain is not automatically developmental. Checking a status related to a domain is not automatically developmental. Passive consumption is not automatically developmental. Ordinary productivity, errands, and responsible adulting are not automatically developmental.

## `DEVELOPMENTAL`

Use when the log describes a realistic, concrete action that *is* the developmental work.

The action itself must develop, improve, practice, intentionally express, or intentionally maintain capability or wellbeing.

## Intentional maintenance (allowed)

Appearance & Self-Care (and similar domains) explicitly include **deliberate maintenance**, not only visible upgrades.

Valid maintenance is still a chosen practice: grooming, hygiene, haircare, a close-out routine, prescribed mobility work, or a repeated spiritual/wellbeing practice.

It is **not** developmental merely because it happened to the body or to a schedule:

- splashing water on your face, staring in a mirror, booking an appointment, buying a product, or “I have hair” are not maintenance-as-practice
- a haircut you requested and sat through, a wash-day protocol, nail/beard care, or a full hygiene close-out *can* be developmental maintenance

When labeling, prefer wording that shows the person **did the practice**, not that they merely consumed a service as an errand with no care intent. A clearly requested haircut/grooming session counts as appearance maintenance. Booking the slot next month does not.

## `NON_DEVELOPMENTAL`

Use when the log is realistic ordinary, administrative, acquisitive, status-checking, passive, or merely responsible life, even if it is *about* a Bettr domain.

Includes:

- buying equipment or products
- eating, reheating, or ordering food without cooking/nutrition skill work
- checking balances, inboxes, trackers
- scrolling feeds
- commuting, errands, chores
- receiving money, paying a routine bill, sending invoices for work already done
- opening an app/site without doing the work
- hanging out / attending without interpersonal skill work
- feeling an emotion with no reflective practice

## `UNCERTAIN`

Use when a reasonable rater cannot tell whether a meaningful developmental action occurred.

`UNCERTAIN` rows are **auxiliary evaluation only**. They must not drive training loss or official binary metrics.

Do not copy Semantic Benchmark v1 ambiguous items even for auxiliary rows. Teach the *pattern* (unnamed work, attendance without contribution) with different situations.

## Frozen benchmark exclusion (strong)

The 72-case Semantic Benchmark v1 is the **exam**.

Training may teach a general Bettr principle. It must not rehearse an exam question.

Forbidden in **trainable** families (and avoided in auxiliary wording):

- exact v1 text
- trivial paraphrase
- the same near-pair/scenario with nouns, numbers, or brands swapped (run vs jog, bank account vs bank balance, LinkedIn vs professional feed, ochem videos vs chemistry lectures, meal prep chicken/rice, skincare routine, guitar practice, internship applications, spending review + budget)

After expansion, run both normalized-string exclusion **and** a manual/semantic check against `benchmarks/semantic/v1.ts`.

Permanent v1 regressions remain evaluation-only after training. B09 is in-scope for later developmental-validity reporting. B58 is out-of-scope for judging 3A success.

## No shortcuts

- No verb blacklists.
- No keyword patches for benchmark phrases.
- Expand by adding **new families**, not paraphrase inflation.

## First-pass scoring (later)

1. Binary metrics on clear DEV vs NON_DEV val families (no abstention).
2. Abstention metrics separately.
3. Frozen 72-case developmental-validity slice only, thresholds never fit on v1.
