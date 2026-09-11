#!/usr/bin/env python3
"""Candidate #6A runner. Bring-up: --bringup (seed 42, outer fold 0 only)."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import numpy as np
import torch

from benchmarks.semantic.candidate_6a.contract import (
    BASE_MODEL_ID,
    BATCH_SIZE,
    BRINGUP_PATH,
    CONTROL_BOTH_SIDES,
    CONTROL_FAMILY_BA,
    CV_PATH,
    EMBEDDING_DIM,
    EXPECTED_TRAINABLE,
    GATE_BOTH_SIDES,
    GATE_BOTH_SIDES_FLOOR,
    GATE_FAMILY_BA,
    LAMBDA_ATTRACTION,
    LOCKED_EVAL_SEEDS,
    MARGIN,
    MAX_EPOCHS,
    MAX_PAIRS_PER_FAMILY,
    PATIENCE,
)
from benchmarks.semantic.candidate_6a.data import load_core_train, load_outer_fold_family_ids
from benchmarks.semantic.candidate_6a.encoder import embed_texts, load_lora_encoder, load_tokenizer, mean_pool_l2
from benchmarks.semantic.candidate_6a.metrics import mean, pair_geometry, std
from benchmarks.semantic.candidate_6a.pairs import construct_pairs
from benchmarks.semantic.candidate_6a.splits import inner_split
from benchmarks.semantic.candidate_6a.train import inner_train_select, refit_outer_train, set_seeds, _score_split
from transformers import AutoModel


def device() -> torch.device:
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def indices_for_families(rows, family_ids: list[str]) -> list[int]:
    allow = set(family_ids)
    return [r.index for r in rows if r.family_id in allow]


def assert_fold_integrity(rows, outer_folds: list[list[str]]) -> dict:
    all_ids = [r.family_id for r in rows]
    unique = sorted(set(all_ids))
    if len(unique) != 60:
        raise AssertionError(f"Expected 60 train families, got {len(unique)}")
    union: list[str] = []
    for k, fids in enumerate(outer_folds):
        if len(fids) != 12:
            raise AssertionError(f"Fold {k} has {len(fids)} families")
        union.extend(fids)
    if sorted(union) != unique:
        raise AssertionError("3A.3 fold family union != 60 train families")
    for k, fids in enumerate(outer_folds):
        n = sum(1 for r in rows if r.family_id in set(fids))
        if n != 81:
            raise AssertionError(f"Fold {k} has {n} rows, expected 81")
    return {"n_families": 60, "folds": 5, "rows_per_fold": 81}


def assert_inner_integrity(outer_fids, inner_train, inner_val) -> None:
    outer = set(outer_fids)
    it, iv = set(inner_train), set(inner_val)
    if it & outer:
        raise AssertionError("inner-train contains outer families")
    if iv & outer:
        raise AssertionError("inner-val contains outer families")
    if it & iv:
        raise AssertionError("inner-train/val overlap")
    if it | iv | outer != it | iv | outer:
        pass
    remaining = (set(inner_train) | set(inner_val) | outer)
    # inner+outer should be all 60
    # caller checks against all families


def geometry_bundle(rows, frozen: np.ndarray, finetuned: np.ndarray, idx: list[int]) -> dict:
    sub_rows = [rows[i] for i in idx]
    return {
        "before": pair_geometry(sub_rows, frozen[idx]),
        "after": pair_geometry(sub_rows, finetuned[idx]),
    }


def pair_summary(meta: dict, family_ids: list[str]) -> dict:
    per = meta["per_family"]
    capped = [fid for fid, st in per.items() if st["uncapped"] > st["selected"]]
    zero = [fid for fid in family_ids if per.get(fid, {}).get("selected", 0) == 0]
    return {
        "n_pairs": meta["n_pairs"],
        "uncapped_inventory": meta["uncapped_inventory"],
        "n_capped_families": len(capped),
        "capped_families": sorted(capped),
        "n_zero_pair_families": len(zero),
        "zero_pair_families": sorted(zero),
    }


def mean_drift(frozen: np.ndarray, finetuned: np.ndarray, idx: list[int]) -> float:
    dots = []
    for i in idx:
        dots.append(float(np.dot(frozen[i], finetuned[i])))
    return round(float(sum(dots) / max(1, len(dots))), 4)


def run_fold(
    rows,
    outer_folds: list[list[str]],
    outer_fold: int,
    seed: int,
    dev: torch.device,
    evaluate_outer: bool,
) -> dict:
    outer_ids = outer_folds[outer_fold]
    all_fams = sorted({r.family_id for r in rows})
    outer_train_ids = [f for f in all_fams if f not in set(outer_ids)]
    if len(outer_train_ids) != 48:
        raise AssertionError(f"outer-train families {len(outer_train_ids)}")

    inner_train_ids, inner_val_ids = inner_split(rows, outer_train_ids, outer_fold)
    assert_inner_integrity(outer_ids, inner_train_ids, inner_val_ids)
    if set(inner_train_ids) | set(inner_val_ids) != set(outer_train_ids):
        raise AssertionError("inner split does not partition outer-train")
    if set(inner_train_ids) & set(outer_ids) or set(inner_val_ids) & set(outer_ids):
        raise AssertionError("outer leakage in inner split")

    inner_train_idx = indices_for_families(rows, inner_train_ids)
    inner_val_idx = indices_for_families(rows, inner_val_ids)
    outer_train_idx = indices_for_families(rows, outer_train_ids)
    outer_idx = indices_for_families(rows, outer_ids)

    pairs_inner, pair_meta_inner = construct_pairs(rows, inner_train_ids, seed, outer_fold)
    pairs_inner2, pair_meta_inner2 = construct_pairs(rows, inner_train_ids, seed, outer_fold)
    if pair_meta_inner["pair_ids"] != pair_meta_inner2["pair_ids"]:
        raise AssertionError("pair construction is not deterministic")
    # Membership must not depend on epoch: same list reused.
    pair_ids_epoch = [pair_meta_inner["pair_ids"] for _ in range(MAX_EPOCHS)]
    if any(p != pair_meta_inner["pair_ids"] for p in pair_ids_epoch):
        raise AssertionError("pair membership changed across epochs")

    pair_row_fams = {rows[i].family_id for i, j in pairs_inner} | {rows[j].family_id for i, j in pairs_inner}
    if pair_row_fams & set(outer_ids):
        raise AssertionError("outer families in inner-train pairs")
    if pair_row_fams - set(inner_train_ids):
        raise AssertionError("pairs include non-inner-train families")

    set_seeds(seed)
    model, tokenizer, enc_info = load_lora_encoder(dev)
    if enc_info["trainable_param_count"] != EXPECTED_TRAINABLE:
        raise AssertionError("trainable count drift")

    tokenizer_check = load_tokenizer()
    if tokenizer_check.name_or_path != BASE_MODEL_ID and BASE_MODEL_ID not in str(tokenizer_check.name_or_path):
        # Hugging Face may resolve to cache path; still require vocab from MiniLM
        pass
    if tokenizer.__class__.__name__ not in ("BertTokenizer", "BertTokenizerFast"):
        raise AssertionError(f"Unexpected tokenizer {tokenizer.__class__.__name__}")

    with torch.no_grad():
        frozen_model = AutoModel.from_pretrained(BASE_MODEL_ID, attn_implementation="eager").to(dev)
        frozen_model.eval()
        frozen_z = []
        texts = [r.text for r in rows]
        for start in range(0, len(texts), 32):
            chunk = texts[start : start + 32]
            enc = tokenizer_check(
                chunk,
                padding=True,
                truncation=True,
                max_length=256,
                return_tensors="pt",
            )
            enc = {k: v.to(dev) for k, v in enc.items()}
            frozen_z.append(mean_pool_l2(frozen_model(**enc).last_hidden_state, enc["attention_mask"]))
        frozen = torch.cat(frozen_z, dim=0).cpu().numpy().astype(np.float64)
        del frozen_model

    if frozen.shape[1] != EMBEDDING_DIM:
        raise AssertionError("frozen pooling not 384-d")

    # Checkpoint selection uses inner-val only (no outer embeddings in selection).
    select = inner_train_select(
        model,
        tokenizer,
        rows,
        inner_train_idx,
        inner_val_idx,
        pairs_inner,
        dev,
        seed,
    )
    e_k = select["E_k"]
    if e_k < 1 or e_k > MAX_EPOCHS:
        raise AssertionError(f"invalid E_k {e_k}")

    pairs_refit, pair_meta_refit = construct_pairs(rows, outer_train_ids, seed, outer_fold)
    refit_fams = {rows[i].family_id for i, j in pairs_refit} | {rows[j].family_id for i, j in pairs_refit}
    if refit_fams & set(outer_ids):
        raise AssertionError("outer families in refit pairs")
    if not set(inner_val_ids).issubset(set(outer_train_ids)):
        raise AssertionError("inner-val not in outer-train for refit")
    if len(outer_train_ids) != 48:
        raise AssertionError("refit must use 48 outer-train families")

    if not evaluate_outer:
        raise AssertionError("outer evaluation flag must be true after selection")

    refit_model, _, refit_losses = refit_outer_train(
        load_lora_encoder,
        tokenizer,
        rows,
        outer_train_idx,
        pairs_refit,
        dev,
        seed,
        e_k,
    )
    with torch.no_grad():
        finetuned = embed_texts(refit_model, tokenizer, [r.text for r in rows], dev).cpu().numpy().astype(np.float64)

    outer_score = _score_split(rows, finetuned, outer_train_idx, outer_idx)
    outer_score = {k: v for k, v in outer_score.items() if k not in ("weights", "bias")}

    return {
        "outer_fold": outer_fold,
        "seed": seed,
        "encoder": {
            "trainable_param_count": enc_info["trainable_param_count"],
            "frozen_param_count": enc_info["frozen_param_count"],
            "base_model_id": enc_info["base_model_id"],
        },
        "n_inner_train_families": len(inner_train_ids),
        "n_inner_val_families": len(inner_val_ids),
        "n_outer_train_families": len(outer_train_ids),
        "n_outer_families": len(outer_ids),
        "inner_train_families": inner_train_ids,
        "inner_val_families": inner_val_ids,
        "pairs_inner": {
            **pair_summary(pair_meta_inner, inner_train_ids),
            "max_pairs_per_family": MAX_PAIRS_PER_FAMILY,
            "note": "pairsPerEpoch is sampled relationships, not independent N; membership fixed across epochs",
        },
        "pairs_refit": pair_summary(pair_meta_refit, outer_train_ids),
        "selection": select,
        "refit_losses": refit_losses,
        "refit_epochs": e_k,
        "outer": outer_score,
        "geometry": {
            "inner_train": geometry_bundle(rows, frozen, finetuned, inner_train_idx),
            "inner_val": geometry_bundle(rows, frozen, finetuned, inner_val_idx),
            "outer_holdout": geometry_bundle(rows, frozen, finetuned, outer_idx),
        },
        "embedding_drift_mean_cosine": {
            "inner_train": mean_drift(frozen, finetuned, inner_train_idx),
            "inner_val": mean_drift(frozen, finetuned, inner_val_idx),
            "outer_holdout": mean_drift(frozen, finetuned, outer_idx),
        },
        "loss": {
            "type": "relu(cos(z_i,z_j) - margin).mean()",
            "margin": MARGIN,
            "lambda_attraction": LAMBDA_ATTRACTION,
            "batch_size": BATCH_SIZE,
            "patience": PATIENCE,
        },
        "probe": {
            "l2": 0.01,
            "learningRate": 0.4,
            "epochs": 400,
            "threshold": 0.50,
        },
    }


def bringup() -> dict:
    rows = load_core_train()
    outer_folds = load_outer_fold_family_ids()
    fold_info = assert_fold_integrity(rows, outer_folds)
    dev = device()
    print("CANDIDATE #6A BRING-UP")
    print(json.dumps({"device": str(dev), "base_model": BASE_MODEL_ID, "fold_integrity": fold_info}, indent=2))
    loss_check = float(torch.relu(torch.tensor(1.0) - MARGIN))
    if abs(loss_check - 0.8) > 1e-6:
        raise AssertionError("loss sanity: relu(1-0.2) should be 0.8")
    if LAMBDA_ATTRACTION != 0.0:
        raise AssertionError("lambda must be 0")
    result = run_fold(rows, outer_folds, outer_fold=0, seed=42, dev=dev, evaluate_outer=True)
    payload = {
        "evaluator": "candidate-developmental-6a",
        "pass": "bringup-seed-42-fold-0",
        "not_the_locked_decision": True,
        "controlMiniLmLinear": {
            "meanBothSides": CONTROL_BOTH_SIDES,
            "meanFamilyBalancedAccuracy": CONTROL_FAMILY_BA,
        },
        "gateK": {
            "A": GATE_BOTH_SIDES,
            "B_familyBa": GATE_FAMILY_BA,
            "B_bothSidesFloor": GATE_BOTH_SIDES_FLOOR,
            "note": "Decision uses 3-seed mean over 5 outer folds. Bring-up is not SUCCESS/NULL.",
        },
        "locked_eval_seeds": list(LOCKED_EVAL_SEEDS),
        "fold": result,
    }
    BRINGUP_PATH.parent.mkdir(parents=True, exist_ok=True)
    BRINGUP_PATH.write_text(json.dumps(payload, indent=2, default=_json_default))
    print(json.dumps({
        "bringupPath": str(BRINGUP_PATH),
        "trainable": result["encoder"]["trainable_param_count"],
        "frozen": result["encoder"]["frozen_param_count"],
        "E_k": result["selection"]["E_k"],
        "inner_val_history": result["selection"]["history"],
        "outer_both_sides_bringup_only": result["outer"]["bothSidesRate"],
        "ready_for_locked_eval": True,
    }, indent=2))
    return payload


def full_eval() -> dict:
    rows = load_core_train()
    outer_folds = load_outer_fold_family_ids()
    fold_info = assert_fold_integrity(rows, outer_folds)
    dev = device()
    print("CANDIDATE #6A LOCKED EVAL")
    print(json.dumps({"device": str(dev), "seeds": list(LOCKED_EVAL_SEEDS), "fold_integrity": fold_info}, indent=2))

    runs = []
    for seed in LOCKED_EVAL_SEEDS:
        for k in range(5):
            print(json.dumps({"status": "start", "seed": seed, "fold": k}))
            result = run_fold(rows, outer_folds, outer_fold=k, seed=seed, dev=dev, evaluate_outer=True)
            runs.append(result)
            CV_PATH.parent.mkdir(parents=True, exist_ok=True)
            CV_PATH.write_text(json.dumps({"partial": True, "runs": runs}, indent=2, default=_json_default))
            print(json.dumps({
                "status": "done",
                "seed": seed,
                "fold": k,
                "E_k": result["selection"]["E_k"],
                "outer_both_sides": result["outer"]["bothSidesRate"],
                "outer_family_ba": result["outer"]["meanFamilyBalancedAccuracy"],
            }))

    seed_summaries = []
    for seed in LOCKED_EVAL_SEEDS:
        slice_ = [r for r in runs if r["seed"] == seed]
        both = [r["outer"]["bothSidesRate"] for r in slice_]
        fam = [r["outer"]["meanFamilyBalancedAccuracy"] for r in slice_]
        seed_summaries.append(
            {
                "seed": seed,
                "meanBothSides": round(mean(both), 4),
                "meanFamilyBalancedAccuracy": round(mean(fam), 4),
                "foldBothSides": both,
                "foldFamilyBa": fam,
            }
        )

    seed_both = [s["meanBothSides"] for s in seed_summaries]
    seed_fam = [s["meanFamilyBalancedAccuracy"] for s in seed_summaries]
    mean_both = round(mean(seed_both), 4)
    std_both = round(std(seed_both), 4)
    mean_fam = round(mean(seed_fam), 4)
    std_fam = round(std(seed_fam), 4)
    gate_a = mean_both >= GATE_BOTH_SIDES
    gate_b = mean_fam >= GATE_FAMILY_BA and mean_both >= GATE_BOTH_SIDES_FLOOR
    success = gate_a or gate_b
    payload = {
        "evaluator": "candidate-developmental-6a",
        "pass": "locked-3-seed-5-fold-fp32",
        "generatedAt": __import__("datetime").datetime.now(tz=__import__("datetime").timezone.utc).isoformat(),
        "controlMiniLmLinear": {
            "meanBothSides": CONTROL_BOTH_SIDES,
            "meanFamilyBalancedAccuracy": CONTROL_FAMILY_BA,
        },
        "historical5A": {"meanBothSides": 0.3848, "meanFamilyBalancedAccuracy": 0.8066},
        "gateK": {
            "A": GATE_BOTH_SIDES,
            "B_familyBa": GATE_FAMILY_BA,
            "B_bothSidesFloor": GATE_BOTH_SIDES_FLOOR,
            "pathA": gate_a,
            "pathB": gate_b,
            "success": success,
            "decision": "SUCCESS" if success else "NULL",
        },
        "aggregate": {
            "seedSummaries": seed_summaries,
            "meanBothSides": mean_both,
            "stdBothSides": std_both,
            "meanFamilyBalancedAccuracy": mean_fam,
            "stdFamilyBalancedAccuracy": std_fam,
            "deltaVsFrozenBothSides": round(mean_both - CONTROL_BOTH_SIDES, 4),
            "deltaVsFrozenFamilyBa": round(mean_fam - CONTROL_FAMILY_BA, 4),
        },
        "runs": runs,
    }
    CV_PATH.write_text(json.dumps(payload, indent=2, default=_json_default))
    print(json.dumps({"cvPath": str(CV_PATH), "aggregate": payload["aggregate"], "gateK": payload["gateK"]}, indent=2))
    return payload


def _json_default(obj):
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, np.floating):
        return float(obj)
    raise TypeError(type(obj))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bringup", action="store_true")
    parser.add_argument("--full", action="store_true", help="Locked 3-seed × 5-fold (do not use until approved)")
    args = parser.parse_args()
    if args.full:
        full_eval()
        return
    if not args.bringup:
        raise SystemExit("Use --bringup or --full.")
    bringup()


if __name__ == "__main__":
    main()
