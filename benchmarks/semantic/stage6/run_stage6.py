"""Stage 6 orchestrator. One process. Production files are only hashed."""

from __future__ import annotations

import hashlib
import json
import os
import platform
import subprocess
import sys
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ["HF_HOME"] = str(Path(__file__).resolve().parent / ".cache")
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"
os.environ.setdefault("OMP_NUM_THREADS", "2")
os.environ.setdefault("MKL_NUM_THREADS", "2")

from contract import (  # noqa: E402
    CRITICAL_TRAPS,
    CROSS_PREDICATE_IDS,
    DATA,
    GATE_SAME_PREDICATE_RECALL,
    MODEL_ID,
    PRODUCTION_FILES,
    RESULTS,
    STAGE5_REFERENCES,
)
from generate import generate  # noqa: E402
from leakage import audit, norm  # noqa: E402
from metrics import (  # noqa: E402
    gate_report,
    precision_gap,
    same_predicate_rows,
    score_locked,
)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def _production_hashes() -> dict[str, str]:
    return {rel: _sha256(ROOT / rel) for rel in PRODUCTION_FILES}


def _git_status() -> str:
    return subprocess.check_output(["git", "status", "--short"], cwd=ROOT, text=True)


def _export_locked() -> None:
    tsc = ROOT / "node_modules" / ".bin" / "tsc"
    subprocess.check_call(
        [str(tsc), "-p", "tsconfig.benchmark.json", "--pretty", "false", "--incremental", "false"],
        cwd=ROOT,
    )
    compiled = (
        ROOT
        / "benchmarks"
        / "semantic"
        / ".compiled"
        / "benchmarks"
        / "semantic"
        / "stage6"
        / "export-locked.js"
    )
    subprocess.check_call(["node", str(compiled)], cwd=ROOT)


def _write_preregistration(locked: list[dict]) -> list[dict]:
    resolved = []
    for trap in CRITICAL_TRAPS:
        want_p = norm(trap["premise"])
        want_c = norm(trap["criterion"])
        hits = []
        for row in locked:
            premise = norm(row["text"])
            target = norm(row["target"])
            if target == want_c and (premise == want_p or premise.startswith(want_p + " ")):
                hits.append(row["id"])
        if len(hits) < 1:
            raise RuntimeError(f"trap did not resolve: {trap} -> {hits}")
        resolved.append({**trap, "matchIds": hits})
    payload = {
        "writtenBeforeTraining": True,
        "modelId": MODEL_ID,
        "initializedFromMnli": False,
        "labels": ["SUPPORTS", "DENIES", "INSUFFICIENT"],
        "decisionRule": {
            "supports": "P(SUPPORTS) >= 0.50 and strictly largest",
            "denies": "else P(DENIES) >= 0.50 and greater than P(SUPPORTS) and >= P(INSUFFICIENT)",
            "else": "INSUFFICIENT",
            "thresholdTunedOnLockedTest": False,
        },
        "criticalTraps": resolved,
        "crossPredicateIdsExcludedFromRecallGate": list(CROSS_PREDICATE_IDS),
        "devSelectsEpoch": True,
        "devSelectsThreshold": False,
    }
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "preregistration.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return resolved


