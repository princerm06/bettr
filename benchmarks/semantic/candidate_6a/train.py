"""In-family cosine-push training, inner-val selection, outer-train refit."""

from __future__ import annotations

import copy

import numpy as np
import torch
import torch.nn.functional as F
from torch.nn.utils import clip_grad_norm_

from .contract import (
    BATCH_SIZE,
    BOTH_SIDES_IMPROVE,
    ENCODER_LR,
    GRAD_CLIP,
    LAMBDA_ATTRACTION,
    MARGIN,
    MAX_EPOCHS,
    MAX_SEQ_LENGTH,
    PATIENCE,
    WEIGHT_DECAY,
)
from .data import Row
from .encoder import embed_texts, mean_pool_l2
from .metrics import family_metrics, nll, row_metrics
from .probe import classify_prob, train_binary_logistic
from .rng import mulberry32, shuffle


def set_seeds(seed: int) -> None:
    import random

    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def cosine_push_loss(z_i: torch.Tensor, z_j: torch.Tensor) -> torch.Tensor:
    if LAMBDA_ATTRACTION != 0.0:
        raise AssertionError("lambda attraction must stay 0")
    cos = (z_i * z_j).sum(dim=-1)
    return F.relu(cos - MARGIN).mean()


def _score_split(rows, embeddings, train_idx, eval_idx):
    from .probe import predict_probability

    x_train = embeddings[train_idx]
    y_train = np.array([1.0 if rows[i].label == "DEVELOPMENTAL" else 0.0 for i in train_idx], dtype=np.float64)
    weights, bias = train_binary_logistic(x_train, y_train)
    eval_rows = [rows[i] for i in eval_idx]
    x_eval = embeddings[eval_idx]
    y_eval = np.array([1.0 if rows[i].label == "DEVELOPMENTAL" else 0.0 for i in eval_idx], dtype=np.float64)
    probs = [predict_probability(weights, bias, x_eval[i]) for i in range(len(eval_idx))]
    pred = [classify_prob(p) for p in probs]
    fam = family_metrics(eval_rows, pred)
    return {
        "weights": weights,
        "bias": float(bias),
        "row": row_metrics([r.label for r in eval_rows], pred),
        "meanFamilyBalancedAccuracy": fam["meanFamilyBalancedAccuracy"],
        "bothSidesRate": fam["bothSidesRate"],
        "bothSidesN": fam["bothSidesN"],
        "bothSidesCorrectCount": fam["bothSidesCorrectCount"],
        "nll": round(nll(weights, bias, x_eval, y_eval), 4),
    }


def train_push_epoch(model, tokenizer, rows: list[Row], pairs: list[tuple[int, int]], device, optimizer, seed: int, epoch: int) -> float:
    model.train()
    rng = mulberry32(seed + epoch)
    order = shuffle(list(range(len(pairs))), rng)
    losses: list[float] = []
    for start in range(0, len(order), BATCH_SIZE):
        batch = order[start : start + BATCH_SIZE]
        texts_i = [rows[pairs[b][0]].text for b in batch]
        texts_j = [rows[pairs[b][1]].text for b in batch]
        enc_i = tokenizer(
            texts_i,
            padding=True,
            truncation=True,
            max_length=MAX_SEQ_LENGTH,
            return_tensors="pt",
        )
        enc_j = tokenizer(
            texts_j,
            padding=True,
            truncation=True,
            max_length=MAX_SEQ_LENGTH,
            return_tensors="pt",
        )
        enc_i = {k: v.to(device) for k, v in enc_i.items()}
        enc_j = {k: v.to(device) for k, v in enc_j.items()}
        z_i = mean_pool_l2(model(**enc_i).last_hidden_state, enc_i["attention_mask"])
        z_j = mean_pool_l2(model(**enc_j).last_hidden_state, enc_j["attention_mask"])
        loss = cosine_push_loss(z_i, z_j)
        optimizer.zero_grad(set_to_none=True)
        loss.backward()
        clip_grad_norm_([p for p in model.parameters() if p.requires_grad], GRAD_CLIP)
        optimizer.step()
        losses.append(float(loss.detach().cpu()))
    return float(sum(losses) / max(1, len(losses)))


