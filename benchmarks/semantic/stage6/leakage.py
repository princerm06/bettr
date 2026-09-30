"""Leakage audit. Must pass before any gradient step."""

from __future__ import annotations

import json
import re

from contract import CRITICAL_TRAPS, DATA

STOPWORDS = {
    "this", "that", "with", "from", "have", "were", "been", "them", "they",
    "your", "just", "into", "over", "after", "before", "while", "where",
    "when", "what", "which", "than", "then", "today", "tomorrow", "morning",
    "tonight", "earlier", "already", "minutes", "minute", "again", "still",
    "also", "only", "some", "didnt", "didn't", "does", "never", "tried",
    "quit", "almost", "nearly", "instead", "going", "side", "note",
    "session", "done", "entry", "spent", "later", "weekend", "next", "week",
    "plan", "planning", "started", "start", "finished", "finish", "actually",
    "single", "halfway", "nope", "kinda", "lowkey", "tbh", "stopped",
    "attempted", "anyway", "wrapped", "said", "will", "going", "today",
    "left", "boxed", "ordered", "picked", "paid", "shop", "short", "there",
    "their", "about", "because", "would", "could", "should", "really",
    "every", "each", "both", "such", "very", "more", "most", "much", "many",
    "some", "than", "then", "them", "they", "your", "ours", "into", "onto",
    "upon", "under", "again", "once", "here", "there", "where", "while",
}

# Distinctive Stage 5 lexical items. Whole words only.
DENYLIST = {
    "dishwasher", "psalter", "psalm", "psalms", "ochem", "recruiter",
    "calculus", "goggles", "cumin", "bouldered", "boulder", "flossed",
    "floss", "scripture", "internship", "skincare", "triceps", "netflix",
    "tiktok", "chipotle", "journaled", "workout", "mechanism", "mechanisms",
    "orgo", "outreach", "textbook", "groceries", "membership", "linkedin",
    "doordashed", "anki", "biochem", "guitar", "piano", "resume", "budget",
    "grocery", "chicken", "meditated", "meditate", "prayed", "prayer",
    "swam", "swim", "swimmer", "laps", "goggle", "xp",
}

DENY_PHRASES = (
    "problem set",
    "gym membership",
    "bank balance",
    "running shoes",
    "organic chemistry",
    "cover letter",
    "lab report",
    "give me 7 xp",
    "ran the dishwasher",
    "studied the menu",
    "copied a psalm",
    "opened the psalter",
    "went to the gym",
    "didn't go to the gym",
)


def norm(text: str) -> str:
    text = text.lower().replace("\u2019", "'").replace("\u2018", "'")
    text = re.sub(r"[^a-z0-9'\s]", " ", text)
    text = text.replace("'", "")
    return re.sub(r"\s+", " ", text).strip()


def tokens(text: str) -> list[str]:
    return [tok for tok in norm(text).split(" ") if tok]


def content_tokens(text: str) -> set[str]:
    out = set()
    for tok in tokens(text):
        if len(tok) < 4 or tok in STOPWORDS:
            continue
        out.add(tok)
    return out


def _load_jsonl(path) -> list[dict]:
    rows = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def _match_trap(trap: dict, locked: list[dict]) -> dict | None:
    want_p = norm(trap["premise"])
    want_c = norm(trap["criterion"])
    hits = []
    for row in locked:
        premise = norm(row["text"])
        target = norm(row["target"])
        if target != want_c:
            continue
        if premise == want_p or premise.startswith(want_p + " "):
            hits.append(row["id"])
    if len(hits) < 1:
        return {"trap": trap, "matchIds": hits, "ok": False}
    return {"trap": trap, "matchIds": hits, "ok": True}


