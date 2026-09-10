/**
 * Candidate #4A — frozen embedding bakeoff (train-family CV only).
 * MiniLM vs BGE-small vs Arctic-embed-xs. Linear head only.
 * Does not read the 92-row val set or Semantic Benchmark v1.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { DevelopmentalExample } from './datasets/developmental-v1/schema';
import { trainBinaryLogistic, predictProbability } from '../../lib/evaluation/semantic/logisticRegression';
import {
  FROZEN_BACKBONES,
  embedFrozenText,
  loadFrozenEncoder,
  type FrozenBackboneId,
  type FrozenBackboneSpec,
} from '../../lib/evaluation/semantic/frozenSentenceEmbeddings';

const DATASET_PATH = join(
  process.cwd(),
  'benchmarks/semantic/datasets/developmental-v1/developmental-v1.jsonl'
);
const FOLDS_PATH = join(
  process.cwd(),
  'benchmarks/semantic/results/developmental-candidate-3a.3-cv.json'
);
const CV_PATH = join(
  process.cwd(),
  'benchmarks/semantic/results/developmental-candidate-4a-cv.json'
);

const TRAIN_CONFIG = {
  seed: 42,
  l2: 0.01,
  learningRate: 0.4,
  epochs: 400,
  binaryThreshold: 0.5,
} as const;

const BOTH_SIDES_GATE = 0.1;
const FAMILY_BA_GATE = 0.05;

const CACHE_ROOT = join(process.cwd(), '.cache/transformers');

function dirSizeBytes(dir: string): number {
  try {
    let total = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      total += entry.isDirectory() ? dirSizeBytes(p) : statSync(p).size;
    }
    return total;
  } catch {
    return 0;
  }
}

function listOnnxFiles(dir: string): string[] {
  const out: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...listOnnxFiles(p));
      else if (entry.name.endsWith('.onnx')) {
        out.push(`${entry.name} (${Math.round(statSync(p).size / 1024)} KB)`);
      }
    }
  } catch {
    /* missing cache */
  }
  return out;
}

function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function std(values: number[]) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((s, x) => s + (x - m) ** 2, 0) / (values.length - 1));
}

function l2Norm(vec: number[]) {
  return Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
}

function metrics(yTrue: string[], yPred: string[]) {
  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;
  for (let i = 0; i < yTrue.length; i++) {
    const t = yTrue[i] === 'DEVELOPMENTAL';
    const p = yPred[i] === 'DEVELOPMENTAL';
    if (t && p) tp += 1;
    else if (!t && !p) tn += 1;
    else if (!t && p) fp += 1;
    else fn += 1;
  }
  const recPos = tp / Math.max(1, tp + fn);
  const recNeg = tn / Math.max(1, tn + fp);
  const precPos = tp / Math.max(1, tp + fp);
  const precNeg = tn / Math.max(1, tn + fn);
  const f1Pos = (2 * precPos * recPos) / Math.max(1e-12, precPos + recPos);
  const f1Neg = (2 * precNeg * recNeg) / Math.max(1e-12, precNeg + recNeg);
  return {
    n: yTrue.length,
    accuracy: Number(((tp + tn) / Math.max(1, yTrue.length)).toFixed(4)),
    balancedAccuracy: Number(((recPos + recNeg) / 2).toFixed(4)),
    precision: Number(precPos.toFixed(4)),
    recall: Number(recPos.toFixed(4)),
    f1: Number(f1Pos.toFixed(4)),
    macroF1: Number(((f1Pos + f1Neg) / 2).toFixed(4)),
    confusion: { tp, tn, fp, fn },
  };
}

function classify(p: number) {
  return p >= TRAIN_CONFIG.binaryThreshold ? 'DEVELOPMENTAL' : 'NON_DEVELOPMENTAL';
}

function nll(model: { weights: number[]; bias: number }, embeddings: number[][], labels: number[]) {
  let s = 0;
  for (let i = 0; i < embeddings.length; i++) {
    const p = Math.min(1 - 1e-12, Math.max(1e-12, predictProbability(model, embeddings[i])));
    s += -(labels[i] * Math.log(p) + (1 - labels[i]) * Math.log(1 - p));
  }
  return s / Math.max(1, embeddings.length);
}

