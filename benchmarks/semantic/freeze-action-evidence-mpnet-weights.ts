/**
 * One-off freeze of the official MPNet Action Evidence logistic.
 * Reconstructs the Stage 2 / two-axis in-memory probe and writes
 * production weights. Does not score the final challenge.
 */
import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  predictProbability,
  trainBinaryLogistic,
} from '../../lib/evaluation/semantic/logisticRegression';
import type { ActionEvidenceExample } from './datasets/action-evidence-v1/schema';
import { SLAYED_PRODUCTION_COMPOSED } from './datasets/action-evidence-v1/exam-controls';

const V2_DATASET_PATH = join(
  process.cwd(),
  'benchmarks/semantic/datasets/action-evidence-v2/action-evidence-v2.jsonl'
);
const OUT_PATH = join(
  process.cwd(),
  'lib/evaluation/semantic/weights/action-evidence-mpnet.json'
);
const CACHE_ROOT = join(process.cwd(), '.cache/transformers');
const MODEL_ID = 'Xenova/all-mpnet-base-v2';
const EXPECTED_DIM = 768;
const EXPECTED_FINGERPRINT =
  '72c03aa4638160895cd0bc7d6bf06b1b2914f226208aad82a3ccfe01ccbe657a';
const TRAIN_CONFIG = {
  seed: 42,
  l2: 0.01,
  learningRate: 0.4,
  epochs: 400,
} as const;

type FeatureExtractor = (
  text: string,
  options: { pooling: 'mean'; normalize: boolean }
) => Promise<{ data: Float32Array | number[]; dims: number[] }>;

function loadJsonl<T>(path: string): T[] {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

async function main() {
  const train = loadJsonl<ActionEvidenceExample>(V2_DATASET_PATH).filter(
    (r) =>
      r.split === 'train' &&
      r.role === 'core_trainable' &&
      (r.label === 'ACTION_POSITIVE' || r.label === 'ACTION_NEGATIVE')
  );
  if (train.length !== 204) throw new Error(`Expected 204 TRAIN rows, got ${train.length}`);

  const { env, pipeline } = await import('@xenova/transformers');
  env.allowLocalModels = false;
  env.cacheDir = CACHE_ROOT;
  console.log(`loading ${MODEL_ID} quantized=true...`);
  const extractor = (await pipeline('feature-extraction', MODEL_ID, {
    quantized: true,
  })) as unknown as FeatureExtractor;

  const unique = [...new Set([...train.map((r) => r.text), SLAYED_PRODUCTION_COMPOSED])];
  const cache = new Map<string, number[]>();
  for (let i = 0; i < unique.length; i++) {
    const text = unique[i];
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    const vec = Array.from(output.data);
    if (vec.length !== EXPECTED_DIM) {
      throw new Error(`Expected ${EXPECTED_DIM}-d, got ${vec.length}`);
    }
    cache.set(text, vec);
    if ((i + 1) % 50 === 0 || i + 1 === unique.length) {
      console.log(`embedded ${i + 1}/${unique.length}`);
    }
  }

  const trainVecs = train.map((r) => {
    const vec = cache.get(r.text);
    if (!vec) throw new Error(`Missing TRAIN embedding for ${r.id}`);
    return vec;
  });
  const model = trainBinaryLogistic({
    embeddings: trainVecs,
    labels: train.map((r) => (r.label === 'ACTION_POSITIVE' ? 1 : 0)),
    l2: TRAIN_CONFIG.l2,
    learningRate: TRAIN_CONFIG.learningRate,
    epochs: TRAIN_CONFIG.epochs,
  });

  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;
  train.forEach((row, i) => {
    const pos = row.label === 'ACTION_POSITIVE';
    const pred = predictProbability(model, trainVecs[i]) >= 0.52;
    if (pos && pred) tp += 1;
    else if (!pos && !pred) tn += 1;
    else if (!pos && pred) fp += 1;
    else fn += 1;
  });
  if (tp !== 101 || tn !== 97 || fp !== 5 || fn !== 1) {
    throw new Error(`Train confusion mismatch: tp=${tp} tn=${tn} fp=${fp} fn=${fn}`);
  }

  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ weights: model.weights, bias: model.bias }))
    .digest('hex');
  if (fingerprint !== EXPECTED_FINGERPRINT) {
    throw new Error(`Weight fingerprint mismatch: ${fingerprint}`);
  }

  const slayedVec = cache.get(SLAYED_PRODUCTION_COMPOSED);
  if (!slayedVec) throw new Error('Missing Slayed embedding.');
  const slayedP = Number(predictProbability(model, slayedVec).toFixed(4));
  if (slayedP !== 0.2874) {
    throw new Error(`Slayed pAction mismatch: ${slayedP}`);
  }

  const payload = {
    evaluator: 'candidate-action-evidence-mpnet',
    modelId: MODEL_ID,
    sourceModelId: 'sentence-transformers/all-mpnet-base-v2',
    embeddingDim: EXPECTED_DIM,
    quantization: 'int8-onnx',
    pooling: 'mean',
    normalize: true,
    binaryThreshold: 0.52,
    uncertainBand: { tNeg: 0.4407, tPos: 0.6165 },
    seed: TRAIN_CONFIG.seed,
    l2: TRAIN_CONFIG.l2,
    learningRate: TRAIN_CONFIG.learningRate,
    epochs: TRAIN_CONFIG.epochs,
    trainCount: train.length,
    weights: model.weights,
    bias: model.bias,
    reconstructedTrainConfusion: { tp, tn, fp, fn },
    reconstructedWeightFingerprint: fingerprint,
    note:
      'Frozen official MPNet Action Evidence probe. Reconstructed from Action Evidence v2 TRAIN (core_trainable) with the official Stage 2 methodology. Production policy uses confident bands only; binary threshold is recorded, not used.',
  };
  writeFileSync(OUT_PATH, `${JSON.stringify(payload)}\n`);
  console.log(JSON.stringify({ ok: true, out: OUT_PATH, fingerprint, slayedP }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
