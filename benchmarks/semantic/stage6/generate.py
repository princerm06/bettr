"""Deterministic Stage 6 synthetic pairs.

Train uses seed 42 only to shuffle order. Dev uses seed 43 only to shuffle
order. Which strings exist is fixed by the templates, not by the seed.
"""

from __future__ import annotations

import json
import random

from contract import DATA, DEV_SEED, TRAIN_SEED
from frames import frames

SUPPORT_OPS = ("full", "telegraph", "duration", "slang", "typo", "purchase_identity")
DENY_OPS = ("negation", "quit", "contradiction")
INSUFFICIENT_OPS = (
    "future",
    "plan",
    "almost",
    "purchase",
    "wrong_object",
    "vague",
    "unrelated",
    "junk",
)


def _typo_token(token: str) -> str:
    chars = list(token)
    idxs = [i for i, ch in enumerate(chars) if ch.isalpha()]
    if len(idxs) < 4:
        return token
    for left, right in ((1, 2), (0, 1), (2, 3), (-2, -1)):
        i, j = idxs[left], idxs[right]
        if chars[i] != chars[j]:
            chars[i], chars[j] = chars[j], chars[i]
            return "".join(chars)
    return token


def _typo_phrase(past: str, obj: str) -> str:
    words = obj.split()
    idx = max(range(len(words)), key=lambda i: sum(ch.isalpha() for ch in words[i]))
    typo = _typo_token(words[idx])
    if typo == words[idx]:
        typo = _typo_token(past) if _typo_token(past) != past else past + "x"
        return f"{typo} {obj}"
    words[idx] = typo
    return f"{past} {' '.join(words)}"


def _materialize(frame: dict[str, str], index: int) -> dict[str, str]:
    minutes = str(8 + (index % 11) * 3)
    typo = _typo_phrase(frame["past"], frame["obj"])
    vague = f"did some {frame['vague_noun']} stuff"
    unrelated = f"The radiator in room {index + 3} clicked twice"
    junk = f"zx{frame['id']}zx"
    practice = f"{frame['past']} {frame['obj']}"
    bought = f"bought {frame['gear']}"
    return {
        **frame,
        "minutes": minutes,
        "typo": typo,
        "vague": vague,
        "unrelated": unrelated,
        "junk": junk,
        "practice": practice,
        "bought": bought,
    }