def _both_sides_key(score: dict) -> tuple:
    both = score["bothSidesRate"]
    both_v = -1.0 if both is None else both
    return (both_v, score["meanFamilyBalancedAccuracy"], -score["nll"])


def inner_train_select(
    model,
    tokenizer,
    rows: list[Row],
    inner_train_idx: list[int],
    inner_val_idx: list[int],
    pairs: list[tuple[int, int]],
    device,
    seed: int,
) -> dict:
    optimizer = torch.optim.AdamW(
        [p for p in model.parameters() if p.requires_grad],
        lr=ENCODER_LR,
        weight_decay=WEIGHT_DECAY,
    )
    best_state = copy.deepcopy({k: v.detach().cpu().clone() for k, v in model.state_dict().items()})
    best_epoch = 0
    best_score = None
    history = []
    epochs_without_improve = 0

    select_idx = sorted(set(inner_train_idx + inner_val_idx))

    for epoch in range(1, MAX_EPOCHS + 1):
        train_loss = train_push_epoch(model, tokenizer, rows, pairs, device, optimizer, seed, epoch)
        with torch.no_grad():
            texts = [rows[i].text for i in select_idx]
            z_sel = embed_texts(model, tokenizer, texts, device).cpu().numpy().astype(np.float64)
        z = np.zeros((len(rows), z_sel.shape[1]), dtype=np.float64)
        for j, i in enumerate(select_idx):
            z[i] = z_sel[j]
        score = _score_split(rows, z, inner_train_idx, inner_val_idx)
        history.append(
            {
                "epoch": epoch,
                "train_loss": round(train_loss, 6),
                "inner_val_both_sides": score["bothSidesRate"],
                "inner_val_family_ba": score["meanFamilyBalancedAccuracy"],
                "inner_val_nll": score["nll"],
            }
        )
        cur_both = 0.0 if score["bothSidesRate"] is None else score["bothSidesRate"]
        prev_both = 0.0 if best_score is None else (best_score["bothSidesRate"] or 0.0)
        material = best_score is None or cur_both >= prev_both + BOTH_SIDES_IMPROVE
        if best_score is None or _both_sides_key(score) > _both_sides_key(best_score):
            best_score = score
            best_epoch = epoch
            best_state = copy.deepcopy({k: v.detach().cpu().clone() for k, v in model.state_dict().items()})
        if material:
            epochs_without_improve = 0
        else:
            epochs_without_improve += 1
            if epochs_without_improve >= PATIENCE:
                break

    model.load_state_dict({k: v.to(device) for k, v in best_state.items()})
    return {
        "E_k": best_epoch,
        "best_inner_val": {
            "bothSidesRate": best_score["bothSidesRate"] if best_score else None,
            "meanFamilyBalancedAccuracy": best_score["meanFamilyBalancedAccuracy"] if best_score else None,
            "nll": best_score["nll"] if best_score else None,
        },
        "history": history,
        "stopped_epoch": history[-1]["epoch"] if history else 0,
    }


def refit_outer_train(
    build_model,
    tokenizer,
    rows: list[Row],
    outer_train_idx: list[int],
    pairs: list[tuple[int, int]],
    device,
    seed: int,
    e_k: int,
):
    """Train a fresh LoRA encoder for exactly E_k epochs on all 48 outer-train families."""
    set_seeds(seed)
    model, _, info = build_model(device)
    optimizer = torch.optim.AdamW(
        [p for p in model.parameters() if p.requires_grad],
        lr=ENCODER_LR,
        weight_decay=WEIGHT_DECAY,
    )
    losses = []
    for epoch in range(1, e_k + 1):
        losses.append(train_push_epoch(model, tokenizer, rows, pairs, device, optimizer, seed, epoch))
    return model, info, [round(x, 6) for x in losses]
