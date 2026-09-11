"""Deterministic inner family split (contract G)."""

from __future__ import annotations

from .contract import (
    INNER_SPLIT_SEED_BASE,
    INNER_SPLIT_SEED_STRIDE,
    INNER_VAL_FAMILIES,
    MIN_INNER_VAL_BOTH_SIDES,
)
from .data import Row, family_stats
from .rng import shuffle_seeded


def inner_split_seed(outer_fold: int) -> int:
    return INNER_SPLIT_SEED_BASE + INNER_SPLIT_SEED_STRIDE * (outer_fold + 1)


def inner_split(
    rows: list[Row],
    outer_train_family_ids: list[str],
    outer_fold: int,
) -> tuple[list[str], list[str]]:
    """Return (inner_train_ids, inner_val_ids)."""
    stats = family_stats(rows, outer_train_family_ids)
    families = [stats[fid] for fid in sorted(outer_train_family_ids)]
    seed = inner_split_seed(outer_fold)
    shuffled = shuffle_seeded(families, seed)
    sized = sorted(
        shuffled,
        key=lambda f: (-f["n"], shuffled.index(f)),
    )
    n = INNER_VAL_FAMILIES
    chosen = None
    for start in range(0, len(sized) - n + 1):
        window = sized[start : start + n]
        both = sum(1 for f in window if f["both_sides"])
        if both >= MIN_INNER_VAL_BOTH_SIDES:
            chosen = window
            break
    if chosen is None:
        raise AssertionError("No inner-val window with >= 8 two-sided families")
    val_ids = sorted(f["family_id"] for f in chosen)
    val_set = set(val_ids)
    train_ids = sorted(fid for fid in outer_train_family_ids if fid not in val_set)
    if len(val_ids) != 10 or len(train_ids) != 38:
        raise AssertionError(f"Inner split sizes {len(train_ids)}/{len(val_ids)}")
    return train_ids, val_ids
