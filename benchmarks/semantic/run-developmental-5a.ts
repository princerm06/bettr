/**
 * Candidate #5A — locked family-hard triplet projection on frozen MiniLM.
 * Train-family CV only. Does not read the 92-row val set or Semantic Benchmark v1.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { DevelopmentalExample } from './datasets/developmental-v1/schema';
import { trainBinaryLogistic, predictProbability } from '../../lib/evaluation/semantic/logisticRegression';
import { embedText, loadMiniLm } from '../../lib/evaluation/semantic/minilmEmbeddings';
import {
  cosine,
  project,
  trainProjection,
  type Triplet,
} from '../../lib/evaluation/semantic/metricProjection';

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
  'benchmarks/semantic/results/developmental-candidate-5a-cv.json'
);

const LOCKED = {
  encoder: 'Xenova/all-MiniLM-L6-v2',
  projection: 'linear 384→64 + bias, L2 normalize, no nonlinearity',
  dim: 64,
  margin: 0.2,
  lambdaAttraction: 0,
  projL2: 0.01,
  projLr: 0.05,
  epochs: 80,
  batchSize: 24,
  maxPairsPerFamily: 8,
  seed: 42,
  probe: { l2: 0.01, learningRate: 0.4, epochs: 400, threshold: 0.5 },
} as const;

const GATE = {
  bothSides: 0.565,
  familyBa: 0.859,
  bothSidesFloorForBaPath: 0.465,
} as const;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rng: () => number) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
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
  return p >= LOCKED.probe.threshold ? 'DEVELOPMENTAL' : 'NON_DEVELOPMENTAL';
}

function nll(model: { weights: number[]; bias: number }, embeddings: number[][], labels: number[]) {
  let s = 0;
  for (let i = 0; i < embeddings.length; i++) {
    const p = Math.min(1 - 1e-12, Math.max(1e-12, predictProbability(model, embeddings[i])));
    s += -(labels[i] * Math.log(p) + (1 - labels[i]) * Math.log(1 - p));
  }
  return s / Math.max(1, embeddings.length);
}

function familyMetrics(rows: DevelopmentalExample[], predicted: string[]) {
  const byFam = new Map<string, { y: string[]; p: string[] }>();
  rows.forEach((row, i) => {
    const cur = byFam.get(row.familyId) ?? { y: [], p: [] };
    cur.y.push(row.label);
    cur.p.push(predicted[i]);
    byFam.set(row.familyId, cur);
  });
  const perFamily = [...byFam.entries()].map(([, slice]) => {
    const m = metrics(slice.y, slice.p);
    const both = slice.y.includes('DEVELOPMENTAL') && slice.y.includes('NON_DEVELOPMENTAL');
    return {
      balancedAccuracy: m.balancedAccuracy,
      bothSides: both,
      bothSidesCorrect: both && slice.y.every((y, i) => y === slice.p[i]),
    };
  });
  const bothSides = perFamily.filter((f) => f.bothSides);
  return {
    meanFamilyBalancedAccuracy: Number(mean(perFamily.map((f) => f.balancedAccuracy)).toFixed(4)),
    bothSidesRate:
      bothSides.length === 0
        ? null
        : Number((bothSides.filter((f) => f.bothSidesCorrect).length / bothSides.length).toFixed(4)),
    bothSidesN: bothSides.length,
    bothSidesCorrectCount: bothSides.filter((f) => f.bothSidesCorrect).length,
  };
}

function pairCosines(
  rows: DevelopmentalExample[],
  vecs: number[][]
) {
  const inFamilyOpp: number[] = [];
  const crossSame: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const c = cosine(vecs[i], vecs[j]);
      if (rows[i].familyId === rows[j].familyId && rows[i].label !== rows[j].label) {
        inFamilyOpp.push(c);
      } else if (rows[i].familyId !== rows[j].familyId && rows[i].label === rows[j].label) {
        crossSame.push(c);
      }
    }
  }
  const opp = inFamilyOpp.length ? mean(inFamilyOpp) : 0;
  const same = crossSame.length ? mean(crossSame) : 0;
  return {
    nInFamilyOpposite: inFamilyOpp.length,
    nCrossFamilySameLabel: crossSame.length,
    meanInFamilyOpposite: Number(opp.toFixed(4)),
    meanCrossFamilySameLabel: Number(same.toFixed(4)),
    gap: Number((same - opp).toFixed(4)),
  };
}

function pickPositive(
  anchor: DevelopmentalExample,
  pool: DevelopmentalExample[],
  poolIdx: number[],
  contrastHasMultiple: Set<string>,
  rng: () => number
) {
  const sameContrast: number[] = [];
  const sameDomain: number[] = [];
  const any: number[] = [];
  for (const i of poolIdx) {
    const row = pool[i];
    if (row.id === anchor.id) continue;
    if (row.label !== anchor.label) continue;
    if (row.familyId === anchor.familyId) continue;
    any.push(i);
    if (row.domain === anchor.domain) sameDomain.push(i);
    if (row.contrastGroup === anchor.contrastGroup && contrastHasMultiple.has(anchor.contrastGroup)) {
      sameContrast.push(i);
    }
  }
  const chosen = sameContrast.length ? sameContrast : sameDomain.length ? sameDomain : any;
  if (!chosen.length) return null;
  return chosen[Math.floor(rng() * chosen.length)];
}

function buildTriplets(
  rows: DevelopmentalExample[],
  familySet: Set<string>,
  seed: number
) {
  const idx = rows.map((_, i) => i).filter((i) => familySet.has(rows[i].familyId));
  const byFamily = new Map<string, { dev: number[]; non: number[] }>();
  const contrastFamilies = new Map<string, Set<string>>();
  for (const i of idx) {
    const row = rows[i];
    const cur = byFamily.get(row.familyId) ?? { dev: [], non: [] };
    if (row.label === 'DEVELOPMENTAL') cur.dev.push(i);
    else cur.non.push(i);
    byFamily.set(row.familyId, cur);
    const set = contrastFamilies.get(row.contrastGroup) ?? new Set();
    set.add(row.familyId);
    contrastFamilies.set(row.contrastGroup, set);
  }
  const contrastHasMultiple = new Set(
    [...contrastFamilies.entries()].filter(([, s]) => s.size > 1).map(([k]) => k)
  );

  const rng = mulberry32(seed);
  const directed: Array<{ a: number; n: number }> = [];
  let uniqueHardPairs = 0;
  for (const [, g] of byFamily) {
    const unordered: Array<{ a: number; n: number }> = [];
    for (const d of g.dev) {
      for (const n of g.non) unordered.push({ a: d, n });
    }
    uniqueHardPairs += unordered.length;
    const directedFam: Array<{ a: number; n: number }> = [];
    for (const p of unordered) {
      directedFam.push(p);
      directedFam.push({ a: p.n, n: p.a });
    }
    const capped = shuffle(directedFam, rng).slice(0, LOCKED.maxPairsPerFamily);
    directed.push(...capped);
  }

  const triplets: Triplet[] = [];
  let skippedNoPos = 0;
  for (const pair of directed) {
    const p = pickPositive(rows[pair.a], rows, idx, contrastHasMultiple, rng);
    if (p === null) {
      skippedNoPos += 1;
      continue;
    }
    triplets.push({ a: pair.a, p, n: pair.n });
  }

  return {
    triplets,
    uniqueTrainFamilies: familySet.size,
    uniqueHardOppositePairs: uniqueHardPairs,
    directedPairsAfterCap: directed.length,
    tripletsSampled: triplets.length,
    skippedNoPos,
    multiFamilyContrastGroups: [...contrastHasMultiple],
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
    foldConstruction: { folds: Array<{ fold: number; familyIds: string[] }> };
  };
  const familyToFold = new Map<string, number>();
  for (const fold of foldFile.foldConstruction.folds) {
    for (const id of fold.familyIds) familyToFold.set(id, fold.fold);
  }

  await loadMiniLm();
  const embeddings: number[][] = [];
  for (const row of train) embeddings.push(await embedText(row.text));
  const labels = train.map((r) => (r.label === 'DEVELOPMENTAL' ? 1 : 0));

  const perFold = [];
  for (let k = 0; k < 5; k++) {
    const trainIdx: number[] = [];
    const holdIdx: number[] = [];
    train.forEach((row, i) => {
      if (familyToFold.get(row.familyId) === k) holdIdx.push(i);
      else trainIdx.push(i);
    });
    const trainFamilies = new Set(trainIdx.map((i) => train[i].familyId));
    const holdFamilies = new Set(holdIdx.map((i) => train[i].familyId));
    for (const i of trainIdx) {
      if (holdFamilies.has(train[i].familyId)) throw new Error('family leakage');
    }

    const graph = buildTriplets(train, trainFamilies, LOCKED.seed + k);
    const proj = trainProjection({
      embeddings,
      triplets: graph.triplets,
      epochs: LOCKED.epochs,
      batchSize: LOCKED.batchSize,
      learningRate: LOCKED.projLr,
      l2: LOCKED.projL2,
      margin: LOCKED.margin,
      seed: LOCKED.seed,
    });

    const zAll = embeddings.map((e) => project(proj, e));
    const trainRows = trainIdx.map((i) => train[i]);
    const holdRows = holdIdx.map((i) => train[i]);
    const zTrain = trainIdx.map((i) => zAll[i]);
    const zHold = holdIdx.map((i) => zAll[i]);
    const xTrain = trainIdx.map((i) => embeddings[i]);
    const xHold = holdIdx.map((i) => embeddings[i]);

    const model = trainBinaryLogistic({
      embeddings: zTrain,
      labels: trainIdx.map((i) => labels[i]),
      l2: LOCKED.probe.l2,
      learningRate: LOCKED.probe.learningRate,
      epochs: LOCKED.probe.epochs,
    });
    const probs = zHold.map((z) => predictProbability(model, z));
    const pred = probs.map(classify);
    const rowM = metrics(
      holdRows.map((r) => r.label),
      pred
    );
    const fam = familyMetrics(holdRows, pred);
    const pDev = holdRows.map((r, i) => (r.label === 'DEVELOPMENTAL' ? probs[i] : null)).filter((x): x is number => x !== null);
    const pNon = holdRows.map((r, i) => (r.label === 'NON_DEVELOPMENTAL' ? probs[i] : null)).filter((x): x is number => x !== null);

    perFold.push({
      fold: k,
      nTrain: trainIdx.length,
      nHoldout: holdIdx.length,
      uniqueTrainFamilies: graph.uniqueTrainFamilies,
      uniqueHardOppositePairs: graph.uniqueHardOppositePairs,
      directedPairsAfterCap: graph.directedPairsAfterCap,
      tripletsPerEpoch: graph.tripletsSampled,
      skippedNoPos: graph.skippedNoPos,
      note: 'tripletsPerEpoch is sampled relationships, not independent sample size',
      geometry: {
        trainBefore: pairCosines(trainRows, xTrain),
        trainAfter: pairCosines(trainRows, zTrain),
        holdoutBefore: pairCosines(holdRows, xHold),
        holdoutAfter: pairCosines(holdRows, zHold),
      },
      row: rowM,
      meanFamilyBalancedAccuracy: fam.meanFamilyBalancedAccuracy,
      bothSidesRate: fam.bothSidesRate,
      bothSidesN: fam.bothSidesN,
      bothSidesCorrectCount: fam.bothSidesCorrectCount,
      holdoutNll: Number(nll(model, zHold, holdIdx.map((i) => labels[i])).toFixed(4)),
      meanPDev: Number(mean(pDev).toFixed(4)),
      meanPNon: Number(mean(pNon).toFixed(4)),
    });
  }

  const both = perFold.map((f) => f.bothSidesRate).filter((x): x is number => x !== null);
  const meanBoth = Number(mean(both).toFixed(4));
  const meanFam = Number(mean(perFold.map((f) => f.meanFamilyBalancedAccuracy)).toFixed(4));
  const gateA = meanBoth >= GATE.bothSides;
  const gateB = meanFam >= GATE.familyBa && meanBoth >= GATE.bothSidesFloorForBaPath;
  const success = gateA || gateB;

  const trainGapLift = mean(
    perFold.map((f) => f.geometry.trainAfter.gap - f.geometry.trainBefore.gap)
  );
  const holdGapLift = mean(
    perFold.map((f) => f.geometry.holdoutAfter.gap - f.geometry.holdoutBefore.gap)
  );

  let interpretation: 'SUCCESS' | 'NULL_MEMORIZE' | 'NULL_OBJECTIVE';
  if (success) interpretation = 'SUCCESS';
  else if (trainGapLift > 0.05 && holdGapLift < 0.02) interpretation = 'NULL_MEMORIZE';
  else interpretation = 'NULL_OBJECTIVE';

  const report = {
    evaluator: 'candidate-developmental-5a',
    pass: 'train-family-cv-locked-triplet-projection',
    generatedAt: new Date().toISOString(),
    locked: LOCKED,
    gate: GATE,
    dataset: {
      trainRows: train.length,
      note: '3A.2 train freeze. 92-row val not loaded. v1 not loaded.',
    },
    foldSource: FOLDS_PATH,
    controlMiniLmLinear: { meanBothSides: 0.4645, meanFamilyBalancedAccuracy: 0.8086 },
    folds: perFold,
    meanBothSides: meanBoth,
    stdBothSides: Number(std(both).toFixed(4)),
    meanFamilyBalancedAccuracy: meanFam,
    stdFamilyBalancedAccuracy: Number(std(perFold.map((f) => f.meanFamilyBalancedAccuracy)).toFixed(4)),
    meanMacroF1: Number(mean(perFold.map((f) => f.row.macroF1)).toFixed(4)),
    meanRowAccuracy: Number(mean(perFold.map((f) => f.row.accuracy)).toFixed(4)),
    meanHoldoutNll: Number(mean(perFold.map((f) => f.holdoutNll)).toFixed(4)),
    meanPDev: Number(mean(perFold.map((f) => f.meanPDev)).toFixed(4)),
    meanPNon: Number(mean(perFold.map((f) => f.meanPNon)).toFixed(4)),
    geometryTransfer: {
      meanTrainGapLift: Number(trainGapLift.toFixed(4)),
      meanHoldoutGapLift: Number(holdGapLift.toFixed(4)),
    },
    gateResult: {
      pathA: gateA,
      pathB: gateB,
      success,
      interpretation,
    },
  };

  mkdirSync(join(process.cwd(), 'benchmarks/semantic/results'), { recursive: true });
  writeFileSync(CV_PATH, JSON.stringify(report, null, 2));
  console.log('CANDIDATE #5A LOCKED CV');
  console.log(JSON.stringify({ locked: LOCKED, meanBothSides: meanBoth, meanFamilyBalancedAccuracy: meanFam, geometryTransfer: report.geometryTransfer, gateResult: report.gateResult, perFoldBothSides: perFold.map((f) => f.bothSidesRate), cvPath: CV_PATH }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