def _train_examples(frame: dict[str, str]) -> list[dict[str, str]]:
    past, base, obj, short = frame["past"], frame["base"], frame["obj"], frame["short"]
    gear, wrong = frame["gear"], frame["wrong"]
    m = frame["minutes"]
    practice, bought = frame["practice"], frame["bought"]
    rows: list[tuple[str, str, str, str]] = []

    def add(op: str, variant: int, premise: str, criterion: str, label: str) -> None:
        rows.append((op, str(variant), premise, criterion, label))

    add("full", 0, f"I {past} {obj}", practice, "SUPPORTS")
    add("full", 1, f"Today I {past} {obj}", practice, "SUPPORTS")
    add("full", 2, f"This morning I {past} {obj}", practice, "SUPPORTS")
    add("full", 3, f"I already {past} {obj}", practice, "SUPPORTS")

    add("telegraph", 0, f"{past} {short}", practice, "SUPPORTS")
    add("telegraph", 1, f"{short} done", practice, "SUPPORTS")
    add("telegraph", 2, f"done {past} {short}", practice, "SUPPORTS")

    add("duration", 0, f"{past} {obj} for {m} min", practice, "SUPPORTS")
    add("duration", 1, f"I {past} {obj} for {m} minutes", practice, "SUPPORTS")
    add("duration", 2, f"{m} min {past} {short}", practice, "SUPPORTS")

    add("slang", 0, f"knocked out {obj}", practice, "SUPPORTS")
    add("slang", 1, f"got {obj} done", practice, "SUPPORTS")
    add("slang", 2, f"crushed {obj}", practice, "SUPPORTS")

    add("typo", 0, frame["typo"], practice, "SUPPORTS")
    add("typo", 1, f"I {frame['typo']}", practice, "SUPPORTS")
    add("typo", 2, f"today I {frame['typo']}", practice, "SUPPORTS")

    add("purchase_identity", 0, f"Bought {gear}", bought, "SUPPORTS")
    add("purchase_identity", 1, f"I bought {gear}", bought, "SUPPORTS")
    add("purchase_identity", 2, f"Today I bought {gear}", bought, "SUPPORTS")

    add("negation", 0, f"I didn't {base} {obj}", practice, "DENIES")
    add("negation", 1, f"I did not {base} {obj}", practice, "DENIES")
    add("negation", 2, f"Nope I didn't {base} {obj}", practice, "DENIES")

    add("quit", 0, f"Tried to {base} {obj} but quit", practice, "DENIES")
    add("quit", 1, f"I tried to {base} {obj} and then quit", practice, "DENIES")
    add("quit", 2, f"Started to {base} {obj} but quit halfway", practice, "DENIES")

    add("contradiction", 0, f"I finished {obj}, but I didn't {base} it at all", practice, "DENIES")
    add("contradiction", 1, f"I said I finished {obj}, but I didn't actually {base} it", practice, "DENIES")
    add("contradiction", 2, f"Wrapped up {obj}, but I didn't {base} a single bit", practice, "DENIES")

    add("future", 0, f"I'll {base} {obj} tomorrow", practice, "INSUFFICIENT")
    add("future", 1, f"I will {base} {obj} tomorrow", practice, "INSUFFICIENT")
    add("future", 2, f"Tomorrow I'll {base} {obj}", practice, "INSUFFICIENT")

    add("plan", 0, f"Planning to {base} {obj} next week", practice, "INSUFFICIENT")
    add("plan", 1, f"I plan to {base} {obj} later", practice, "INSUFFICIENT")
    add("plan", 2, f"My plan is to {base} {obj} this weekend", practice, "INSUFFICIENT")

    add("almost", 0, f"I almost {past} {obj}", practice, "INSUFFICIENT")
    add("almost", 1, f"Almost {past} {obj}", practice, "INSUFFICIENT")
    add("almost", 2, f"I almost started to {base} {obj}", practice, "INSUFFICIENT")

    add("purchase", 0, f"Bought {gear}", practice, "INSUFFICIENT")
    add("purchase", 1, f"I bought {gear} today", practice, "INSUFFICIENT")
    add("purchase", 2, f"Ordered {gear} and left it boxed", practice, "INSUFFICIENT")

    add("wrong_object", 0, f"I {past} {wrong}", practice, "INSUFFICIENT")
    add("wrong_object", 1, f"{past} {wrong}", practice, "INSUFFICIENT")
    add("wrong_object", 2, f"Today I {past} {wrong}", practice, "INSUFFICIENT")

    add("vague", 0, frame["vague"], practice, "INSUFFICIENT")
    add("vague", 1, f"kinda {frame['vague']}", practice, "INSUFFICIENT")
    add("vague", 2, f"just {frame['vague']}", practice, "INSUFFICIENT")

    add("unrelated", 0, frame["unrelated"], practice, "INSUFFICIENT")
    add("unrelated", 1, f"Anyway {frame['unrelated']}", practice, "INSUFFICIENT")
    add("unrelated", 2, f"Note {frame['unrelated']}", practice, "INSUFFICIENT")

    add("junk", 0, frame["junk"], practice, "INSUFFICIENT")
    add("junk", 1, f"{frame['junk']} {frame['junk']}", practice, "INSUFFICIENT")
    add("junk", 2, f"///{frame['junk']}///", practice, "INSUFFICIENT")

    out = []
    for op, variant, premise, criterion, label in rows:
        out.append(
            {
                "id": f"train-{frame['id']}-{op}-{variant}",
                "split": "train",
                "frame_id": frame["id"],
                "operator": op,
                "premise": premise,
                "criterion": criterion,
                "label": label,
            }
        )
    return out