function familyHeldOut(rows: DevelopmentalExample[], predicted: string[], probs: number[]) {
  const byFam = new Map<string, { y: string[]; p: string[]; pr: number[] }>();
  rows.forEach((row, i) => {
    const cur = byFam.get(row.familyId) ?? { y: [], p: [], pr: [] };
    cur.y.push(row.label);
    cur.p.push(predicted[i]);
    cur.pr.push(probs[i]);
    byFam.set(row.familyId, cur);
  });
  const perFamily = [...byFam.entries()].map(([familyId, slice]) => {
    const m = metrics(slice.y, slice.p);
    const both = slice.y.includes('DEVELOPMENTAL') && slice.y.includes('NON_DEVELOPMENTAL');
    return {
      familyId,
      n: slice.y.length,
      balancedAccuracy: m.balancedAccuracy,
      accuracy: m.accuracy,
      bothSides: both,
      bothSidesCorrect: both && slice.y.every((y, i) => y === slice.p[i]),
    };
  });
  const bothSides = perFamily.filter((f) => f.bothSides);
  const pDev = rows
    .map((r, i) => (r.label === 'DEVELOPMENTAL' ? probs[i] : null))
    .filter((x): x is number => x !== null);
  const pNon = rows
    .map((r, i) => (r.label === 'NON_DEVELOPMENTAL' ? probs[i] : null))
    .filter((x): x is number => x !== null);
  return {
    meanFamilyBalancedAccuracy: Number(mean(perFamily.map((f) => f.balancedAccuracy)).toFixed(4)),
    bothSidesRate:
      bothSides.length === 0
        ? null
        : Number((bothSides.filter((f) => f.bothSidesCorrect).length / bothSides.length).toFixed(4)),
    bothSidesN: bothSides.length,
    bothSidesCorrectCount: bothSides.filter((f) => f.bothSidesCorrect).length,
    meanPDev: Number(mean(pDev).toFixed(4)),
    meanPNon: Number(mean(pNon).toFixed(4)),
  };
}

function cacheDirFor(spec: FrozenBackboneSpec) {
  return join(CACHE_ROOT, spec.runtimeModelId);
}

async function smokeAndEmbed(spec: FrozenBackboneSpec, texts: string[]) {
  const t0 = Date.now();
  const loaded = await loadFrozenEncoder(spec);
  const coldMs = Date.now() - t0;
  const t1 = Date.now();
  const smoke = await embedFrozenText('hello');
  const smokeMs = Date.now() - t1;
  if (smoke.length !== spec.expectedDim) {
    throw new Error(`${spec.id} smoke dim ${smoke.length}`);
  }
  const times: number[] = [];
  const embeddings: number[][] = [];
  for (const text of texts) {
    const start = Date.now();
    embeddings.push(await embedFrozenText(text));
    times.push(Date.now() - start);
  }
  const sorted = [...times].sort((a, b) => a - b);
  const cacheDir = cacheDirFor(spec);
  const cacheBytes = dirSizeBytes(cacheDir);
  return {
    loaded: {
      runtimeModelId: spec.runtimeModelId,
      sourceModelId: spec.sourceModelId,
      license: spec.license,
      pooling: spec.pooling,
      normalize: spec.normalize,
      queryPrefix: spec.queryPrefix,
      quantized: loaded.quantized,
      quantization: loaded.quantization,
      embeddingDim: smoke.length,
      smokeL2: Number(l2Norm(smoke).toFixed(4)),
      coldLoadMs: coldMs,
      smokeEmbedMs: smokeMs,
      cacheDir,
      cacheBytes,
      cacheMb: Number((cacheBytes / (1024 * 1024)).toFixed(2)),
      onnxFiles: listOnnxFiles(cacheDir),
    },
    embeddings,
    latency: {
      n: times.length,
      medianMs: sorted[Math.floor(sorted.length / 2)],
      p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
      meanMs: Number(mean(times).toFixed(2)),
    },
  };
}

function applyGate(
  minilm: { id: FrozenBackboneId; meanBothSides: number; meanFamilyBA: number },
  challengers: Array<{ id: FrozenBackboneId; meanBothSides: number; meanFamilyBA: number }>
) {
  const winners = challengers.filter((c) => {
    const bothGain = c.meanBothSides - minilm.meanBothSides;
    const baGain = c.meanFamilyBA - minilm.meanFamilyBA;
    const bothNotWorse = c.meanBothSides >= minilm.meanBothSides;
    return bothGain >= BOTH_SIDES_GATE || (baGain >= FAMILY_BA_GATE && bothNotWorse);
  });
  winners.sort((a, b) => {
    if (a.meanBothSides !== b.meanBothSides) return b.meanBothSides - a.meanBothSides;
    return b.meanFamilyBA - a.meanFamilyBA;
  });
  if (!winners.length) {
    return {
      decision: 'NULL_BAKEOFF' as const,
      winner: null,
      reason:
        'No challenger cleared the predeclared gate (both-sides +0.10 vs MiniLM, or family BA +0.05 with both-sides not worse).',
    };
  }
  return {
    decision: 'REPRESENTATION_WINNER' as const,
    winner: winners[0].id,
    reason: `${winners[0].id} cleared the materiality gate versus MiniLM.`,
  };
}

