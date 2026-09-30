"""Fixed decision rule and Stage 6 metrics."""

from __future__ import annotations

from contract import (
    ABANDON_RECALL_AT_OR_BELOW,
    ATTEMPTED_SLICES,
    CROSS_PREDICATE_IDS,
    DENY_THRESHOLD,
    GATE_CRITICAL_TRAP_SUPPORTS,
    GATE_NEGATION_N,
    GATE_NEGATION_NOT_SUPPORT_MIN,
    GATE_NEGATION_SUPPORTS,
    GATE_PRECISION_GAP,
    GATE_SAME_PREDICATE_RECALL,
    GATE_UNSAFE_FALSE_SUPPORTS,
    GOLD_MAP,
    LABELS,
    NEGATION_SLICE,
    SAME_PREDICATE_SLICES,
    SUPPORT_THRESHOLD,
)


def decide(probs: dict[str, float]) -> str:
    supports = probs["SUPPORTS"]
    denies = probs["DENIES"]
    insufficient = probs["INSUFFICIENT"]
    if supports >= SUPPORT_THRESHOLD and supports > denies and supports > insufficient:
        return "SUPPORTS"
    if denies >= DENY_THRESHOLD and denies > supports and denies >= insufficient:
        return "DENIES"
    return "INSUFFICIENT"


def _self_check() -> None:
    assert decide({"SUPPORTS": 0.51, "DENIES": 0.20, "INSUFFICIENT": 0.29}) == "SUPPORTS"
    assert decide({"SUPPORTS": 0.49, "DENIES": 0.30, "INSUFFICIENT": 0.21}) == "INSUFFICIENT"
    assert decide({"SUPPORTS": 0.20, "DENIES": 0.60, "INSUFFICIENT": 0.20}) == "DENIES"
    assert decide({"SUPPORTS": 0.50, "DENIES": 0.50, "INSUFFICIENT": 0.00}) == "INSUFFICIENT"
    assert decide({"SUPPORTS": 0.00, "DENIES": 0.50, "INSUFFICIENT": 0.50}) == "DENIES"


_self_check()


def confusion(rows: list[dict]) -> dict[str, int]:
    matrix = {f"{gold}->{pred}": 0 for gold in LABELS for pred in LABELS}
    for row in rows:
        matrix[f"{row['goldLabel']}->{row['decision']}"] += 1
    return matrix


def support_precision(rows: list[dict]) -> float | None:
    predicted = [row for row in rows if row["decision"] == "SUPPORTS"]
    if not predicted:
        return None
    correct = sum(1 for row in predicted if row["goldLabel"] == "SUPPORTS")
    return correct / len(predicted)


def support_recall(rows: list[dict]) -> float | None:
    gold = [row for row in rows if row["goldLabel"] == "SUPPORTS"]
    if not gold:
        return None
    hit = sum(1 for row in gold if row["decision"] == "SUPPORTS")
    return hit / len(gold)


def false_support_count(rows: list[dict]) -> int:
    return sum(1 for row in rows if row["decision"] == "SUPPORTS" and row["goldLabel"] != "SUPPORTS")


def dev_score(rows: list[dict]) -> dict[str, float | int | None]:
    recall = support_recall(rows)
    nonsupport = [row for row in rows if row["goldLabel"] != "SUPPORTS"]
    false_supports = false_support_count(rows)
    rate = false_supports / len(nonsupport) if nonsupport else 0.0
    score = (recall or 0.0) - 2.0 * rate
    return {
        "supportRecall": recall,
        "falseSupports": false_supports,
        "falseSupportRate": rate,
        "score": score,
        "n": len(rows),
    }


def same_predicate_rows(locked_rows: list[dict]) -> list[dict]:
    """Gold completions in the paraphrase slices, excluding implausible volume
    and the pre-registered cross-predicate ids.

    N-PAIR-OCHEM-YES sits in slice `paraphrase` and N-PARA-VID sits in `noisy`,
    but section 7 keeps those evidence relations out of the pass/fail gate.
    """
    out = []
    for row in locked_rows:
        if row.get("id") in CROSS_PREDICATE_IDS:
            continue
        if row.get("gold") != "entails":
            continue
        if row.get("slice") not in SAME_PREDICATE_SLICES:
            continue
        if row.get("productCaution") == "implausible_volume" or row.get("slice") == "implausible_volume":
            continue
        out.append(row)
    return out


