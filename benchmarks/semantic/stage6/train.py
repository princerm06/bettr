"""Head-only training, then LoRA only when run_stage6 authorizes it.

The encoder is not initialized from the Stage 5 MNLI checkpoint.
"""

from __future__ import annotations

import gc
import json
import os
import resource
import subprocess
import sys
import time
from pathlib import Path

# Thread caps before torch import.
os.environ.setdefault("OMP_NUM_THREADS", "2")
os.environ.setdefault("MKL_NUM_THREADS", "2")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import numpy as np
import torch
from torch import nn
from transformers import DistilBertModel, DistilBertTokenizerFast

from contract import (
    BATCH_SIZE,
    DATA,
    DEV_FALSE_SUPPORT_WEIGHT,
    HEAD_LR,
    HEAD_LR_WITH_LORA,
    HEAD_WEIGHT_DECAY,
    HIDDEN,
    LABELS,
    LABEL_TO_ID,
    LORA_ALPHA,
    LORA_DROPOUT,
    LORA_LAYERS,
    LORA_LR,
    LORA_R,
    MAX_EPOCHS,
    MAX_SEQ,
    MODEL_ID,
    PATIENCE,
    RESULTS,
    RSS_ABORT_MB,
    TORCH_SEED,
)
from metrics import decide, dev_score, support_precision

torch.set_num_threads(2)


class RssGuard:
    def __init__(self) -> None:
        self.peak = 0
        self.samples: list[dict] = []

    def check(self, where: str) -> int:
        rss = _rss_mb()
        self.peak = max(self.peak, rss)
        self.samples.append({"where": where, "rssMb": rss})
        if len(self.samples) > 400:
            self.samples = self.samples[-200:]
        if rss >= RSS_ABORT_MB:
            RESULTS.mkdir(parents=True, exist_ok=True)
            (RESULTS / "ABORT.json").write_text(
                json.dumps({"where": where, "rssMb": rss, "peakMb": self.peak}, indent=2),
                encoding="utf-8",
            )
            print(f"RSS abort at {where}: {rss} MB", flush=True)
            raise SystemExit(2)
        return rss


def _rss_mb() -> int:
    raw = subprocess.check_output(["ps", "-o", "rss=", "-p", str(os.getpid())], text=True)
    return int(raw.strip() or "0") // 1024


def _ru_maxrss_mb() -> float:
    value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    if sys.platform == "darwin":
        return value / (1024 * 1024)
    return value / 1024