async function main() {
  const rows = readFileSync(DATASET_PATH, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as DevelopmentalExample);
  const train = rows.filter(
    (r) =>
      r.role === 'core_trainable' &&
      r.split === 'train' &&
      (r.label === 'DEVELOPMENTAL' || r.label === 'NON_DEVELOPMENTAL')
  );
  if (train.length !== 405) throw new Error(`Expected 405 train rows, got ${train.length}`);

  const foldFile = JSON.parse(readFileSync(FOLDS_PATH, 'utf8')) as {
    foldConstruction: { k: number; seed: number; algorithm: string; folds: Array<{ fold: number; familyIds: string[] }> };
  };
  const familyToFold = new Map<string, number>();
  for (const fold of foldFile.foldConstruction.folds) {
    for (const familyId of fold.familyIds) familyToFold.set(familyId, fold.fold);
  }
  if (familyToFold.size !== 60) throw new Error(`Expected 60 train families in 3A.3 folds, got ${familyToFold.size}`);

  const labels = train.map((r) => (r.label === 'DEVELOPMENTAL' ? 1 : 0));
  const backboneResults = [];

  for (const spec of FROZEN_BACKBONES) {
    console.log(`SMOKE+EMBED ${spec.id} ${spec.runtimeModelId}`);
    const packed = await smokeAndEmbed(
      spec,
      train.map((r) => r.text)
    );
    const perFold = [];
    for (let k = 0; k < 5; k++) {
      const trainIdx: number[] = [];
      const holdIdx: number[] = [];
      train.forEach((row, i) => {
        if (familyToFold.get(row.familyId) === k) holdIdx.push(i);
        else trainIdx.push(i);
      });
      const holdFamilies = new Set(holdIdx.map((i) => train[i].familyId));
      for (const i of trainIdx) {
        if (holdFamilies.has(train[i].familyId)) throw new Error('family leakage');
      }
      const model = trainBinaryLogistic({
        embeddings: trainIdx.map((i) => packed.embeddings[i]),
        labels: trainIdx.map((i) => labels[i]),
        l2: TRAIN_CONFIG.l2,
        learningRate: TRAIN_CONFIG.learningRate,
        epochs: TRAIN_CONFIG.epochs,
      });
      const holdRows = holdIdx.map((i) => train[i]);
      const probs = holdIdx.map((i) => predictProbability(model, packed.embeddings[i]));
      const pred = probs.map(classify);
      const rowM = metrics(
        holdRows.map((r) => r.label),
        pred
      );
      const fam = familyHeldOut(holdRows, pred, probs);
      perFold.push({
        fold: k,
        nHoldout: holdIdx.length,
        row: rowM,
        meanFamilyBalancedAccuracy: fam.meanFamilyBalancedAccuracy,
        bothSidesRate: fam.bothSidesRate,
        bothSidesN: fam.bothSidesN,
        bothSidesCorrectCount: fam.bothSidesCorrectCount,
        holdoutNll: Number(
          nll(
            model,
            holdIdx.map((i) => packed.embeddings[i]),
            holdIdx.map((i) => labels[i])
          ).toFixed(4)
        ),
        meanPDev: fam.meanPDev,
        meanPNon: fam.meanPNon,
      });
    }
    const both = perFold.map((f) => f.bothSidesRate).filter((x): x is number => x !== null);
    backboneResults.push({
      id: spec.id,
      loaded: packed.loaded,
      latency: packed.latency,
      meanBothSides: Number(mean(both).toFixed(4)),
      stdBothSides: Number(std(both).toFixed(4)),
      meanFamilyBalancedAccuracy: Number(
        mean(perFold.map((f) => f.meanFamilyBalancedAccuracy)).toFixed(4)
      ),
      stdFamilyBalancedAccuracy: Number(
        std(perFold.map((f) => f.meanFamilyBalancedAccuracy)).toFixed(4)
      ),
      meanMacroF1: Number(mean(perFold.map((f) => f.row.macroF1)).toFixed(4)),
      stdMacroF1: Number(std(perFold.map((f) => f.row.macroF1)).toFixed(4)),
      meanRowAccuracy: Number(mean(perFold.map((f) => f.row.accuracy)).toFixed(4)),
      stdRowAccuracy: Number(std(perFold.map((f) => f.row.accuracy)).toFixed(4)),
      meanHoldoutNll: Number(mean(perFold.map((f) => f.holdoutNll)).toFixed(4)),
      meanPDev: Number(mean(perFold.map((f) => f.meanPDev)).toFixed(4)),
      meanPNon: Number(mean(perFold.map((f) => f.meanPNon)).toFixed(4)),
      folds: perFold,
    });
  }

  const byId = Object.fromEntries(backboneResults.map((r) => [r.id, r])) as Record<
    FrozenBackboneId,
    (typeof backboneResults)[0]
  >;
  const minilm = byId.minilm;
  const gate = applyGate(
    {
      id: 'minilm',
      meanBothSides: minilm.meanBothSides,
      meanFamilyBA: minilm.meanFamilyBalancedAccuracy,
    },
    [
      {
        id: 'bge',
        meanBothSides: byId.bge.meanBothSides,
        meanFamilyBA: byId.bge.meanFamilyBalancedAccuracy,
      },
      {
        id: 'arctic',
        meanBothSides: byId.arctic.meanBothSides,
        meanFamilyBA: byId.arctic.meanFamilyBalancedAccuracy,
      },
    ]
  );

  const report = {
    evaluator: 'candidate-developmental-4a',
    pass: 'train-family-cv-representation-bakeoff',
    generatedAt: new Date().toISOString(),
    dataset: {
      path: 'benchmarks/semantic/datasets/developmental-v1/developmental-v1.jsonl',
      trainRows: train.length,
      note: '3A.2 train freeze. 92-row val not loaded. v1 not loaded.',
    },
    trainConfig: TRAIN_CONFIG,
    foldSource: FOLDS_PATH,
    foldConstruction: foldFile.foldConstruction,
    materialityGate: {
      bothSidesAbsolute: BOTH_SIDES_GATE,
      familyBaAbsolute: FAMILY_BA_GATE,
      rule: 'Challenger wins if mean CV both-sides >= MiniLM + 0.10, OR family BA >= MiniLM + 0.05 AND both-sides is not worse.',
    },
    backbones: backboneResults,
    comparison: {
      minilm: {
        meanBothSides: minilm.meanBothSides,
        meanFamilyBalancedAccuracy: minilm.meanFamilyBalancedAccuracy,
        meanMacroF1: minilm.meanMacroF1,
        meanRowAccuracy: minilm.meanRowAccuracy,
      },
      arctic: {
        meanBothSides: byId.arctic.meanBothSides,
        deltaBothSidesVsMiniLM: Number((byId.arctic.meanBothSides - minilm.meanBothSides).toFixed(4)),
        meanFamilyBalancedAccuracy: byId.arctic.meanFamilyBalancedAccuracy,
        deltaFamilyBaVsMiniLM: Number(
          (byId.arctic.meanFamilyBalancedAccuracy - minilm.meanFamilyBalancedAccuracy).toFixed(4)
        ),
        meanMacroF1: byId.arctic.meanMacroF1,
        meanRowAccuracy: byId.arctic.meanRowAccuracy,
      },
      bge: {
        meanBothSides: byId.bge.meanBothSides,
        deltaBothSidesVsMiniLM: Number((byId.bge.meanBothSides - minilm.meanBothSides).toFixed(4)),
        meanFamilyBalancedAccuracy: byId.bge.meanFamilyBalancedAccuracy,
        deltaFamilyBaVsMiniLM: Number(
          (byId.bge.meanFamilyBalancedAccuracy - minilm.meanFamilyBalancedAccuracy).toFixed(4)
        ),
        meanMacroF1: byId.bge.meanMacroF1,
        meanRowAccuracy: byId.bge.meanRowAccuracy,
      },
    },
    gate,
  };

  mkdirSync(join(process.cwd(), 'benchmarks/semantic/results'), { recursive: true });
  writeFileSync(CV_PATH, JSON.stringify(report, null, 2));
  console.log('CANDIDATE #4A TRAIN-FAMILY CV');
  console.log(
    JSON.stringify(
      {
        loaded: backboneResults.map((r) => r.loaded),
        latency: Object.fromEntries(backboneResults.map((r) => [r.id, r.latency])),
        means: backboneResults.map((r) => ({
          id: r.id,
          bothSides: r.meanBothSides,
          stdBothSides: r.stdBothSides,
          familyBA: r.meanFamilyBalancedAccuracy,
          macroF1: r.meanMacroF1,
          rowAcc: r.meanRowAccuracy,
          nll: r.meanHoldoutNll,
        })),
        perFoldBothSides: Object.fromEntries(
          backboneResults.map((r) => [r.id, r.folds.map((f) => f.bothSidesRate)])
        ),
        comparison: report.comparison,
        gate,
        cvPath: CV_PATH,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