def _write_subset(locked: list[dict]) -> dict:
    rows = same_predicate_rows(locked)
    by_slice: dict[str, int] = {}
    for row in rows:
        by_slice[row["slice"]] = by_slice.get(row["slice"], 0) + 1
    excluded = [row["id"] for row in locked if row["id"] in CROSS_PREDICATE_IDS]
    payload = {
        "writtenBeforeTraining": True,
        "n": len(rows),
        "bySlice": by_slice,
        "ids": [row["id"] for row in rows],
        "excludedCrossPredicateIds": excluded,
        "excludedReason": "Cross-predicate evidence is reported and is not part of the recall gate.",
    }
    (RESULTS / "same-predicate-subset.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    if len(rows) < 20:
        raise RuntimeError(f"same-predicate subset is unexpectedly small: {len(rows)}")
    return payload


def _versions() -> dict[str, str]:
    out = {"python": platform.python_version(), "platform": platform.platform()}
    for package in ("torch", "transformers", "peft", "numpy"):
        try:
            out[package] = version(package)
        except Exception:
            out[package] = "not-imported"
    return out


def _condition_authorization(metrics: dict) -> dict:
    traps = metrics["criticalTrapSupports"]
    recall = metrics["samePredicateRecall"]
    if traps > 0:
        return {
            "loraAuthorized": False,
            "case": 1,
            "reason": "Head-only predicted SUPPORTS on a must-not-support critical trap.",
        }
    if recall is not None and recall >= GATE_SAME_PREDICATE_RECALL:
        return {
            "loraAuthorized": False,
            "case": 2,
            "reason": "Head-only critical traps were clean and same-predicate recall met 0.75.",
        }
    return {
        "loraAuthorized": True,
        "case": 3,
        "reason": "Head-only critical traps were clean and same-predicate recall stayed under 0.75.",
    }


def _conclude(head_gates: dict, head_metrics: dict, lora_gates: dict | None, lora_metrics: dict | None, ran_lora: bool) -> dict:
    final_gates = lora_gates or head_gates
    final_metrics = lora_metrics or head_metrics
    if final_gates["all"]["pass"]:
        code = "pair_model_stage7"
        text = (
            "A Stage 6 condition passed every gate. Stage 7 is justified as a question about "
            "whether this pair model can stand alone or whether embeddings still add paraphrase recovery. "
            "Stage 7 was not started."
        )
    elif final_metrics["criticalTrapSupports"] > 0:
        code = "abandon_critical_trap"
        text = (
            "A critical trap was supported. The small synthetic cross-encoder direction should be abandoned. "
            "A larger MNLI model was not tried."
        )
    elif not final_gates["explicitNegation"]["pass"]:
        code = "abandon_negation"
        text = (
            "Explicit-negation safety fell below the gate. The small synthetic cross-encoder direction "
            "should be abandoned."
        )
    elif not final_gates["precisionGap"]["pass"]:
        code = "abandon_gap"
        text = (
            "The train-versus-locked-test support precision gap was above 0.25. "
            "The result is not a product signal, and this adaptation direction should be abandoned."
        )
    elif ran_lora and (final_metrics["samePredicateRecall"] is None or final_metrics["samePredicateRecall"] <= 0.50):
        code = "abandon_recall"
        text = (
            "Same-predicate recall stayed at or below 0.50 after the allowed LoRA run. "
            "The small synthetic cross-encoder direction should be abandoned."
        )
    elif (
        final_metrics["criticalTrapSupports"] == 0
        and final_gates["explicitNegation"]["pass"]
        and (final_metrics["samePredicateRecall"] is None or final_metrics["samePredicateRecall"] < 0.75)
    ):
        code = "hybrid_stage7"
        text = (
            "Denial safety and the critical traps held, and same-predicate recall stayed under 0.75. "
            "Stage 6 supports investigating a hybrid in Stage 7. That hybrid was not built."
        )
    else:
        code = "fail_not_authorized_to_continue"
        text = (
            "Stage 6 did not pass every gate, and the failure is not one of the pre-registered abandon or "
            "hybrid outcomes. LoRA was not used to chase the miss. Production stays frozen."
        )
    return {"code": code, "text": text}


def _round(value):
    if isinstance(value, float):
        return round(value, 4)
    return value


def _summarize_metrics(metrics: dict, gap, gates: dict) -> dict:
    return {
        "criticalTrapSupports": metrics["criticalTrapSupports"],
        "swapControlOk": metrics["swapControlOk"],
        "unsafeFalseSupports": metrics["unsafeFalseSupports"],
        "unsafeN": metrics["unsafeN"],
        "samePredicateN": metrics["samePredicateN"],
        "samePredicateHits": metrics["samePredicateHits"],
        "samePredicateRecall": _round(metrics["samePredicateRecall"]),
        "negationSupports": metrics["negationSupports"],
        "negationNotSupports": metrics["negationNotSupports"],
        "negationN": metrics["negationN"],
        "attemptedContradictoryFalseSupports": metrics["attemptedContradictoryFalseSupports"],
        "crossPredicate": metrics["crossPredicate"],
        "implausibleVolume": metrics["implausibleVolume"],
        "supportPrecision": _round(metrics["supportPrecision"]),
        "precisionGap": _round(gap) if isinstance(gap, float) else gap,
        "confusion": metrics["confusion"],
        "bySlice": metrics["bySlice"],
        "gates": gates,
        "criticalTraps": metrics["criticalTraps"],
        "unsafeSupportIds": metrics["unsafeSupportIds"],
    }


def _stage5_same_predicate(locked_ids: set[str]) -> dict:
    """Recompute the reference recall from stored Stage 5 rows. No model rerun."""
    out = {}
    for name in ("distilbert", "mobilebert"):
        path = ROOT / "benchmarks" / "semantic" / "results" / "phase1-stage5-experiments" / f"{name}.json"
        payload = json.loads(path.read_text(encoding="utf-8"))
        rows = [row for row in payload["rows"] if row["id"] in locked_ids]
        hits = sum(1 for row in rows if row["decision"] == "SUPPORTS")
        out[name] = {"n": len(rows), "hits": hits, "recall": round(hits / len(rows), 4) if rows else None}
    return out


def main() -> None:
    os_env_note = "single process"
    print("stage 6 start", flush=True)
    hashes_before = _production_hashes()
    _export_locked()
    locked = json.loads((DATA / "locked-test.json").read_text(encoding="utf-8"))["examples"]
    if len(locked) != 189:
        raise RuntimeError(f"locked arena is {len(locked)}, expected 189")
    traps = _write_preregistration(locked)
    subset = _write_subset(locked)
    print(f"same-predicate subset n={subset['n']} before training", flush=True)
    generation = generate()
    print(f"generated train={generation['train']['n']} dev={generation['dev']['n']}", flush=True)
    leakage = audit()
    print(f"leakage passed={leakage['passed']} checks={leakage['checks']}", flush=True)
    if not leakage["passed"]:
        print("LEAKAGE AUDIT FAILED. No training.", flush=True)
        raise SystemExit(1)
    (RESULTS / "leakage-audit.json").write_text(
        json.dumps(leakage, indent=2),
        encoding="utf-8",
    )

    from train import RssGuard, run_head_only, run_lora, score_locked_with_head, score_locked_with_lora

    guard = RssGuard()
    head_bundle = run_head_only(guard)
    head_scored, head_latency = score_locked_with_head(head_bundle["head"], guard)
    head_metrics = score_locked(head_scored, traps)
    head_gap = precision_gap(head_bundle["trainPrecision"], head_metrics["supportPrecision"])
    head_gates = gate_report(head_metrics, head_gap)
    authorization = _condition_authorization(head_metrics)
    head_result = _summarize_metrics(head_metrics, head_gap, head_gates)
    head_result["trainPrecision"] = head_bundle["trainPrecision"]
    head_result["selectedEpoch"] = head_bundle["trainMeta"]["selectedEpoch"]
    head_result["latency"] = head_latency
    head_result["authorization"] = authorization
    (RESULTS / "head-only-metrics.json").write_text(json.dumps(head_result, indent=2), encoding="utf-8")
    print(
        f"head traps={head_metrics['criticalTrapSupports']} "
        f"unsafe={head_metrics['unsafeFalseSupports']} "
        f"recall={head_metrics['samePredicateRecall']} "
        f"lora={authorization['loraAuthorized']}",
        flush=True,
    )

    lora_result = None
    lora_gates = None
    lora_metrics = None
    if authorization["loraAuthorized"]:
        # Drop the head-only tensor before loading LoRA.
        del head_bundle
        import gc

        gc.collect()
        lora_bundle = run_lora(guard)
        lora_scored, lora_latency = score_locked_with_lora(lora_bundle, guard)
        lora_metrics = score_locked(lora_scored, traps)
        lora_gap = precision_gap(lora_bundle["trainPrecision"], lora_metrics["supportPrecision"])
        lora_gates = gate_report(lora_metrics, lora_gap)
        lora_result = _summarize_metrics(lora_metrics, lora_gap, lora_gates)
        lora_result["trainPrecision"] = lora_bundle["trainPrecision"]
        lora_result["selectedEpoch"] = lora_bundle["trainMeta"]["selectedEpoch"]
        lora_result["latency"] = lora_latency
        (RESULTS / "lora-metrics.json").write_text(json.dumps(lora_result, indent=2), encoding="utf-8")

    conclusion = _conclude(
        head_gates,
        head_metrics,
        lora_gates,
        lora_metrics,
        authorization["loraAuthorized"],
    )
    hashes_after = _production_hashes()
    references = _stage5_same_predicate(set(subset["ids"]))
    summary = {
        "stage": 6,
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "productionFrozen": hashes_before == hashes_after,
        "productionHashesBefore": hashes_before,
        "productionHashesAfter": hashes_after,
        "versions": _versions(),
        "modelId": MODEL_ID,
        "initializedFromMnli": False,
        "generation": {key: generation[key] for key in ("frames", "train", "dev", "operators", "pairEncoding")},
        "leakage": {"passed": leakage["passed"], "checks": leakage["checks"]},
        "samePredicateSubset": {"n": subset["n"], "bySlice": subset["bySlice"]},
        "headOnly": head_result,
        "loraAuthorized": authorization,
        "lora": lora_result,
        "stage5SamePredicateReference": references,
        "stage5FrozenReferences": STAGE5_REFERENCES,
        "conclusion": conclusion,
        "peakRssMb": guard.peak,
        "processNote": os_env_note,
        "gitStatus": _git_status(),
    }
    (RESULTS / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    (RESULTS / "SUMMARY.md").write_text(_markdown(summary), encoding="utf-8")
    print(conclusion["text"], flush=True)
    print(f"peak rss {guard.peak} MB", flush=True)


def _markdown(summary: dict) -> str:
    head = summary["headOnly"]
    lines = [
        "# Stage 6 report",
        "",
        f"Generated: {summary['generatedAt']}",
        "",
        "## Conclusion",
        "",
        summary["conclusion"]["text"],
        "",
        f"Code: `{summary['conclusion']['code']}`",
        "",
        "## Head-only",
        "",
        f"- Selected epoch: {head['selectedEpoch']}",
        f"- Critical-trap supports: {head['criticalTrapSupports']}",
        f"- Swap control ok: {head['swapControlOk']}",
        f"- Unsafe false supports: {head['unsafeFalseSupports']} / {head['unsafeN']}",
        f"- Same-predicate recall: {head['samePredicateRecall']} on n={head['samePredicateN']}",
        f"- Negation supports: {head['negationSupports']} of {head['negationN']}",
        f"- Attempted/contradictory false supports: {head['attemptedContradictoryFalseSupports']}",
        f"- Train support precision: {head['trainPrecision']}",
        f"- Locked-test support precision: {head['supportPrecision']}",
        f"- Precision gap: {head['precisionGap']}",
        f"- LoRA authorized: {summary['loraAuthorized']['loraAuthorized']} ({summary['loraAuthorized']['reason']})",
        "",
        "## Gates",
        "",
    ]
    for name, gate in head["gates"].items():
        if name == "criticalTraps":
            continue
        lines.append(f"- {name}: pass={gate.get('pass')} value={gate.get('value')}")
    if summary["lora"]:
        lora = summary["lora"]
        lines.extend(
            [
                "",
                "## LoRA",
                "",
                f"- Selected epoch: {lora['selectedEpoch']}",
                f"- Critical-trap supports: {lora['criticalTrapSupports']}",
                f"- Unsafe false supports: {lora['unsafeFalseSupports']}",
                f"- Same-predicate recall: {lora['samePredicateRecall']}",
                f"- Precision gap: {lora['precisionGap']}",
            ]
        )
    lines.extend(
        [
            "",
            "## Resources",
            "",
            f"- Peak RSS MB: {summary['peakRssMb']}",
            f"- Production hashes unchanged: {summary['productionFrozen']}",
            "",
        ]
    )
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    main()
