"""Locked Candidate #6A constants. Do not change without a new candidate."""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]

BASE_MODEL_ID = "sentence-transformers/all-MiniLM-L6-v2"
EMBEDDING_DIM = 384
MAX_SEQ_LENGTH = 256

LORA_R = 8
LORA_ALPHA = 16
LORA_DROPOUT = 0.1
LORA_LAYERS = [4, 5]
EXPECTED_TRAINABLE = 110_592

MARGIN = 0.20
LAMBDA_ATTRACTION = 0.0
MAX_PAIRS_PER_FAMILY = 8
ENCODER_LR = 2e-5
WEIGHT_DECAY = 0.01
GRAD_CLIP = 1.0
BATCH_SIZE = 16
MAX_EPOCHS = 8
PATIENCE = 2
BOTH_SIDES_IMPROVE = 0.02

PROBE_L2 = 0.01
PROBE_LR = 0.4
PROBE_EPOCHS = 400
PROBE_THRESHOLD = 0.50

INNER_VAL_FAMILIES = 10
MIN_INNER_VAL_BOTH_SIDES = 8
INNER_SPLIT_SEED_BASE = 42
INNER_SPLIT_SEED_STRIDE = 1000

PAIR_SEED_STRIDE = 1_000_003

LOCKED_EVAL_SEEDS = (42, 123, 456)
BRINGUP_SEED = 42

GATE_BOTH_SIDES = 0.5645
GATE_FAMILY_BA = 0.8586
GATE_BOTH_SIDES_FLOOR = 0.4645

CONTROL_BOTH_SIDES = 0.4645
CONTROL_FAMILY_BA = 0.8086

DATASET_PATH = REPO_ROOT / "benchmarks/semantic/datasets/developmental-v1/developmental-v1.jsonl"
FOLDS_PATH = REPO_ROOT / "benchmarks/semantic/results/developmental-candidate-3a.3-cv.json"
BRINGUP_PATH = REPO_ROOT / "benchmarks/semantic/results/developmental-candidate-6a-bringup.json"
CV_PATH = REPO_ROOT / "benchmarks/semantic/results/developmental-candidate-6a-cv.json"

LORA_TARGET_MODULES = [
    "encoder.layer.4.attention.self.query",
    "encoder.layer.4.attention.self.key",
    "encoder.layer.4.attention.self.value",
    "encoder.layer.4.attention.output.dense",
    "encoder.layer.4.intermediate.dense",
    "encoder.layer.4.output.dense",
    "encoder.layer.5.attention.self.query",
    "encoder.layer.5.attention.self.key",
    "encoder.layer.5.attention.self.value",
    "encoder.layer.5.attention.output.dense",
    "encoder.layer.5.intermediate.dense",
    "encoder.layer.5.output.dense",
]
