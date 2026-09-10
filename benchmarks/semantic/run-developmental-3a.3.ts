/**
 * Candidate #3A.3 — train-only family-grouped model selection.
 * The 92-row / 12-family external validation set is not used until
 * a configuration is locked from grouped CV on the 405 training rows.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { DevelopmentalExample } from './datasets/developmental-v1/schema';
import {
  BINARY_THRESHOLD,
  type DevelopmentalWeightsFile,
} from '../../lib/evaluation/semantic/candidateDevelopmental';
import { trainBinaryLogistic, predictProbability } from '../../lib/evaluation/semantic/logisticRegression';
import {
  embedText,
  loadMiniLm,
  MINILM_EMBEDDING_DIM,
  MINILM_MODEL_ID,
  MINILM_QUANTIZATION,
} from '../../lib/evaluation/semantic/minilmEmbeddings';

const DATASET_PATH = join(
  process.cwd(),
  'benchmarks/semantic/datasets/developmental-v1/developmental-v1.jsonl'
);
const CV_PATH = join(
  process.cwd(),
  'benchmarks/semantic/results/developmental-candidate-3a.3-cv.json'
);
const WEIGHTS_PATH = join(
  process.cwd(),
  'lib/evaluation/semantic/weights/developmental-3a.3.json'
);
const VAL_PATH = join(
  process.cwd(),
  'benchmarks/semantic/results/developmental-candidate-3a.3-val.json'
);
const PREV = {
  '3a.1': join(process.cwd(), 'benchmarks/semantic/results/developmental-candidate-3a-val.json'),
  '3a.2': join(process.cwd(), 'benchmarks/semantic/results/developmental-candidate-3a.2-val.json'),
};

const FOLD_SEED = 42;
const K_FOLDS = 5;
const THRESHOLD = BINARY_THRESHOLD;
const MEAN_TIE_EPS = 0.005;

/** Predeclared grid. L2 is the primary axis; optimizer variants are at the 3A.2 L2. */
const GRID: Array<{ id: string; l2: number; learningRate: number; epochs: number }> = [
  { id: 'l2=0_lr=0.4_ep=400', l2: 0, learningRate: 0.4, epochs: 400 },
  { id: 'l2=0.001_lr=0.4_ep=400', l2: 0.001, learningRate: 0.4, epochs: 400 },
  { id: 'l2=0.01_lr=0.4_ep=400', l2: 0.01, learningRate: 0.4, epochs: 400 },
  { id: 'l2=0.1_lr=0.4_ep=400', l2: 0.1, learningRate: 0.4, epochs: 400 },
  { id: 'l2=1_lr=0.4_ep=400', l2: 1, learningRate: 0.4, epochs: 400 },
  { id: 'l2=0.01_lr=0.1_ep=400', l2: 0.01, learningRate: 0.1, epochs: 400 },
  { id: 'l2=0.01_lr=1_ep=400', l2: 0.01, learningRate: 1, epochs: 400 },
  { id: 'l2=0.01_lr=0.4_ep=200', l2: 0.01, learningRate: 0.4, epochs: 200 },
  { id: 'l2=0.01_lr=0.4_ep=800', l2: 0.01, learningRate: 0.4, epochs: 800 },
];

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