def score_locked(scored: list[dict], traps: list[dict]) -> dict:
    """scored rows need goldLabel, decision, slice, id, unsafeIfSupports, productCaution."""
    critical = []
    critical_supports = 0
    swap_ok = True
    for trap in traps:
        match_ids = trap.get("matchIds") or [trap["matchId"]]
        matches = [row for row in scored if row["id"] in match_ids]
        if len(matches) != len(match_ids):
            raise RuntimeError(f"trap rows missing for {trap['premise']}")
        supported_rows = [row for row in matches if row["decision"] == "SUPPORTS"]
        supported = bool(supported_rows)
        ok = supported if trap["expect"] == "SUPPORT" else not supported
        if trap["expect"] == "NOT_SUPPORT" and supported:
            critical_supports += 1
        if trap["expect"] == "SUPPORT" and not supported:
            swap_ok = False
        critical.append(
            {
                "premise": trap["premise"],
                "criterion": trap["criterion"],
                "expect": trap["expect"],
                "matchIds": match_ids,
                "decisions": {row["id"]: row["decision"] for row in matches},
                "probs": {row["id"]: row["probs"] for row in matches},
                "ok": ok,
            }
        )

    unsafe_rows = [row for row in scored if row.get("unsafeIfSupports")]
    unsafe_supports = [row for row in unsafe_rows if row["decision"] == "SUPPORTS"]
    same_rows = same_predicate_rows(scored)
    same_hits = sum(1 for row in same_rows if row["decision"] == "SUPPORTS")
    same_recall = same_hits / len(same_rows) if same_rows else None

    negation = [row for row in scored if row.get("slice") == NEGATION_SLICE]
    negation_supports = sum(1 for row in negation if row["decision"] == "SUPPORTS")
    negation_not = len(negation) - negation_supports

    attempted = [row for row in scored if row.get("slice") in ATTEMPTED_SLICES]
    attempted_false = [
        row for row in attempted if row["decision"] == "SUPPORTS" and row["goldLabel"] != "SUPPORTS"
    ]

    cross = [row for row in scored if row["id"] in CROSS_PREDICATE_IDS]
    volume = [row for row in scored if row.get("slice") == "implausible_volume" or row.get("productCaution") == "implausible_volume"]

    by_slice: dict[str, dict] = {}
    slices = sorted({row.get("slice") or "" for row in scored})
    for slice_name in slices:
        subset = [row for row in scored if row.get("slice") == slice_name]
        by_slice[slice_name] = {
            "n": len(subset),
            "falseSupports": false_support_count(subset),
            "supportRecall": support_recall(subset),
            "supports": sum(1 for row in subset if row["decision"] == "SUPPORTS"),
        }

    return {
        "criticalTraps": critical,
        "criticalTrapSupports": critical_supports,
        "swapControlOk": swap_ok,
        "unsafeFalseSupports": len(unsafe_supports),
        "unsafeN": len(unsafe_rows),
        "unsafeSupportIds": [row["id"] for row in unsafe_supports],
        "samePredicateN": len(same_rows),
        "samePredicateHits": same_hits,
        "samePredicateRecall": same_recall,
        "negationN": len(negation),
        "negationSupports": negation_supports,
        "negationNotSupports": negation_not,
        "attemptedContradictoryN": len(attempted),
        "attemptedContradictoryFalseSupports": len(attempted_false),
        "attemptedContradictoryFalseIds": [row["id"] for row in attempted_false],
        "crossPredicate": [
            {
                "id": row["id"],
                "text": row.get("text"),
                "target": row.get("target"),
                "gold": row.get("gold"),
                "decision": row["decision"],
                "probs": row["probs"],
            }
            for row in cross
        ],
        "implausibleVolume": [
            {
                "id": row["id"],
                "text": row.get("text"),
                "target": row.get("target"),
                "decision": row["decision"],
                "probs": row["probs"],
            }
            for row in volume
        ],
        "confusion": confusion(scored),
        "bySlice": by_slice,
        "supportPrecision": support_precision(scored),
        "supportRecallAllGoldSupports": support_recall(scored),
        "predictedSupports": sum(1 for row in scored if row["decision"] == "SUPPORTS"),
    }


def precision_gap(train_precision: float | None, test_precision: float | None) -> float | None:
    if train_precision is None or test_precision is None:
        return None
    return train_precision - test_precision


def gate_report(metrics: dict, gap: float | None) -> dict[str, dict]:
    same = metrics["samePredicateRecall"]
    negation_ok = (
        metrics["negationSupports"] == GATE_NEGATION_SUPPORTS
        and metrics["negationN"] == GATE_NEGATION_N
        and metrics["negationNotSupports"] >= GATE_NEGATION_NOT_SUPPORT_MIN
    )
    gap_ok = gap is not None and gap <= GATE_PRECISION_GAP
    gates = {
        "criticalTrapSupports": {
            "value": metrics["criticalTrapSupports"],
            "gate": f"== {GATE_CRITICAL_TRAP_SUPPORTS}",
            "pass": metrics["criticalTrapSupports"] == GATE_CRITICAL_TRAP_SUPPORTS,
        },
        "swapControl": {
            "value": metrics["swapControlOk"],
            "gate": "reported control; not part of the section-13 pass rule",
            "pass": metrics["swapControlOk"],
            "countsTowardStage6Pass": False,
        },
        "unsafeFalseSupports": {
            "value": metrics["unsafeFalseSupports"],
            "gate": f"<= {GATE_UNSAFE_FALSE_SUPPORTS}",
            "pass": metrics["unsafeFalseSupports"] <= GATE_UNSAFE_FALSE_SUPPORTS,
        },
        "samePredicateRecall": {
            "value": same,
            "gate": f">= {GATE_SAME_PREDICATE_RECALL}",
            "pass": same is not None and same >= GATE_SAME_PREDICATE_RECALL,
        },
        "explicitNegation": {
            "value": {
                "supports": metrics["negationSupports"],
                "notSupports": metrics["negationNotSupports"],
                "n": metrics["negationN"],
            },
            "gate": f"0 supports and at least {GATE_NEGATION_NOT_SUPPORT_MIN}/{GATE_NEGATION_N} not SUPPORTS",
            "pass": negation_ok,
        },
        "attemptedContradictory": {
            "value": metrics["attemptedContradictoryFalseSupports"],
            "gate": "== 0",
            "pass": metrics["attemptedContradictoryFalseSupports"] == 0,
        },
        "precisionGap": {
            "value": gap,
            "gate": f"<= {GATE_PRECISION_GAP}",
            "pass": gap_ok,
        },
    }
    gates["all"] = {
        "pass": all(
            item["pass"]
            for key, item in gates.items()
            if key != "all" and item.get("countsTowardStage6Pass", True)
        )
    }
    return gates


def recall_at_or_below_abandon(recall: float | None) -> bool:
    return recall is None or recall <= ABANDON_RECALL_AT_OR_BELOW


def attach_gold(locked_row: dict) -> str:
    return GOLD_MAP[locked_row["gold"]]
