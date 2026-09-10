/**
 * Candidate #3B — small nonlinear head on frozen MiniLM embeddings.
 *
 * PREDECLARED GRID (frozen before any CV numbers were inspected):
 *  1. h=16 ReLU L2=0.01 drop=0 lr=0.1 ep=400
 *  2. h=32 ReLU L2=0.01 drop=0 lr=0.1 ep=400
 *  3. h=64 ReLU L2=0.01 drop=0 lr=0.1 ep=400
 *  4. h=16 ReLU L2=0.1  drop=0 lr=0.1 ep=400
 *  5. h=32 ReLU L2=0.1  drop=0 lr=0.1 ep=400
 *  6. h=64 ReLU L2=0.1  drop=0 lr=0.1 ep=400
 *  7. h=32 GELU L2=0.01 drop=0 lr=0.1 ep=400
 *  8. h=32 ReLU L2=0.01 drop=0.2 lr=0.1 ep=400
 *  9. h=32 ReLU L2=0.01 drop=0 lr=0.4 ep=400
 *
 * Folds: exact 3A.3 family groups. No holdout early stopping (would leak).
 * Threshold 0.50. External 92-row val unused until lock.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { DevelopmentalExample } from './datasets/developmental-v1/schema';
import {
  BINARY_THRESHOLD,
} from '../../lib/evaluation/semantic/candidateDevelopmental';
import {
  mlpNll,
  mlpParamCount,
  predictMlpProbability,
  trainBinaryMlp,
  type MlpActivation,
  type MlpModel,
} from '../../lib/evaluation/semantic/mlpClassifier';
import { embedText, loadMiniLm } from '../../lib/evaluation/semantic/minilmEmbeddings';

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
  'benchmarks/semantic/results/developmental-candidate-3b-cv.json'
);
const WEIGHTS_PATH = join(
  process.cwd(),
  'lib/evaluation/semantic/weights/developmental-3b.json'
);
const VAL_PATH = join(
  process.cwd(),
  'benchmarks/semantic/results/developmental-candidate-3b-val.json'
);
const PREV = {
  '3a.1': join(process.cwd(), 'benchmarks/semantic/results/developmental-candidate-3a-val.json'),
  '3a.2': join(process.cwd(), 'benchmarks/semantic/results/developmental-candidate-3a.2-val.json'),
  '3a.3': join(process.cwd(), 'benchmarks/semantic/results/developmental-candidate-3a.3-val.json'),
};

const SEED = 42;
const THRESHOLD = BINARY_THRESHOLD;
const MEAN_TIE_EPS = 0.005;
const K_FOLDS = 5;

type GridCfg = {
  id: string;
  hidden: number;
  activation: MlpActivation;
  l2: number;
  dropout: number;
  learningRate: number;
  epochs: number;
};

const GRID: GridCfg[] = [
  { id: 'h16_relu_l2=0.01_drop=0_lr=0.1_ep=400', hidden: 16, activation: 'relu', l2: 0.01, dropout: 0, learningRate: 0.1, epochs: 400 },
  { id: 'h32_relu_l2=0.01_drop=0_lr=0.1_ep=400', hidden: 32, activation: 'relu', l2: 0.01, dropout: 0, learningRate: 0.1, epochs: 400 },
  { id: 'h64_relu_l2=0.01_drop=0_lr=0.1_ep=400', hidden: 64, activation: 'relu', l2: 0.01, dropout: 0, learningRate: 0.1, epochs: 400 },
  { id: 'h16_relu_l2=0.1_drop=0_lr=0.1_ep=400', hidden: 16, activation: 'relu', l2: 0.1, dropout: 0, learningRate: 0.1, epochs: 400 },
  { id: 'h32_relu_l2=0.1_drop=0_lr=0.1_ep=400', hidden: 32, activation: 'relu', l2: 0.1, dropout: 0, learningRate: 0.1, epochs: 400 },
  { id: 'h64_relu_l2=0.1_drop=0_lr=0.1_ep=400', hidden: 64, activation: 'relu', l2: 0.1, dropout: 0, learningRate: 0.1, epochs: 400 },
  { id: 'h32_gelu_l2=0.01_drop=0_lr=0.1_ep=400', hidden: 32, activation: 'gelu', l2: 0.01, dropout: 0, learningRate: 0.1, epochs: 400 },
  { id: 'h32_relu_l2=0.01_drop=0.2_lr=0.1_ep=400', hidden: 32, activation: 'relu', l2: 0.01, dropout: 0.2, learningRate: 0.1, epochs: 400 },
  { id: 'h32_relu_l2=0.01_drop=0_lr=0.4_ep=400', hidden: 32, activation: 'relu', l2: 0.01, dropout: 0, learningRate: 0.4, epochs: 400 },
];

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
    devAccuracy: Number(recPos.toFixed(4)),
    nonDevAccuracy: Number(recNeg.toFixed(4)),
  };
}

function classify(p: number) {
  return p >= THRESHOLD ? 'DEVELOPMENTAL' : 'NON_DEVELOPMENTAL';
}

function familyHeldOutBalancedAccuracy(rows: DevelopmentalExample[], predicted: string[]) {
  const byFam = new Map<string, { y: string[]; p: string[] }>();
  rows.forEach((row, i) => {
    const cur = byFam.get(row.familyId) ?? { y: [], p: [] };
    cur.y.push(row.label);
    cur.p.push(predicted[i]);
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
  return {
    meanFamilyBalancedAccuracy: Number(mean(perFamily.map((f) => f.balancedAccuracy)).toFixed(4)),
    bothSidesRate:
      bothSides.length === 0
        ? null
        : Number((bothSides.filter((f) => f.bothSidesCorrect).length / bothSides.length).toFixed(4)),
    bothSidesN: bothSides.length,
  };
}

type Scored = DevelopmentalExample & {
  pDevelopmental: number;
  predicted: string;
  correct: boolean;
};

function scoreWith(model: MlpModel, rows: DevelopmentalExample[], embeddings: number[][]): Scored[] {
  return rows.map((row, i) => {
    const p = predictMlpProbability(model, embeddings[i]);
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
    hidden: number;
    activation: string;
    l2: number;
    dropout: number;
    learningRate: number;
    epochs: number;
    paramCount: number;
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
    if (a.paramCount !== b.paramCount) return a.paramCount - b.paramCount;
    if (a.dropout !== b.dropout) return a.dropout - b.dropout;
    if (a.activation !== b.activation) return a.activation === 'relu' ? -1 : 1;
    if (a.l2 !== b.l2) return b.l2 - a.l2;
    return a.learningRate - b.learningRate;
  });
  const rest = results
    .filter((r) => !band.includes(r))
    .sort((a, b) => b.meanFamilyBalancedAccuracy - a.meanFamilyBalancedAccuracy);
  return {
    selected: rankedBand[0],
    rankedIds: [...rankedBand, ...rest].map((r) => r.id),
    selectionBand: { bestMean, eps: MEAN_TIE_EPS, ids: band.map((r) => r.id) },
    rule: [
      'Primary: maximize mean family-held-out balanced accuracy.',
      `Tie band: within ${MEAN_TIE_EPS} of the best mean.`,
      'Inside the band: lower fold std, then higher both-sides rate, then fewer parameters, then no dropout, then ReLU, then stronger L2, then lower lr.',
      'No holdout early stopping. Threshold 0.50. External val unused.',
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
  if (train.length !== 405) throw new Error(`Expected 405 train rows, got ${train.length}`);

  const foldFile = JSON.parse(readFileSync(FOLDS_PATH, 'utf8')) as {
    foldConstruction: { folds: Array<{ fold: number; familyIds: string[] }> };
  };
  const familyToFold = new Map<string, number>();
  for (const fold of foldFile.foldConstruction.folds) {
    for (const familyId of fold.familyIds) familyToFold.set(familyId, fold.fold);
  }
  if (familyToFold.size !== 60) throw new Error(`Expected 60 train families, got ${familyToFold.size}`);

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
      const model = trainBinaryMlp(
        trainIdx.map((i) => embeddings[i]),
        trainIdx.map((i) => labels[i]),
        { ...cfg, seed: SEED }
      );
      const trainRows = trainIdx.map((i) => train[i]);
      const holdRows = valIdx.map((i) => train[i]);
      const trainPred = trainIdx.map((i) => classify(predictMlpProbability(model, embeddings[i])));
      const holdPred = valIdx.map((i) => classify(predictMlpProbability(model, embeddings[i])));
      const trainM = metrics(
        trainRows.map((r) => r.label),
        trainPred
      );
      const holdM = metrics(
        holdRows.map((r) => r.label),
        holdPred
      );
      const famM = familyHeldOutBalancedAccuracy(holdRows, holdPred);
      perFold.push({
        fold: k,
        nTrain: trainIdx.length,
        nHoldout: valIdx.length,
        trainNll: Number(
          mlpNll(
            model,
            trainIdx.map((i) => embeddings[i]),
            trainIdx.map((i) => labels[i])
          ).toFixed(4)
        ),
        holdoutNll: Number(
          mlpNll(
            model,
            valIdx.map((i) => embeddings[i]),
            valIdx.map((i) => labels[i])
          ).toFixed(4)
        ),
        trainAccuracy: trainM.accuracy,
        holdoutAccuracy: holdM.accuracy,
        row: holdM,
        meanFamilyBalancedAccuracy: famM.meanFamilyBalancedAccuracy,
        bothSidesRate: famM.bothSidesRate,
        bothSidesN: famM.bothSidesN,
      });
    }
    const famBA = perFold.map((f) => f.meanFamilyBalancedAccuracy);
    const pair = perFold.map((f) => f.bothSidesRate).filter((x): x is number => x !== null);
    gridResults.push({
      id: cfg.id,
      hidden: cfg.hidden,
      activation: cfg.activation,
      l2: cfg.l2,
      dropout: cfg.dropout,
      learningRate: cfg.learningRate,
      epochs: cfg.epochs,
      paramCount: mlpParamCount(cfg.hidden),
      meanFamilyBalancedAccuracy: Number(mean(famBA).toFixed(4)),
      stdFamilyBalancedAccuracy: Number(std(famBA).toFixed(4)),
      meanMacroF1: Number(mean(perFold.map((f) => f.row.macroF1)).toFixed(4)),
      stdMacroF1: Number(std(perFold.map((f) => f.row.macroF1)).toFixed(4)),
      meanRowBalancedAccuracy: Number(mean(perFold.map((f) => f.row.balancedAccuracy)).toFixed(4)),
      meanBothSidesRate: pair.length ? Number(mean(pair).toFixed(4)) : null,
      meanTrainNll: Number(mean(perFold.map((f) => f.trainNll)).toFixed(4)),
      meanHoldoutNll: Number(mean(perFold.map((f) => f.holdoutNll)).toFixed(4)),
      meanTrainAccuracy: Number(mean(perFold.map((f) => f.trainAccuracy)).toFixed(4)),
      meanHoldoutAccuracy: Number(mean(perFold.map((f) => f.holdoutAccuracy)).toFixed(4)),
      nllGap: Number(
        (mean(perFold.map((f) => f.holdoutNll)) - mean(perFold.map((f) => f.trainNll))).toFixed(4)
      ),
      folds: perFold,
    });
  }

  const selection = selectConfig(gridResults);
  const cvReport = {
    evaluator: 'candidate-developmental-3b',
    pass: 'train-only-family-grouped-cv',
    generatedAt: new Date().toISOString(),
    embedding: { modelId: 'Xenova/all-MiniLM-L6-v2', frozen: true, dim: 384, quantization: 'int8-onnx' },
    seed: SEED,
    threshold: THRESHOLD,
    epochsProcedure: 'Fixed epoch budget. No holdout-based early stopping (would leak family folds).',
    dataset: {
      path: 'benchmarks/semantic/datasets/developmental-v1/developmental-v1.jsonl',
      trainRows: train.length,
      note: 'Exact 3A.2 freeze. Same 3A.3 family folds. External val unused for selection.',
    },
    foldSource: 'benchmarks/semantic/results/developmental-candidate-3a.3-cv.json',
    foldConstruction: foldFile.foldConstruction,
    grid: GRID,
    parameterCounts: {
      h16: mlpParamCount(16),
      h32: mlpParamCount(32),
      h64: mlpParamCount(64),
      linear3A: 385,
    },
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
        selected: {
          id: selection.selected.id,
          hidden: selection.selected.hidden,
          activation: selection.selected.activation,
          l2: selection.selected.l2,
          dropout: selection.selected.dropout,
          learningRate: selection.selected.learningRate,
          epochs: selection.selected.epochs,
          paramCount: selection.selected.paramCount,
          meanFamilyBalancedAccuracy: selection.selected.meanFamilyBalancedAccuracy,
          stdFamilyBalancedAccuracy: selection.selected.stdFamilyBalancedAccuracy,
          meanMacroF1: selection.selected.meanMacroF1,
          meanBothSidesRate: selection.selected.meanBothSidesRate,
        },
        rankedIds: selection.rankedIds,
        selectionBand: selection.selectionBand,
        cvPath: CV_PATH,
      },
      null,
      2
    )
  );

  const locked = GRID.find((g) => g.id === selection.selected.id);
  if (!locked) throw new Error('locked config missing from grid');
  const finalModel = trainBinaryMlp(embeddings, labels, { ...locked, seed: SEED });
  const weightsFile = {
    evaluator: 'candidate-developmental-3b',
    modelId: 'Xenova/all-MiniLM-L6-v2',
    embeddingDim: 384,
    quantization: 'int8-onnx',
    binaryThreshold: THRESHOLD,
    seed: SEED,
    hidden: locked.hidden,
    activation: locked.activation,
    l2: locked.l2,
    dropout: locked.dropout,
    learningRate: locked.learningRate,
    epochs: locked.epochs,
    paramCount: mlpParamCount(locked.hidden),
    trainCount: train.length,
    W1: finalModel.W1,
    b1: finalModel.b1,
    W2: finalModel.W2,
    b2: finalModel.b2,
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
    evaluator: 'candidate-developmental-3b',
    pass: 'external-val-after-locked-cv',
    generatedAt: new Date().toISOString(),
    trainConfig: { ...locked, seed: SEED, binaryThreshold: THRESHOLD, paramCount: mlpParamCount(locked.hidden) },
    counts: {
      train: train.length,
      trainDev: train.filter((r) => r.label === 'DEVELOPMENTAL').length,
      trainNon: train.filter((r) => r.label === 'NON_DEVELOPMENTAL').length,
      val: val.length,
    },
    cvFile: CV_PATH,
    ...summary,
    comparison: {
      '3a.1': prevMetrics['3a.1'],
      '3a.2': prevMetrics['3a.2'],
      '3a.3': prevMetrics['3a.3'],
      '3b': {
        binaryValidation: summary.binaryValidation,
        nearPairBothSidesCorrect: summary.nearPairBothSidesCorrect,
        domainAccuracy: Object.fromEntries(
          Object.entries(summary.domainMetrics).map(([d, m]) => [d, m.accuracy])
        ),
        familyAccuracy: summary.familyAccuracy,
        calibration: summary.calibration,
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