def _dev_examples(frame: dict[str, str]) -> list[dict[str, str]]:
    past, base, obj, short = frame["past"], frame["base"], frame["obj"], frame["short"]
    gear, wrong, m = frame["gear"], frame["wrong"], frame["minutes"]
    practice, bought = frame["practice"], frame["bought"]
    specs = [
        ("full", f"Earlier I {past} {obj} and the session was done", practice, "SUPPORTS"),
        ("telegraph", f"entry {past} {short}", practice, "SUPPORTS"),
        ("duration", f"spent {m} minutes while I {past} {obj}", practice, "SUPPORTS"),
        ("slang", f"lowkey crushed {obj}", practice, "SUPPORTS"),
        ("typo", f"tbh {frame['typo']}", practice, "SUPPORTS"),
        ("purchase_identity", f"Paid for {gear} today", bought, "SUPPORTS"),
        ("negation", f"I never {past} {obj} today", practice, "DENIES"),
        ("quit", f"Attempted to {base} {obj} then quit", practice, "DENIES"),
        ("contradiction", f"I said {obj} was finished yet I didn't {base} it", practice, "DENIES"),
        ("future", f"Going to {base} {obj} tomorrow morning", practice, "INSUFFICIENT"),
        ("plan", f"The plan for later is to {base} {obj}", practice, "INSUFFICIENT"),
        ("almost", f"Nearly {past} {obj} then stopped short", practice, "INSUFFICIENT"),
        ("purchase", f"Picked up {gear} from the shop", practice, "INSUFFICIENT"),
        ("wrong_object", f"Instead I {past} {wrong}", practice, "INSUFFICIENT"),
        ("vague", f"eh {frame['vague']}", practice, "INSUFFICIENT"),
        ("unrelated", f"Side note {frame['unrelated']}", practice, "INSUFFICIENT"),
        ("junk", f"{frame['junk']}!!", practice, "INSUFFICIENT"),
    ]
    out = []
    for op, premise, criterion, label in specs:
        out.append(
            {
                "id": f"dev-{frame['id']}-{op}",
                "split": "dev",
                "frame_id": frame["id"],
                "operator": op,
                "premise": premise,
                "criterion": criterion,
                "label": label,
            }
        )
    return out


def _shuffle(rows: list[dict[str, str]], seed: int) -> list[dict[str, str]]:
    rng = random.Random(seed)
    copy = list(rows)
    rng.shuffle(copy)
    return copy


def _write_jsonl(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def distribution(rows: list[dict[str, str]]) -> dict[str, int]:
    counts = {"SUPPORTS": 0, "DENIES": 0, "INSUFFICIENT": 0}
    for row in rows:
        counts[row["label"]] += 1
    return counts


def generate() -> dict[str, object]:
    materialized = [_materialize(frame, i) for i, frame in enumerate(frames())]
    train = []
    dev = []
    for frame in materialized:
        train.extend(_train_examples(frame))
        dev.extend(_dev_examples(frame))

    if not (4000 <= len(train) <= 8000):
        raise RuntimeError(f"train count {len(train)} is outside 4000-8000")

    train_keys = {(row["premise"], row["criterion"]) for row in train}
    dev_keys = {(row["premise"], row["criterion"]) for row in dev}
    if len(train_keys) != len(train):
        raise RuntimeError("duplicate train premise/criterion pair")
    if len(dev_keys) != len(dev):
        raise RuntimeError("duplicate dev premise/criterion pair")
    overlap = train_keys & dev_keys
    if overlap:
        raise RuntimeError(f"train/dev string overlap: {len(overlap)}")

    train_premises = {row["premise"] for row in train}
    dev_premises = {row["premise"] for row in dev}
    if train_premises & dev_premises:
        raise RuntimeError("a premise string is in both train and dev")

    train_dist = distribution(train)
    dev_dist = distribution(dev)
    if not (train_dist["INSUFFICIENT"] > train_dist["SUPPORTS"] > train_dist["DENIES"]):
        raise RuntimeError(f"train class order is wrong: {train_dist}")

    train = _shuffle(train, TRAIN_SEED)
    dev = _shuffle(dev, DEV_SEED)
    _write_jsonl(DATA / "train.jsonl", train)
    _write_jsonl(DATA / "dev.jsonl", dev)

    summary = {
        "frames": len(materialized),
        "train": {"n": len(train), "seed": TRAIN_SEED, "byLabel": train_dist},
        "dev": {"n": len(dev), "seed": DEV_SEED, "byLabel": dev_dist},
        "operators": {
            "supports": list(SUPPORT_OPS),
            "denies": list(DENY_OPS),
            "insufficient": list(INSUFFICIENT_OPS),
        },
        "pairEncoding": "premise [SEP] criterion. Criterion is the raw target, not an MNLI hypothesis.",
        "samples": {"train": train[:3], "dev": dev[:3]},
    }
    (DATA / "generation.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return summary
