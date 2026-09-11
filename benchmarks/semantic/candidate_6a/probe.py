"""Candidate #3A logistic probe (full-batch GD). Must match logisticRegression.ts."""

from __future__ import annotations

import math

import numpy as np

from .contract import PROBE_EPOCHS, PROBE_L2, PROBE_LR, PROBE_THRESHOLD


def sigmoid(z: float) -> float:
    if z >= 0:
        e = math.exp(-z)
        return 1.0 / (1.0 + e)
    e = math.exp(z)
    return e / (1.0 + e)


def predict_probability(weights: np.ndarray, bias: float, x: np.ndarray) -> float:
    z = float(bias + np.dot(weights, x))
    return sigmoid(z)


def train_binary_logistic(embeddings: np.ndarray, labels: np.ndarray) -> tuple[np.ndarray, float]:
    n, dim = embeddings.shape
    weights = np.zeros(dim, dtype=np.float64)
    bias = 0.0
    for _ in range(PROBE_EPOCHS):
        grad_w = np.zeros(dim, dtype=np.float64)
        grad_b = 0.0
        for i in range(n):
            p = predict_probability(weights, bias, embeddings[i])
            err = p - labels[i]
            grad_w += err * embeddings[i]
            grad_b += err
        grad_w = grad_w / n + PROBE_L2 * weights
        weights -= PROBE_LR * grad_w
        bias -= PROBE_LR * (grad_b / n)
    return weights, bias


def classify_prob(p: float) -> str:
    return "DEVELOPMENTAL" if p >= PROBE_THRESHOLD else "NON_DEVELOPMENTAL"
