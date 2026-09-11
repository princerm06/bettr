"""Row / family metrics matching the 3A.3 / 5A runners."""

from __future__ import annotations

import math

import numpy as np

from .data import Row
from .probe import predict_probability


def mean(values: list[float]) -> float:
    if not values:
        return 0.0
    return float(sum(values) / len(values))


def std(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    m = mean(values)
    return math.sqrt(sum((x - m) ** 2 for x in values) / (len(values) - 1))


def row_metrics(y_true: list[str], y_pred: list[str]) -> dict:
    tp = tn = fp = fn = 0
    for t, p in zip(y_true, y_pred):
        td = t == "DEVELOPMENTAL"
        pd = p == "DEVELOPMENTAL"
        if td and pd:
            tp += 1
        elif not td and not pd:
            tn += 1
        elif not td and pd:
            fp += 1
        else:
            fn += 1
    rec_pos = tp / max(1, tp + fn)
    rec_neg = tn / max(1, tn + fp)
    prec_pos = tp / max(1, tp + fp)
    prec_neg = tn / max(1, tn + fn)
    f1_pos = (2 * prec_pos * rec_pos) / max(1e-12, prec_pos + rec_pos)
    f1_neg = (2 * prec_neg * rec_neg) / max(1e-12, prec_neg + rec_neg)
    return {
        "n": len(y_true),
        "accuracy": round((tp + tn) / max(1, len(y_true)), 4),
        "balancedAccuracy": round((rec_pos + rec_neg) / 2, 4),
        "precision": round(prec_pos, 4),
        "recall": round(rec_pos, 4),
        "f1": round(f1_pos, 4),
        "macroF1": round((f1_pos + f1_neg) / 2, 4),
        "confusion": {"tp": tp, "tn": tn, "fp": fp, "fn": fn},
    }


def family_metrics(rows: list[Row], predicted: list[str]) -> dict:
    by_fam: dict[str, dict] = {}
    for row, pred in zip(rows, predicted):
        cur = by_fam.setdefault(row.family_id, {"y": [], "p": []})
        cur["y"].append(row.label)
        cur["p"].append(pred)
    per = []
    for slice_ in by_fam.values():
        m = row_metrics(slice_["y"], slice_["p"])
        both = "DEVELOPMENTAL" in slice_["y"] and "NON_DEVELOPMENTAL" in slice_["y"]
        per.append(
            {
                "balancedAccuracy": m["balancedAccuracy"],
                "bothSides": both,
                "bothSidesCorrect": both and all(y == p for y, p in zip(slice_["y"], slice_["p"])),
            }
        )
    both_sides = [f for f in per if f["bothSides"]]
    return {
        "meanFamilyBalancedAccuracy": round(mean([f["balancedAccuracy"] for f in per]), 4),
        "bothSidesRate": None
        if not both_sides
        else round(sum(1 for f in both_sides if f["bothSidesCorrect"]) / len(both_sides), 4),
        "bothSidesN": len(both_sides),
        "bothSidesCorrectCount": sum(1 for f in both_sides if f["bothSidesCorrect"]),
    }


def nll(weights: np.ndarray, bias: float, embeddings: np.ndarray, labels: np.ndarray) -> float:
    s = 0.0
    for i in range(len(embeddings)):
        p = min(1 - 1e-12, max(1e-12, predict_probability(weights, bias, embeddings[i])))
        y = labels[i]
        s += -(y * math.log(p) + (1 - y) * math.log(1 - p))
    return s / max(1, len(embeddings))


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b))


def pair_geometry(rows: list[Row], vecs: np.ndarray) -> dict:
    in_opp: list[float] = []
    cross_same: list[float] = []
    n = len(rows)
    for i in range(n):
        for j in range(i + 1, n):
            c = cosine(vecs[i], vecs[j])
            if rows[i].family_id == rows[j].family_id and rows[i].label != rows[j].label:
                in_opp.append(c)
            elif rows[i].family_id != rows[j].family_id and rows[i].label == rows[j].label:
                cross_same.append(c)
    opp = mean(in_opp) if in_opp else 0.0
    same = mean(cross_same) if cross_same else 0.0
    return {
        "nInFamilyOpposite": len(in_opp),
        "nCrossFamilySameLabel": len(cross_same),
        "meanInFamilyOpposite": round(opp, 4),
        "meanCrossFamilySameLabel": round(same, 4),
        "gap": round(same - opp, 4),
    }