def audit() -> dict:
    locked_payload = json.loads((DATA / "locked-test.json").read_text(encoding="utf-8"))
    locked = locked_payload["examples"]
    train = _load_jsonl(DATA / "train.jsonl")
    dev = _load_jsonl(DATA / "dev.jsonl")
    generated = train + dev

    failures: list[dict] = []
    locked_premises = {norm(row["text"]) for row in locked}
    locked_targets = {norm(row["target"]) for row in locked}
    locked_hypotheses = {norm(row["hypothesis"]) for row in locked}
    trap_premises = [norm(trap["premise"]) for trap in CRITICAL_TRAPS]

    long_locked = []
    for row in locked:
        premise = norm(row["text"])
        if len(tokens(premise)) >= 4 and len(premise) >= 18:
            long_locked.append((row["id"], premise, content_tokens(row["text"]), content_tokens(row["target"])))

    denylist_re = re.compile(r"\b(" + "|".join(sorted(DENYLIST, key=len, reverse=True)) + r")\b")

    exact_premise = 0
    exact_target = 0
    exact_hypothesis = 0
    containment = 0
    trap_hits = 0
    phrase_hits = 0
    denylist_hits = 0
    lemma_hits = 0
    lemma_examples: list[dict] = []

    for row in generated:
        premise_n = norm(row["premise"])
        criterion_n = norm(row["criterion"])
        blob = premise_n + " " + criterion_n
        if premise_n in locked_premises:
            exact_premise += 1
            failures.append({"kind": "exact_premise", "id": row["id"], "premise": row["premise"]})
        if criterion_n in locked_targets:
            exact_target += 1
            failures.append({"kind": "exact_target", "id": row["id"], "criterion": row["criterion"]})
        if premise_n in locked_hypotheses or criterion_n in locked_hypotheses or blob in locked_hypotheses:
            exact_hypothesis += 1
            failures.append({"kind": "exact_hypothesis", "id": row["id"]})
        for trap_p in trap_premises:
            if trap_p and trap_p in blob:
                trap_hits += 1
                failures.append({"kind": "critical_trap_string", "id": row["id"], "trap": trap_p})
                break
        for phrase in DENY_PHRASES:
            if phrase in blob:
                phrase_hits += 1
                failures.append({"kind": "deny_phrase", "id": row["id"], "phrase": phrase})
                break
        if denylist_re.search(blob):
            denylist_hits += 1
            failures.append({"kind": "denylist", "id": row["id"], "blob": blob[:180]})
        for locked_id, locked_p, locked_p_toks, locked_c_toks in long_locked:
            if locked_p in premise_n:
                containment += 1
                failures.append({"kind": "containment", "id": row["id"], "lockedId": locked_id})
                break
        gen_p = content_tokens(row["premise"])
        gen_c = content_tokens(row["criterion"])
        for locked_id, _locked_p, locked_p_toks, locked_c_toks in long_locked:
            if len(gen_p & locked_p_toks) >= 2 and len(gen_c & locked_c_toks) >= 1:
                lemma_hits += 1
                if len(lemma_examples) < 25:
                    lemma_examples.append(
                        {
                            "id": row["id"],
                            "lockedId": locked_id,
                            "premiseOverlap": sorted(gen_p & locked_p_toks),
                            "criterionOverlap": sorted(gen_c & locked_c_toks),
                        }
                    )
                failures.append({"kind": "lemma_overlap", "id": row["id"], "lockedId": locked_id})
                break

    trap_resolution = [_match_trap(trap, locked) for trap in CRITICAL_TRAPS]
    unresolved = [item for item in trap_resolution if not item["ok"]]

    passed = not failures and not unresolved
    result = {
        "passed": passed,
        "trainN": len(train),
        "devN": len(dev),
        "lockedN": len(locked),
        "checks": {
            "exactPremiseHits": exact_premise,
            "exactTargetHits": exact_target,
            "exactHypothesisHits": exact_hypothesis,
            "containmentHits": containment,
            "criticalTrapStringHits": trap_hits,
            "denyPhraseHits": phrase_hits,
            "denylistHits": denylist_hits,
            "lemmaOverlapHits": lemma_hits,
            "unresolvedTraps": len(unresolved),
        },
        "lemmaExamples": lemma_examples,
        "trapResolution": [
            {
                "premise": item["trap"]["premise"],
                "criterion": item["trap"]["criterion"],
                "expect": item["trap"]["expect"],
                "matchIds": item["matchIds"],
                "ok": item["ok"],
            }
            for item in trap_resolution
        ],
        "failureSample": failures[:40],
        "failureCount": len(failures),
        "tokenOverlapDefinition": (
            "Content tokens are length >= 4 and not scaffold/function stopwords. "
            "A pair fails when it shares 2 or more content tokens with a locked premise "
            "of at least 4 tokens and 18 characters, and also shares 1 or more content "
            "tokens between its criterion and that row's target."
        ),
    }
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / "leakage-audit.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result
