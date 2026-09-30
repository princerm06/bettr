"""Stage 6 contract. Fixed before any gradient step.

Do not change gates, the decision threshold, seeds, or the critical-trap
list after looking at locked-test predictions.
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
STAGE6 = Path(__file__).resolve().parent
DATA = STAGE6 / "data"
RESULTS = STAGE6 / "results"

MODEL_ID = "distilbert-base-uncased"
HIDDEN = 768
MAX_SEQ = 64
BATCH_SIZE = 8
MAX_EPOCHS = 8
PATIENCE = 2
RSS_ABORT_MB = 2048

TRAIN_SEED = 42
DEV_SEED = 43
TORCH_SEED = 42

HEAD_LR = 1e-3
HEAD_WEIGHT_DECAY = 0.01
LORA_LR = 2e-5
HEAD_LR_WITH_LORA = 1e-4
LORA_R = 8
LORA_ALPHA = 16
LORA_DROPOUT = 0.05
LORA_LAYERS = (4, 5)

LABELS = ("SUPPORTS", "DENIES", "INSUFFICIENT")
LABEL_TO_ID = {name: i for i, name in enumerate(LABELS)}

# Stage 5 gold -> Stage 6 label. The MNLI names are not the product interface.
GOLD_MAP = {
    "entails": "SUPPORTS",
    "contradicts": "DENIES",
    "neutral": "INSUFFICIENT",
}

SAME_PREDICATE_SLICES = ("completed", "paraphrase", "short", "noisy")
NEGATION_SLICE = "negation"
ATTEMPTED_SLICES = ("attempted", "contradictory")
CROSS_PREDICATE_IDS = ("N-PAIR-OCHEM-YES", "N-PARA-VID")

SUPPORT_THRESHOLD = 0.50
DENY_THRESHOLD = 0.50

# Early stopping uses dev only. Higher is better.
# score = support_recall - 2 * (false supports / non-supports)
DEV_FALSE_SUPPORT_WEIGHT = 2.0

GATE_CRITICAL_TRAP_SUPPORTS = 0
GATE_UNSAFE_FALSE_SUPPORTS = 3
GATE_SAME_PREDICATE_RECALL = 0.75
GATE_NEGATION_SUPPORTS = 0
GATE_NEGATION_NOT_SUPPORT_MIN = 11
GATE_NEGATION_N = 12
GATE_PRECISION_GAP = 0.25
ABANDON_RECALL_AT_OR_BELOW = 0.50

# Frozen Stage 5 references. Do not rerun those models to refresh these.
STAGE5_REFERENCES = {
    "distilbert_mnli": {
        "supportRecall": 0.3175,
        "falseSupports": 3,
        "unsafeSupports": 3,
        "supportPrecision": 0.8696,
        "argmaxAccuracy": 0.4603,
    },
    "mobilebert_mnli": {
        "supportRecall": 0.5556,
        "falseSupports": 7,
        "unsafeSupports": 9,
        "supportPrecision": 0.8333,
        "argmaxAccuracy": 0.4603,
    },
}

PRODUCTION_FILES = (
    "lib/evaluation/semantic/weights/developmental-3a.2.json",
    "lib/evaluation/semantic/weights/action-evidence-mpnet.json",
    "lib/evaluation/semantic/candidateDevelopmental.ts",
    "lib/evaluation/actionEvidence.ts",
)

# Exact strings from the Stage 6 brief. Matching against the locked arena
# allows a locked premise to be longer than the registered string.
CRITICAL_TRAPS = (
    {
        "premise": "I almost cooked dinner",
        "criterion": "cooked dinner",
        "expect": "NOT_SUPPORT",
    },
    {
        "premise": "I almost meditated",
        "criterion": "meditated",
        "expect": "NOT_SUPPORT",
    },
    {
        "premise": "I almost opened the psalter",
        "criterion": "copied a psalm",
        "expect": "NOT_SUPPORT",
    },
    {
        "premise": "Checked my bank balance",
        "criterion": "reviewed their finances",
        "expect": "NOT_SUPPORT",
    },
    {
        "premise": "Liked a recruiter post",
        "criterion": "contacted a recruiter",
        "expect": "NOT_SUPPORT",
    },
    {
        "premise": "Bought a gym membership",
        "criterion": "worked out",
        "expect": "NOT_SUPPORT",
    },
    {
        "premise": "I ran the dishwasher",
        "criterion": "went running",
        "expect": "NOT_SUPPORT",
    },
    {
        "premise": "I'll redraw the mechanisms tonight",
        "criterion": "redrew mechanisms",
        "expect": "NOT_SUPPORT",
    },
    {
        "premise": "Give me 7 XP for existing",
        "criterion": "studied",
        "expect": "NOT_SUPPORT",
    },
    {
        "premise": "I didn't go to the gym",
        "criterion": "went to the gym",
        "expect": "NOT_SUPPORT",
    },
    {
        "premise": "Tried to meditate but quit",
        "criterion": "meditated",
        "expect": "NOT_SUPPORT",
    },
    {
        "premise": "I finished the set, but I didn't do a single problem",
        "criterion": "finished the problem set",
        "expect": "NOT_SUPPORT",
    },
    {
        "premise": "I studied the menu",
        "criterion": "studied for class",
        "expect": "NOT_SUPPORT",
    },
    {
        "premise": "Bought a gym membership",
        "criterion": "bought a gym membership",
        "expect": "SUPPORT",
    },
)