class LinearHead(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.dropout = nn.Dropout(0.1)
        self.classifier = nn.Linear(HIDDEN, len(LABELS))

    def forward(self, cls: torch.Tensor) -> torch.Tensor:
        return self.classifier(self.dropout(cls))


def _read_jsonl(path: Path) -> list[dict]:
    rows = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def _softmax_rows(logits: torch.Tensor) -> list[dict[str, float]]:
    probs = torch.softmax(logits, dim=-1).detach().cpu().numpy()
    out = []
    for row in probs:
        out.append({label: float(row[LABEL_TO_ID[label]]) for label in LABELS})
    return out


def _load_encoder(guard: RssGuard):
    print(f"loading {MODEL_ID}", flush=True)
    tokenizer = DistilBertTokenizerFast.from_pretrained(MODEL_ID)
    model = DistilBertModel.from_pretrained(MODEL_ID, low_cpu_mem_usage=True)
    model.eval()
    for param in model.parameters():
        param.requires_grad = False
    guard.check("after_encoder_load")
    return tokenizer, model


def _release(*objects: object) -> None:
    for obj in objects:
        del obj
    gc.collect()


def _encode(rows: list[dict], tokenizer, model, guard: RssGuard, where: str) -> np.ndarray:
    chunks = []
    for start in range(0, len(rows), BATCH_SIZE):
        batch = rows[start : start + BATCH_SIZE]
        encoded = tokenizer(
            [row["premise"] for row in batch],
            [row["criterion"] for row in batch],
            padding="max_length",
            truncation=True,
            max_length=MAX_SEQ,
            return_tensors="pt",
        )
        with torch.inference_mode():
            hidden = model(
                input_ids=encoded["input_ids"],
                attention_mask=encoded["attention_mask"],
            ).last_hidden_state[:, 0]
        chunks.append(hidden.cpu().numpy().astype(np.float32))
        del encoded, hidden
        if start % (BATCH_SIZE * 40) == 0:
            guard.check(where)
    guard.check(where + "_done")
    return np.concatenate(chunks, axis=0)


def _predict_head(head: LinearHead, features: np.ndarray) -> list[dict]:
    head.eval()
    rows = []
    with torch.inference_mode():
        for start in range(0, len(features), 256):
            batch = torch.from_numpy(features[start : start + 256])
            logits = head(batch)
            probs = _softmax_rows(logits)
            for prob in probs:
                rows.append({"probs": {key: round(val, 4) for key, val in prob.items()}, "decision": decide(prob)})
    return rows


def _attach(split_rows: list[dict], predictions: list[dict], label_key: str) -> list[dict]:
    out = []
    for row, pred in zip(split_rows, predictions, strict=True):
        merged = dict(row)
        merged["probs"] = pred["probs"]
        merged["decision"] = pred["decision"]
        if label_key == "label":
            merged["goldLabel"] = row["label"]
        out.append(merged)
    return out


def _train_linear_head(train_x: np.ndarray, train_y: np.ndarray, dev_rows: list[dict], dev_x: np.ndarray, guard: RssGuard) -> dict:
    torch.manual_seed(TORCH_SEED)
    head = LinearHead()
    optimizer = torch.optim.AdamW(head.parameters(), lr=HEAD_LR, weight_decay=HEAD_WEIGHT_DECAY)
    loss_fn = nn.CrossEntropyLoss()
    y = torch.from_numpy(train_y.astype(np.int64))
    x = torch.from_numpy(train_x)
    generator = torch.Generator()
    generator.manual_seed(TORCH_SEED)

    best = {"score": -1e9, "epoch": 0, "state": None, "history": []}
    stale = 0
    for epoch in range(1, MAX_EPOCHS + 1):
        head.train()
        order = torch.randperm(len(x), generator=generator)
        total_loss = 0.0
        steps = 0
        for start in range(0, len(order), BATCH_SIZE):
            idx = order[start : start + BATCH_SIZE]
            optimizer.zero_grad(set_to_none=True)
            logits = head(x[idx])
            loss = loss_fn(logits, y[idx])
            loss.backward()
            optimizer.step()
            total_loss += float(loss.item())
            steps += 1
        dev_pred = _attach(dev_rows, _predict_head(head, dev_x), "label")
        stats = dev_score(dev_pred)
        stats["epoch"] = epoch
        stats["trainLoss"] = total_loss / max(1, steps)
        stats["rssMb"] = guard.check(f"head_epoch_{epoch}")
        best["history"].append(stats)
        print(
            f"head epoch {epoch} loss {stats['trainLoss']:.4f} "
            f"dev_recall {stats['supportRecall']} false_supports {stats['falseSupports']} "
            f"score {stats['score']:.4f} rss {stats['rssMb']}MB",
            flush=True,
        )
        if stats["score"] > best["score"] + 1e-6:
            best["score"] = stats["score"]
            best["epoch"] = epoch
            best["state"] = {key: value.detach().cpu().clone() for key, value in head.state_dict().items()}
            stale = 0
        else:
            stale += 1
            if stale >= PATIENCE:
                print(f"early stop at epoch {epoch}", flush=True)
                break

    if best["state"] is None:
        raise RuntimeError("head training produced no epoch")
    head.load_state_dict(best["state"])
    RESULTS.mkdir(parents=True, exist_ok=True)
    torch.save(best["state"], RESULTS / "head-only.pt")
    payload = {
        "condition": "head_only",
        "modelId": MODEL_ID,
        "selectedEpoch": best["epoch"],
        "devScore": best["score"],
        "history": best["history"],
        "peakRssMb": guard.peak,
        "ruMaxRssMb": round(_ru_maxrss_mb(), 1),
        "head": "dropout(0.1)+linear(768,3)",
        "lr": HEAD_LR,
        "weightDecay": HEAD_WEIGHT_DECAY,
        "devSelection": f"support_recall - {DEV_FALSE_SUPPORT_WEIGHT} * false_support_rate",
        "threshold": 0.5,
    }
    (RESULTS / "head-only-train.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return {"head": head, "train": payload}


def _labels(rows: list[dict]) -> np.ndarray:
    return np.asarray([LABEL_TO_ID[row["label"]] for row in rows], dtype=np.int64)


def run_head_only(guard: RssGuard) -> dict:
    train_rows = _read_jsonl(DATA / "train.jsonl")
    dev_rows = _read_jsonl(DATA / "dev.jsonl")
    tokenizer, model = _load_encoder(guard)
    print("encoding train/dev", flush=True)
    train_x = _encode(train_rows, tokenizer, model, guard, "encode_train")
    dev_x = _encode(dev_rows, tokenizer, model, guard, "encode_dev")
    _release(model, tokenizer)
    guard.check("after_encoder_release")
    trained = _train_linear_head(train_x, _labels(train_rows), dev_rows, dev_x, guard)
    train_pred = _attach(train_rows, _predict_head(trained["head"], train_x), "label")
    train_precision = support_precision(train_pred)
    del train_x, dev_x
    gc.collect()
    return {
        "head": trained["head"],
        "trainMeta": trained["train"],
        "trainPrecision": train_precision,
        "trainPredSupports": sum(1 for row in train_pred if row["decision"] == "SUPPORTS"),
        "trainGoldSupportsCorrect": sum(
            1 for row in train_pred if row["decision"] == "SUPPORTS" and row["goldLabel"] == "SUPPORTS"
        ),
    }


def score_locked_with_head(head: LinearHead, guard: RssGuard) -> tuple[list[dict], dict]:
    locked = json.loads((DATA / "locked-test.json").read_text(encoding="utf-8"))["examples"]
    rows = []
    for row in locked:
        rows.append(
            {
                "id": row["id"],
                "premise": row["text"],
                "criterion": row["target"],
                "text": row["text"],
                "target": row["target"],
                "gold": row["gold"],
                "slice": row["slice"],
                "group": row["group"],
                "unsafeIfSupports": row["unsafeIfSupports"],
                "productCaution": row.get("productCaution"),
            }
        )
    tokenizer, model = _load_encoder(guard)
    latency = _latency(tokenizer, model, guard)
    features = _encode(rows, tokenizer, model, guard, "encode_locked")
    _release(model, tokenizer)
    guard.check("after_locked_release")
    preds = _predict_head(head, features)
    from metrics import attach_gold

    scored = []
    for row, pred in zip(rows, preds, strict=True):
        merged = dict(row)
        merged["probs"] = pred["probs"]
        merged["decision"] = pred["decision"]
        merged["goldLabel"] = attach_gold(row)
        scored.append(merged)
    return scored, latency


def _latency(tokenizer, model, guard: RssGuard) -> dict | None:
    if guard.peak >= 1600:
        return {"measured": False, "reason": "skipped because RSS peak was already high"}
    sample_premise = "I rehearsed a viola etude"
    sample_criterion = "rehearsed a viola etude"
    try:
        for _ in range(4):
            _one(tokenizer, model, sample_premise, sample_criterion)
        times = []
        for _ in range(40):
            t0 = time.perf_counter()
            _one(tokenizer, model, sample_premise, sample_criterion)
            times.append((time.perf_counter() - t0) * 1000)
        times.sort()
        guard.check("latency")
        return {
            "measured": True,
            "n": len(times),
            "p50Ms": round(times[len(times) // 2], 2),
            "p95Ms": round(times[max(0, int(len(times) * 0.95) - 1)], 2),
            "meanMs": round(sum(times) / len(times), 2),
        }
    except Exception as exc:  # latency must not sink the experiment
        return {"measured": False, "reason": str(exc)}


def _one(tokenizer, model, premise: str, criterion: str) -> None:
    encoded = tokenizer(
        premise,
        criterion,
        padding="max_length",
        truncation=True,
        max_length=MAX_SEQ,
        return_tensors="pt",
    )
    with torch.inference_mode():
        model(input_ids=encoded["input_ids"], attention_mask=encoded["attention_mask"])


def run_lora(guard: RssGuard) -> dict:
    from peft import LoraConfig, get_peft_model

    train_rows = _read_jsonl(DATA / "train.jsonl")
    dev_rows = _read_jsonl(DATA / "dev.jsonl")
    tokenizer, base = _load_encoder(guard)
    matched = []
    for name, _module in base.named_modules():
        if any(f"layer.{layer}." in name for layer in LORA_LAYERS) and name.split(".")[-1] in {
            "q_lin",
            "k_lin",
            "v_lin",
            "out_lin",
            "lin1",
            "lin2",
        }:
            matched.append(name)
    if len(matched) != 12:
        _release(base, tokenizer)
        raise RuntimeError(f"expected 12 LoRA target modules, found {len(matched)}: {matched}")

    config = LoraConfig(
        r=LORA_R,
        lora_alpha=LORA_ALPHA,
        lora_dropout=LORA_DROPOUT,
        bias="none",
        target_modules=["q_lin", "k_lin", "v_lin", "out_lin", "lin1", "lin2"],
        layers_to_transform=list(LORA_LAYERS),
        layers_pattern="layer",
    )
    model = get_peft_model(base, config)
    bad = [
        name
        for name, param in model.named_parameters()
        if param.requires_grad and not any(f"layer.{layer}." in name for layer in LORA_LAYERS)
    ]
    if bad:
        _release(model, tokenizer)
        raise RuntimeError(f"LoRA enabled modules outside the last two layers: {bad[:8]}")
    guard.check("after_lora_wrap")

    torch.manual_seed(TORCH_SEED)
    head = LinearHead()
    lora_names = [name for name, param in model.named_parameters() if param.requires_grad]
    if len(lora_names) < 12 or any("lora_" not in name for name in lora_names):
        _release(model, tokenizer)
        raise RuntimeError(f"unexpected trainable LoRA parameters: {lora_names[:12]}")
    lora_params = [param for _name, param in model.named_parameters() if param.requires_grad]
    optimizer = torch.optim.AdamW(
        [
            {"params": lora_params, "lr": LORA_LR, "weight_decay": HEAD_WEIGHT_DECAY},
            {"params": list(head.parameters()), "lr": HEAD_LR_WITH_LORA, "weight_decay": HEAD_WEIGHT_DECAY},
        ]
    )
    loss_fn = nn.CrossEntropyLoss()
    best = {"score": -1e9, "epoch": 0, "head": None, "adapter": None, "history": []}
    stale = 0

    def epoch_dev_features() -> np.ndarray:
        return _encode(dev_rows, tokenizer, model, guard, "lora_dev")

    for epoch in range(1, MAX_EPOCHS + 1):
        model.train()
        head.train()
        order = torch.randperm(len(train_rows))
        total_loss = 0.0
        steps = 0
        for start in range(0, len(order), BATCH_SIZE):
            idx = order[start : start + BATCH_SIZE].tolist()
            batch = [train_rows[i] for i in idx]
            encoded = tokenizer(
                [row["premise"] for row in batch],
                [row["criterion"] for row in batch],
                padding="max_length",
                truncation=True,
                max_length=MAX_SEQ,
                return_tensors="pt",
            )
            labels = torch.tensor([LABEL_TO_ID[row["label"]] for row in batch], dtype=torch.long)
            optimizer.zero_grad(set_to_none=True)
            hidden = model(
                input_ids=encoded["input_ids"],
                attention_mask=encoded["attention_mask"],
            ).last_hidden_state[:, 0]
            loss = loss_fn(head(hidden), labels)
            loss.backward()
            optimizer.step()
            total_loss += float(loss.item())
            steps += 1
            del encoded, hidden, labels
            if steps % 40 == 0:
                guard.check(f"lora_epoch_{epoch}_step_{steps}")
        model.eval()
        head.eval()
        dev_x = epoch_dev_features()
        dev_pred = _attach(dev_rows, _predict_head(head, dev_x), "label")
        del dev_x
        stats = dev_score(dev_pred)
        stats["epoch"] = epoch
        stats["trainLoss"] = total_loss / max(1, steps)
        stats["rssMb"] = guard.check(f"lora_epoch_{epoch}")
        best["history"].append(stats)
        print(
            f"lora epoch {epoch} loss {stats['trainLoss']:.4f} "
            f"dev_recall {stats['supportRecall']} false_supports {stats['falseSupports']} "
            f"score {stats['score']:.4f} rss {stats['rssMb']}MB",
            flush=True,
        )
        if stats["score"] > best["score"] + 1e-6:
            best["score"] = float(stats["score"])
            best["epoch"] = epoch
            best["head"] = {key: value.detach().cpu().clone() for key, value in head.state_dict().items()}
            best["adapter"] = {key: value.detach().cpu().clone() for key, value in model.state_dict().items() if "lora_" in key}
            stale = 0
        else:
            stale += 1
            if stale >= PATIENCE:
                print(f"lora early stop at epoch {epoch}", flush=True)
                break

    if best["head"] is None or best["adapter"] is None:
        raise RuntimeError("lora training produced no epoch")
    head.load_state_dict(best["head"])
    model.load_state_dict(best["adapter"], strict=False)
    adapter_path = RESULTS / "lora-adapter"
    adapter_path.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(adapter_path)
    torch.save(best["head"], RESULTS / "lora-head.pt")
    train_meta = {
        "condition": "lora",
        "modelId": MODEL_ID,
        "selectedEpoch": best["epoch"],
        "devScore": best["score"],
        "history": best["history"],
        "peakRssMb": guard.peak,
        "ruMaxRssMb": round(_ru_maxrss_mb(), 1),
        "loraR": LORA_R,
        "loraAlpha": LORA_ALPHA,
        "loraDropout": LORA_DROPOUT,
        "layers": list(LORA_LAYERS),
        "targetModules": matched,
        "loraLr": LORA_LR,
        "headLr": HEAD_LR_WITH_LORA,
    }
    (RESULTS / "lora-train.json").write_text(json.dumps(train_meta, indent=2), encoding="utf-8")

    model.eval()
    head.eval()
    train_x = _encode(train_rows, tokenizer, model, guard, "lora_train_eval")
    train_pred = _attach(train_rows, _predict_head(head, train_x), "label")
    train_precision = support_precision(train_pred)
    del train_x
    return {
        "head": head,
        "model": model,
        "tokenizer": tokenizer,
        "trainMeta": train_meta,
        "trainPrecision": train_precision,
    }


def score_locked_with_lora(bundle: dict, guard: RssGuard) -> tuple[list[dict], dict]:
    locked = json.loads((DATA / "locked-test.json").read_text(encoding="utf-8"))["examples"]
    rows = []
    for row in locked:
        rows.append(
            {
                "id": row["id"],
                "premise": row["text"],
                "criterion": row["target"],
                "text": row["text"],
                "target": row["target"],
                "gold": row["gold"],
                "slice": row["slice"],
                "group": row["group"],
                "unsafeIfSupports": row["unsafeIfSupports"],
                "productCaution": row.get("productCaution"),
            }
        )
    model = bundle["model"]
    tokenizer = bundle["tokenizer"]
    model.eval()
    latency = _latency(tokenizer, model, guard)
    features = _encode(rows, tokenizer, model, guard, "lora_locked")
    preds = _predict_head(bundle["head"], features)
    from metrics import attach_gold

    scored = []
    for row, pred in zip(rows, preds, strict=True):
        merged = dict(row)
        merged["probs"] = pred["probs"]
        merged["decision"] = pred["decision"]
        merged["goldLabel"] = attach_gold(row)
        scored.append(merged)
    _release(model, tokenizer)
    guard.check("after_lora_release")
    return scored, latency
