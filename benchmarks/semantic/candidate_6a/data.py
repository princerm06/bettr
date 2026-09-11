"""Load the 3A.2 core train freeze only (405 DEV/NON rows)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from .contract import DATASET_PATH, FOLDS_PATH


@dataclass(frozen=True)
class Row:
    id: str
    text: str
    label: str
    family_id: str
    contrast_group: str
    domain: str
    index: int


def load_core_train() -> list[Row]:
    rows: list[Row] = []
    with DATASET_PATH.open() as f:
        for line in f:
            rec: dict[str, Any] = json.loads(line)
            if rec.get("role") != "core_trainable":
                continue
            if rec.get("split") != "train":
                continue
            if rec.get("label") not in ("DEVELOPMENTAL", "NON_DEVELOPMENTAL"):
                continue
            rows.append(
                Row(
                    id=rec["id"],
                    text=rec["text"],
                    label=rec["label"],
                    family_id=rec["familyId"],
                    contrast_group=rec["contrastGroup"],
                    domain=rec["domain"],
                    index=len(rows),
                )
            )
    if len(rows) != 405:
        raise AssertionError(f"Expected 405 core train rows, got {len(rows)}")
    return rows


def load_outer_fold_family_ids() -> list[list[str]]:
    data = json.loads(FOLDS_PATH.read_text())
    folds = data["foldConstruction"]["folds"]
    out: list[list[str]] = []
    for k in range(5):
        rec = next(x for x in folds if x["fold"] == k)
        out.append(list(rec["familyIds"]))
    return out


def family_stats(rows: list[Row], family_ids: list[str] | None = None):
    allow = set(family_ids) if family_ids is not None else None
    stats: dict[str, dict] = {}
    for row in rows:
        if allow is not None and row.family_id not in allow:
            continue
        cur = stats.setdefault(
            row.family_id,
            {
                "family_id": row.family_id,
                "domain": row.domain,
                "n": 0,
                "n_dev": 0,
                "n_non": 0,
                "both_sides": False,
            },
        )
        cur["n"] += 1
        if row.label == "DEVELOPMENTAL":
            cur["n_dev"] += 1
        else:
            cur["n_non"] += 1
        cur["both_sides"] = cur["n_dev"] > 0 and cur["n_non"] > 0
    return stats
