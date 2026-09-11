"""MiniLM-L6-v2 + LoRA on last two layers only (Q/K/V/O + FFN)."""

from __future__ import annotations

import torch
import torch.nn.functional as F
from peft import LoraConfig, PeftModel, get_peft_model
from transformers import AutoModel, AutoTokenizer

from .contract import (
    BASE_MODEL_ID,
    EMBEDDING_DIM,
    EXPECTED_TRAINABLE,
    LORA_ALPHA,
    LORA_DROPOUT,
    LORA_R,
    LORA_TARGET_MODULES,
    MAX_SEQ_LENGTH,
)


def mean_pool_l2(last_hidden: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
    mask = attention_mask.unsqueeze(-1).to(last_hidden.dtype)
    summed = (last_hidden * mask).sum(dim=1)
    counts = mask.sum(dim=1).clamp(min=1e-9)
    pooled = summed / counts
    return F.normalize(pooled, p=2, dim=1)


def load_tokenizer():
    tok = AutoTokenizer.from_pretrained(BASE_MODEL_ID)
    return tok


def _assert_lora_targets(model: PeftModel) -> list[str]:
    names = []
    for n, p in model.named_parameters():
        if p.requires_grad:
            names.append(n)
    unexpected = [
        n
        for n in names
        if not any(
            f"layer.{i}." in n and ("lora_" in n)
            for i in (4, 5)
        )
    ]
    if unexpected:
        raise AssertionError(f"Trainable params outside LoRA layers 4–5: {unexpected[:8]}")
    return names


def load_lora_encoder(device: torch.device) -> tuple[PeftModel, object, dict]:
    tokenizer = load_tokenizer()
    base = AutoModel.from_pretrained(BASE_MODEL_ID, attn_implementation="eager")
    n_layers = len(base.encoder.layer)
    if n_layers != 6:
        raise AssertionError(f"Expected MiniLM L6, got {n_layers} layers")
    cfg = LoraConfig(
        r=LORA_R,
        lora_alpha=LORA_ALPHA,
        lora_dropout=LORA_DROPOUT,
        target_modules=LORA_TARGET_MODULES,
        bias="none",
        inference_mode=False,
    )
    model = get_peft_model(base, cfg)
    for name, param in model.named_parameters():
        param.requires_grad = "lora_" in name
    trainable_names = _assert_lora_targets(model)
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    frozen = sum(p.numel() for p in model.parameters() if not p.requires_grad)
    if trainable != EXPECTED_TRAINABLE:
        raise AssertionError(
            f"Expected {EXPECTED_TRAINABLE} trainable params, got {trainable}. "
            f"modules={trainable_names}"
        )
    model.to(device)
    info = {
        "base_model_id": BASE_MODEL_ID,
        "tokenizer_id": getattr(tokenizer, "name_or_path", BASE_MODEL_ID),
        "tokenizer_class": tokenizer.__class__.__name__,
        "n_layers": n_layers,
        "hidden_size": base.config.hidden_size,
        "embedding_dim": EMBEDDING_DIM,
        "max_seq_length": MAX_SEQ_LENGTH,
        "trainable_param_count": trainable,
        "frozen_param_count": frozen,
        "trainable_modules": trainable_names,
        "lora": {
            "r": LORA_R,
            "alpha": LORA_ALPHA,
            "dropout": LORA_DROPOUT,
            "target_modules": LORA_TARGET_MODULES,
        },
    }
    if base.config.hidden_size != EMBEDDING_DIM:
        raise AssertionError("hidden_size != 384")
    return model, tokenizer, info


@torch.no_grad()
def embed_texts(
    model,
    tokenizer,
    texts: list[str],
    device: torch.device,
    batch_size: int = 32,
) -> torch.Tensor:
    model.eval()
    outs = []
    for start in range(0, len(texts), batch_size):
        chunk = texts[start : start + batch_size]
        enc = tokenizer(
            chunk,
            padding=True,
            truncation=True,
            max_length=MAX_SEQ_LENGTH,
            return_tensors="pt",
        )
        enc = {k: v.to(device) for k, v in enc.items()}
        hidden = model(**enc).last_hidden_state
        outs.append(mean_pool_l2(hidden, enc["attention_mask"]))
    z = torch.cat(outs, dim=0)
    if z.shape[1] != EMBEDDING_DIM:
        raise AssertionError(f"Expected 384-d, got {tuple(z.shape)}")
    return z
