"""G.1 deterministic unordered opposite-label pairs. No adaptive mining."""

from __future__ import annotations

from .contract import MAX_PAIRS_PER_FAMILY, PAIR_SEED_STRIDE
from .data import Row
from .rng import mulberry32, shuffle


def pair_construction_seed(evaluation_seed: int, outer_fold: int) -> int:
    return evaluation_seed + PAIR_SEED_STRIDE * (outer_fold + 1)


def construct_pairs(
    rows: list[Row],
    family_ids: list[str],
    evaluation_seed: int,
    outer_fold: int,
) -> tuple[list[tuple[int, int]], dict]:
    """
    Unordered (dev_index, non_index) pairs.
    Membership is fixed for the phase; does not depend on embeddings.
    """
    allow = set(family_ids)
    by_fam: dict[str, dict[str, list[Row]]] = {}
    for row in rows:
        if row.family_id not in allow:
            continue
        cur = by_fam.setdefault(row.family_id, {"DEVELOPMENTAL": [], "NON_DEVELOPMENTAL": []})
        cur[row.label].append(row)

    rng = mulberry32(pair_construction_seed(evaluation_seed, outer_fold))
    pairs: list[tuple[int, int]] = []
    inventory = 0
    per_family: dict[str, dict] = {}
    for fid in sorted(allow):
        groups = by_fam.get(fid)
        if not groups:
            continue
        candidates = [
            (d, n)
            for d in groups["DEVELOPMENTAL"]
            for n in groups["NON_DEVELOPMENTAL"]
        ]
        candidates.sort(key=lambda p: (p[0].id, p[1].id))
        inventory += len(candidates)
        selected = shuffle(candidates, rng)[:MAX_PAIRS_PER_FAMILY]
        pairs.extend((d.index, n.index) for d, n in selected)
        per_family[fid] = {
            "uncapped": len(candidates),
            "selected": len(selected),
        }

    meta = {
        "n_pairs": len(pairs),
        "uncapped_inventory": inventory,
        "n_families": len(allow),
        "per_family": per_family,
        "pair_ids": [(rows[i].id, rows[j].id) for i, j in pairs],
    }
    return pairs, meta