function shuffle<T>(items: T[], seed: number): T[] {
  const rng = mulberry32(seed);
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
  const v = values.reduce((s, x) => s + (x - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(v);
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
    devAccuracy: Number(recPos.toFixed(4)),
    nonDevAccuracy: Number(recNeg.toFixed(4)),
  };
}

function classify(p: number) {
  return p >= THRESHOLD ? 'DEVELOPMENTAL' : 'NON_DEVELOPMENTAL';
}

function nll(model: { weights: number[]; bias: number }, embeddings: number[][], labels: number[]) {
  let s = 0;
  for (let i = 0; i < embeddings.length; i++) {
    const p = Math.min(1 - 1e-12, Math.max(1e-12, predictProbability(model, embeddings[i])));
    s += -(labels[i] * Math.log(p) + (1 - labels[i]) * Math.log(1 - p));
  }
  return s / Math.max(1, embeddings.length);
}

type FamilyInfo = {
  familyId: string;
  domain: string;
  contrastGroup: string;
  n: number;
  nDev: number;
  nNon: number;
  bothSides: boolean;
  rowIndexes: number[];
};

function familyInfos(train: DevelopmentalExample[]): FamilyInfo[] {
  const map = new Map<string, FamilyInfo>();
  train.forEach((row, i) => {
    const cur = map.get(row.familyId) ?? {
      familyId: row.familyId,
      domain: row.domain,
      contrastGroup: row.contrastGroup,
      n: 0,
      nDev: 0,
      nNon: 0,
      bothSides: false,
      rowIndexes: [],
    };
    cur.n += 1;
    if (row.label === 'DEVELOPMENTAL') cur.nDev += 1;
    else cur.nNon += 1;
    cur.rowIndexes.push(i);
    cur.bothSides = cur.nDev > 0 && cur.nNon > 0;
    map.set(row.familyId, cur);
  });
  return [...map.values()].sort((a, b) => a.familyId.localeCompare(b.familyId));
}

/**
 * Deterministic greedy assignment: shuffle families with seed 42, then
 * place each (largest first, shuffle as tie-break via original order) into
 * the fold that currently has the fewest families, then fewest rows,
 * then the smaller |DEV-NON| imbalance, then fewer copies of that domain.
 */
function assignFolds(families: FamilyInfo[]) {
  const shuffled = shuffle(families, FOLD_SEED);
  const sized = [...shuffled].sort((a, b) => {
    if (b.n !== a.n) return b.n - a.n;
    return shuffled.indexOf(a) - shuffled.indexOf(b);
  });
  const folds: Array<{
    fold: number;
    families: FamilyInfo[];
    n: number;
    nDev: number;
    nNon: number;
    domainCounts: Record<string, number>;
  }> = Array.from({ length: K_FOLDS }, (_, fold) => ({
    fold,
    families: [] as FamilyInfo[],
    n: 0,
    nDev: 0,
    nNon: 0,
    domainCounts: {} as Record<string, number>,
  }));

  for (const fam of sized) {
    let chosen = 0;
    for (let k = 1; k < K_FOLDS; k++) {
      const a = folds[chosen];
      const b = folds[k];
      const ka = [
        a.families.length,
        a.n + fam.n,
        Math.abs(a.nDev + fam.nDev - (a.nNon + fam.nNon)),
        a.domainCounts[fam.domain] || 0,
      ];
      const kb = [
        b.families.length,
        b.n + fam.n,
        Math.abs(b.nDev + fam.nDev - (b.nNon + fam.nNon)),
        b.domainCounts[fam.domain] || 0,
      ];
      let takeB = false;
      for (let i = 0; i < ka.length; i++) {
        if (kb[i] < ka[i]) {
          takeB = true;
          break;
        }
        if (kb[i] > ka[i]) break;
      }
      if (takeB) chosen = k;
    }
    const f = folds[chosen];
    f.families.push(fam);
    f.n += fam.n;
    f.nDev += fam.nDev;
    f.nNon += fam.nNon;
    f.domainCounts[fam.domain] = (f.domainCounts[fam.domain] || 0) + 1;
  }

  return folds.map((f) => ({
    fold: f.fold,
    familyIds: [...f.families].map((x) => x.familyId).sort(),
    n: f.n,
    nDev: f.nDev,
    nNon: f.nNon,
    bothSidesFamilies: f.families.filter((x) => x.bothSides).length,
    domainCounts: Object.fromEntries(
      Object.entries(f.domainCounts).sort(([a], [b]) => a.localeCompare(b))
    ),
    families: [...f.families]
      .sort((a, b) => a.familyId.localeCompare(b.familyId))
      .map((x) => ({
        familyId: x.familyId,
        domain: x.domain,
        n: x.n,
        nDev: x.nDev,
        nNon: x.nNon,
        bothSides: x.bothSides,
      })),
  }));
}

function familyHeldOutBalancedAccuracy(
  rows: DevelopmentalExample[],
  predicted: string[]
) {
  const byFam = new Map<string, { y: string[]; p: string[] }>();
  rows.forEach((row, i) => {
    const cur = byFam.get(row.familyId) ?? { y: [], p: [] };
    cur.y.push(row.label);
    cur.p.push(predicted[i]);
    byFam.set(row.familyId, cur);
  });
  const perFamily = [...byFam.entries()].map(([familyId, slice]) => {
    const m = metrics(slice.y, slice.p);
    const both =
      slice.y.includes('DEVELOPMENTAL') && slice.y.includes('NON_DEVELOPMENTAL');
    const bothSidesCorrect =
      both &&
      slice.y.every((y, i) => y === slice.p[i]);
    return {
      familyId,
      n: slice.y.length,
      balancedAccuracy: m.balancedAccuracy,
      accuracy: m.accuracy,
      bothSides: both,
      bothSidesCorrect,
    };
  });
  const bothSides = perFamily.filter((f) => f.bothSides);
  return {
    meanFamilyBalancedAccuracy: Number(mean(perFamily.map((f) => f.balancedAccuracy)).toFixed(4)),
    bothSidesRate:
      bothSides.length === 0
        ? null
        : Number(
            (bothSides.filter((f) => f.bothSidesCorrect).length / bothSides.length).toFixed(4)
          ),
    bothSidesN: bothSides.length,
    perFamily,
  };
}

type Scored = DevelopmentalExample & {
  pDevelopmental: number;
  predicted: string;
  correct: boolean;
};

function scoreWith(
  model: { weights: number[]; bias: number },
  rows: DevelopmentalExample[],
  embeddings: number[][]
): Scored[] {
  return rows.map((row, i) => {
    const p = predictProbability(model, embeddings[i]);
    const predicted = classify(p);
    return { ...row, pDevelopmental: p, predicted, correct: predicted === row.label };
  });
}

function summarizeExternal(valScored: Scored[]) {
  const valMetrics = metrics(
    valScored.map((r) => r.label),
    valScored.map((r) => r.predicted)
  );
  const domainMetrics: Record<string, ReturnType<typeof metrics>> = {};
  for (const domain of [...new Set(valScored.map((r) => r.domain))]) {
    const slice = valScored.filter((r) => r.domain === domain);
    domainMetrics[domain] = metrics(
      slice.map((r) => r.label),
      slice.map((r) => r.predicted)
    );
  }
  const familyAccuracy = [...new Set(valScored.map((r) => r.familyId))].map((familyId) => {
    const slice = valScored.filter((r) => r.familyId === familyId);
    const bothSides =
      slice.some((r) => r.label === 'DEVELOPMENTAL') &&
      slice.some((r) => r.label === 'NON_DEVELOPMENTAL');
    const bothSidesCorrect =
      bothSides &&
      slice.filter((r) => r.label === 'DEVELOPMENTAL').every((r) => r.correct) &&
      slice.filter((r) => r.label === 'NON_DEVELOPMENTAL').every((r) => r.correct);
    return {
      familyId,
      contrastGroup: slice[0].contrastGroup,
      n: slice.length,
      accuracy: Number((slice.filter((r) => r.correct).length / slice.length).toFixed(4)),
      bothSides,
      bothSidesCorrect,
    };
  });
  const nearPairFamilies = familyAccuracy.filter((f) => f.bothSides);
  const bothSidesRate =
    nearPairFamilies.filter((f) => f.bothSidesCorrect).length /
    Math.max(1, nearPairFamilies.length);
  const pDev = valScored.filter((r) => r.label === 'DEVELOPMENTAL').map((r) => r.pDevelopmental);
  const pNon = valScored
    .filter((r) => r.label === 'NON_DEVELOPMENTAL')
    .map((r) => r.pDevelopmental);
  const mid = valScored.filter((r) => Math.abs(r.pDevelopmental - 0.5) <= 0.1);
  let brier = 0;
  for (const r of valScored) {
    const y = r.label === 'DEVELOPMENTAL' ? 1 : 0;
    brier += (r.pDevelopmental - y) ** 2;
  }
  return {
    binaryValidation: valMetrics,
    domainMetrics,
    familyAccuracy,
    nearPairBothSidesCorrect: Number(bothSidesRate.toFixed(4)),
    nearPairFamilyCount: nearPairFamilies.length,
    errors: valScored
      .filter((r) => !r.correct)
      .map((r) => ({
        id: r.id,
        text: r.text,
        expected: r.label,
        predicted: r.predicted,
        pDevelopmental: Number(r.pDevelopmental.toFixed(4)),
        familyId: r.familyId,
        domain: r.domain,
      })),
    calibration: {
      meanPDev: Number(mean(pDev).toFixed(4)),
      meanPNon: Number(mean(pNon).toFixed(4)),
      brier: Number((brier / valScored.length).toFixed(4)),
      fracWithin010OfHalf: Number((mid.length / valScored.length).toFixed(4)),
      minP: Number(Math.min(...valScored.map((r) => r.pDevelopmental)).toFixed(4)),
      maxP: Number(Math.max(...valScored.map((r) => r.pDevelopmental)).toFixed(4)),
    },
  };
}

function selectConfig(
  results: Array<{
    id: string;
    l2: number;
    learningRate: number;
    epochs: number;
    meanFamilyBalancedAccuracy: number;
    stdFamilyBalancedAccuracy: number;
    meanMacroF1: number;
    meanBothSidesRate: number | null;
  }>
) {
  const bestMean = Math.max(...results.map((r) => r.meanFamilyBalancedAccuracy));
  const band = results.filter((r) => bestMean - r.meanFamilyBalancedAccuracy <= MEAN_TIE_EPS);
  const rankedBand = [...band].sort((a, b) => {
    if (Math.abs(a.stdFamilyBalancedAccuracy - b.stdFamilyBalancedAccuracy) > MEAN_TIE_EPS) {
      return a.stdFamilyBalancedAccuracy - b.stdFamilyBalancedAccuracy;
    }
    const aPair = a.meanBothSidesRate ?? -1;
    const bPair = b.meanBothSidesRate ?? -1;
    if (Math.abs(aPair - bPair) > MEAN_TIE_EPS) return bPair - aPair;
    if (a.l2 !== b.l2) return b.l2 - a.l2;
    if (a.epochs !== b.epochs) return a.epochs - b.epochs;
    return a.learningRate - b.learningRate;
  });
  const rest = results
    .filter((r) => !band.includes(r))
    .sort((a, b) => b.meanFamilyBalancedAccuracy - a.meanFamilyBalancedAccuracy);
  const selected = rankedBand[0];
  return {
    selected,
    rankedIds: [...rankedBand, ...rest].map((r) => r.id),
    selectionBand: {
      bestMean,
      eps: MEAN_TIE_EPS,
      ids: band.map((r) => r.id),
    },
    rule: [
      'Primary: maximize mean family-held-out balanced accuracy (mean of per-family BA on each fold held-out families).',
      `Consider all configs within ${MEAN_TIE_EPS} of the best mean (tie band; avoids non-transitive pairwise comparisons).`,
      'Inside that band, prefer lower fold std of family BA.',
      'If still tied, prefer higher mean both-sides-correct rate among two-polarity held-out families.',
      'If still tied, prefer stronger L2, then fewer epochs, then lower learning rate.',
      `Threshold fixed at ${THRESHOLD}. External 92-row val was not used.`,
    ],
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
  if (train.length !== 405) {
    throw new Error(`Expected 405 train rows (3A.2 freeze), got ${train.length}`);
  }

  const families = familyInfos(train);
  const foldDefs = assignFolds(families);
  const familyToFold = new Map<string, number>();
  for (const fold of foldDefs) {
    for (const familyId of fold.familyIds) familyToFold.set(familyId, fold.fold);
  }
  if (familyToFold.size !== families.length) throw new Error('Family fold leak/missing');
  if (new Set(families.map((f) => familyToFold.get(f.familyId))).size !== K_FOLDS) {
    throw new Error('Fold count mismatch');
  }

  await loadMiniLm();
  const embeddings: number[][] = [];
  for (const row of train) embeddings.push(await embedText(row.text));
  const labels = train.map((r) => (r.label === 'DEVELOPMENTAL' ? 1 : 0));

  const gridResults = [];
  for (const cfg of GRID) {
    const perFold = [];
    for (let k = 0; k < K_FOLDS; k++) {
      const trainIdx: number[] = [];
      const valIdx: number[] = [];
      train.forEach((row, i) => {
        if (familyToFold.get(row.familyId) === k) valIdx.push(i);
        else trainIdx.push(i);
      });
      const valFamilies = new Set(valIdx.map((i) => train[i].familyId));
      for (const i of trainIdx) {
        if (valFamilies.has(train[i].familyId)) throw new Error('family leakage');
      }
      const model = trainBinaryLogistic({
        embeddings: trainIdx.map((i) => embeddings[i]),
        labels: trainIdx.map((i) => labels[i]),
        l2: cfg.l2,
        learningRate: cfg.learningRate,
        epochs: cfg.epochs,
      });
      const valRows = valIdx.map((i) => train[i]);
      const valEmb = valIdx.map((i) => embeddings[i]);
      const pred = valEmb.map((e) => classify(predictProbability(model, e)));
      const rowM = metrics(
        valRows.map((r) => r.label),
        pred
      );
      const famM = familyHeldOutBalancedAccuracy(valRows, pred);
      const trainNll = nll(
        model,
        trainIdx.map((i) => embeddings[i]),
        trainIdx.map((i) => labels[i])
      );
      const holdNll = nll(model, valEmb, valIdx.map((i) => labels[i]));
      perFold.push({
        fold: k,
        nTrain: trainIdx.length,
        nHoldout: valIdx.length,
        trainNll: Number(trainNll.toFixed(4)),
        holdoutNll: Number(holdNll.toFixed(4)),
        row: rowM,
        meanFamilyBalancedAccuracy: famM.meanFamilyBalancedAccuracy,
        bothSidesRate: famM.bothSidesRate,
        bothSidesN: famM.bothSidesN,
      });
    }
    const famBA = perFold.map((f) => f.meanFamilyBalancedAccuracy);
    const macro = perFold.map((f) => f.row.macroF1);
    const pair = perFold.map((f) => f.bothSidesRate).filter((x): x is number => x !== null);
    gridResults.push({
      id: cfg.id,
      l2: cfg.l2,
      learningRate: cfg.learningRate,
      epochs: cfg.epochs,
      meanFamilyBalancedAccuracy: Number(mean(famBA).toFixed(4)),
      stdFamilyBalancedAccuracy: Number(std(famBA).toFixed(4)),
      meanMacroF1: Number(mean(macro).toFixed(4)),
      stdMacroF1: Number(std(macro).toFixed(4)),
      meanRowBalancedAccuracy: Number(mean(perFold.map((f) => f.row.balancedAccuracy)).toFixed(4)),
      meanBothSidesRate: pair.length ? Number(mean(pair).toFixed(4)) : null,
      meanTrainNll: Number(mean(perFold.map((f) => f.trainNll)).toFixed(4)),
      meanHoldoutNll: Number(mean(perFold.map((f) => f.holdoutNll)).toFixed(4)),
      folds: perFold,
    });
  }

  const selection = selectConfig(gridResults);
  const cvReport = {
    evaluator: 'candidate-developmental-3a.3',
    pass: 'train-only-family-grouped-cv',
    generatedAt: new Date().toISOString(),
    dataset: {
      path: 'benchmarks/semantic/datasets/developmental-v1/developmental-v1.jsonl',
      trainRows: train.length,
      trainFamilies: families.length,
      note: '3A.2 freeze. No example add/remove/edit. External val unused for selection.',
    },
    foldConstruction: {
      k: K_FOLDS,
      seed: FOLD_SEED,
      algorithm:
        'Seeded shuffle of families (mulberry32, seed 42), then greedy placement largest-first into the fold with fewest families, then fewest rows, then smaller |DEV-NON| imbalance, then fewer copies of that domain. Entire family stays in one fold.',
      folds: foldDefs,
    },
    grid: GRID,
    selectionRule: selection.rule,
    selectionBand: selection.selectionBand,
    results: gridResults,
    selected: selection.selected,
    rankedIds: selection.rankedIds,
  };

  mkdirSync(join(process.cwd(), 'benchmarks/semantic/results'), { recursive: true });
  writeFileSync(CV_PATH, JSON.stringify(cvReport, null, 2));
  console.log('TRAIN-ONLY CV LOCKED');
  console.log(
    JSON.stringify(
      {
        selected: selection.selected,
        rankedIds: selection.rankedIds,
        foldSizes: foldDefs.map((f) => ({
          fold: f.fold,
          families: f.familyIds.length,
          n: f.n,
          nDev: f.nDev,
          nNon: f.nNon,
        })),
        cvPath: CV_PATH,
      },
      null,
      2
    )
  );

  // --- External validation happens only after the CV file is written. ---
  const locked = selection.selected;
  const finalModel = trainBinaryLogistic({
    embeddings,
    labels,
    l2: locked.l2,
    learningRate: locked.learningRate,
    epochs: locked.epochs,
  });

  const weightsFile: DevelopmentalWeightsFile = {
    evaluator: 'candidate-developmental-3a.3',
    modelId: MINILM_MODEL_ID,
    embeddingDim: MINILM_EMBEDDING_DIM,
    quantization: MINILM_QUANTIZATION,
    binaryThreshold: THRESHOLD,
    seed: FOLD_SEED,
    l2: locked.l2,
    learningRate: locked.learningRate,
    epochs: locked.epochs,
    trainCount: train.length,
    weights: finalModel.weights,
    bias: finalModel.bias,
  };
  mkdirSync(join(process.cwd(), 'lib/evaluation/semantic/weights'), { recursive: true });
  writeFileSync(WEIGHTS_PATH, JSON.stringify(weightsFile));

  const val = rows.filter(
    (r) =>
      r.role === 'core_trainable' &&
      r.split === 'val' &&
      (r.label === 'DEVELOPMENTAL' || r.label === 'NON_DEVELOPMENTAL')
  );
  const valEmb: number[][] = [];
  for (const row of val) valEmb.push(await embedText(row.text));
  const valScored = scoreWith(finalModel, val, valEmb);
  const summary = summarizeExternal(valScored);

  const prevMetrics: Record<string, unknown> = {};
  for (const [tag, path] of Object.entries(PREV)) {
    const prev = JSON.parse(readFileSync(path, 'utf8')) as {
      binaryValidation: unknown;
      nearPairBothSidesCorrect: number;
      domainMetrics: Record<string, { accuracy: number }>;
      familyAccuracy: Array<{ familyId: string; accuracy: number; bothSidesCorrect: boolean }>;
    };
    prevMetrics[tag] = {
      binaryValidation: prev.binaryValidation,
      nearPairBothSidesCorrect: prev.nearPairBothSidesCorrect,
      domainAccuracy: Object.fromEntries(
        Object.entries(prev.domainMetrics).map(([d, m]) => [d, m.accuracy])
      ),
      familyAccuracy: prev.familyAccuracy,
    };
  }

  const valReport = {
    evaluator: 'candidate-developmental-3a.3',
    pass: 'external-val-after-locked-cv',
    generatedAt: new Date().toISOString(),
    trainConfig: {
      seed: FOLD_SEED,
      l2: locked.l2,
      learningRate: locked.learningRate,
      epochs: locked.epochs,
      binaryThreshold: THRESHOLD,
      selectedFrom: selection.selected.id,
    },
    counts: {
      train: train.length,
      trainDev: train.filter((r) => r.label === 'DEVELOPMENTAL').length,
      trainNon: train.filter((r) => r.label === 'NON_DEVELOPMENTAL').length,
      val: val.length,
      valDev: val.filter((r) => r.label === 'DEVELOPMENTAL').length,
      valNon: val.filter((r) => r.label === 'NON_DEVELOPMENTAL').length,
    },
    cvFile: CV_PATH,
    ...summary,
    comparison: {
      '3a.1': prevMetrics['3a.1'],
      '3a.2': prevMetrics['3a.2'],
      '3a.3': {
        binaryValidation: summary.binaryValidation,
        nearPairBothSidesCorrect: summary.nearPairBothSidesCorrect,
        domainAccuracy: Object.fromEntries(
          Object.entries(summary.domainMetrics).map(([d, m]) => [d, m.accuracy])
        ),
        familyAccuracy: summary.familyAccuracy,
      },
    },
  };
  writeFileSync(VAL_PATH, JSON.stringify(valReport, null, 2));
  console.log('EXTERNAL VAL (locked config, one pass)');
  console.log(
    JSON.stringify(
      {
        selected: locked,
        binaryValidation: summary.binaryValidation,
        nearPairBothSidesCorrect: summary.nearPairBothSidesCorrect,
        calibration: summary.calibration,
        valPath: VAL_PATH,
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
