/**
 * Candidate #3A abstention policy study.
 * Replay architecture-of-record OOF (L2=0.01, lr=0.4, 400, threshold 0.50), then
 * score four locked global bands. Does not retrain MiniLM or change 3A HPs.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { DevelopmentalExample } from './datasets/developmental-v1/schema';
import { trainBinaryLogistic, predictProbability } from '../../lib/evaluation/semantic/logisticRegression';
import { embedText, loadMiniLm } from '../../lib/evaluation/semantic/minilmEmbeddings';

const DATASET_PATH = join(
  process.cwd(),
  'benchmarks/semantic/datasets/developmental-v1/developmental-v1.jsonl'
);
const FOLDS_PATH = join(
  process.cwd(),
  'benchmarks/semantic/results/developmental-candidate-3a.3-cv.json'
);
const OUT_PATH = join(
  process.cwd(),
  'benchmarks/semantic/results/developmental-candidate-3a-abstention.json'
);

const PROBE = { l2: 0.01, learningRate: 0.4, epochs: 400 } as const;
const EXPECTED = {
  bothSides: 0.4645,
  familyBa: 0.8086,
  meanRowBa: 0.8448,
  meanHoldoutNll: 0.5463,
} as const;

const POLICIES = [
  { id: 'NONE', L: 0.5, U: 0.5 },
  { id: 'NARROW', L: 0.45, U: 0.55 },
  { id: 'MODERATE', L: 0.4, U: 0.6 },
  { id: 'STRONG', L: 0.35, U: 0.65 },
] as const;

type State = 'DEVELOPMENTAL' | 'NON_DEVELOPMENTAL' | 'UNCERTAIN';

function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
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
  return {
    n: yTrue.length,
    accuracy: Number(((tp + tn) / Math.max(1, yTrue.length)).toFixed(4)),
    ROW_BA: Number(((recPos + recNeg) / 2).toFixed(4)),
    confusion: { tp, tn, fp, fn },
    recPos,
    recNeg,
  };
}

function nllFromP(pDev: number[], labels: number[]) {
  let s = 0;
  for (let i = 0; i < pDev.length; i++) {
    const p = Math.min(1 - 1e-12, Math.max(1e-12, pDev[i]));
    s += -(labels[i] * Math.log(p) + (1 - labels[i]) * Math.log(1 - p));
  }
  return s / Math.max(1, pDev.length);
}

function decide(p: number, L: number, U: number): State {
  if (p > L && p < U) return 'UNCERTAIN';
  if (p >= U) return 'DEVELOPMENTAL';
  return 'NON_DEVELOPMENTAL';
}

type Oof = {
  id: string;
  familyId: string;
  domain: string;
  fold: number;
  gold: 'DEVELOPMENTAL' | 'NON_DEVELOPMENTAL';
  p_dev: number;
};

function familyBaAndBothSides(
  rows: Array<{ familyId: string; gold: string; pred: string }>
) {
  const byFam = new Map<string, { y: string[]; p: string[] }>();
  for (const r of rows) {
    const cur = byFam.get(r.familyId) ?? { y: [], p: [] };
    cur.y.push(r.gold);
    cur.p.push(r.pred);
    byFam.set(r.familyId, cur);
  }
  const per = [...byFam.entries()].map(([familyId, slice]) => {
    const m = metrics(slice.y, slice.p);
    const both = slice.y.includes('DEVELOPMENTAL') && slice.y.includes('NON_DEVELOPMENTAL');
    const bothSidesCorrect = both && slice.y.every((y, i) => y === slice.p[i]);
    return { familyId, ROW_BA: m.ROW_BA, both, bothSidesCorrect, n: slice.y.length };
  });
  const two = per.filter((f) => f.both);
  return {
    FAMILY_BA: Number(mean(per.map((f) => f.ROW_BA)).toFixed(4)),
    bothSides: two.length
      ? Number((two.filter((f) => f.bothSidesCorrect).length / two.length).toFixed(4))
      : null,
    bothSidesN: two.length,
    perFamily: per,
  };
}

function goldTwoSided(oof: Oof[]) {
  const byFam = new Map<string, { dev: number; non: number }>();
  for (const r of oof) {
    const cur = byFam.get(r.familyId) ?? { dev: 0, non: 0 };
    if (r.gold === 'DEVELOPMENTAL') cur.dev += 1;
    else cur.non += 1;
    byFam.set(r.familyId, cur);
  }
  return new Set([...byFam.entries()].filter(([, c]) => c.dev > 0 && c.non > 0).map(([id]) => id));
}

function evaluatePolicySlice(oof: Oof[], L: number, U: number, twoSided: Set<string>) {
  const states = oof.map((r) => decide(r.p_dev, L, U));
  const decidedIdx = states.map((s, i) => (s !== 'UNCERTAIN' ? i : -1)).filter((i) => i >= 0);
  const coverage = decidedIdx.length / oof.length;
  const abstention = 1 - coverage;

  const decidedGold = decidedIdx.map((i) => oof[i].gold);
  const decidedPred = decidedIdx.map((i) => states[i] as 'DEVELOPMENTAL' | 'NON_DEVELOPMENTAL');
  const row = decidedIdx.length ? metrics(decidedGold, decidedPred) : null;

  const goldDev = oof.filter((r) => r.gold === 'DEVELOPMENTAL');
  const goldNon = oof.filter((r) => r.gold === 'NON_DEVELOPMENTAL');
  const goldDevStates = goldDev.map((r) => decide(r.p_dev, L, U));
  const goldNonStates = goldNon.map((r) => decide(r.p_dev, L, U));
  const decidedNon = decidedIdx.filter((i) => oof[i].gold === 'NON_DEVELOPMENTAL');
  const decidedDev = decidedIdx.filter((i) => oof[i].gold === 'DEVELOPMENTAL');
  const falseDev =
    decidedNon.length === 0
      ? null
      : decidedNon.filter((i) => states[i] === 'DEVELOPMENTAL').length / decidedNon.length;
  const falseNon =
    decidedDev.length === 0
      ? null
      : decidedDev.filter((i) => states[i] === 'NON_DEVELOPMENTAL').length / decidedDev.length;

  const byFam = new Map<
    string,
    { gold: string[]; state: State[]; fold: number; domain: string }
  >();
  oof.forEach((r, i) => {
    const cur = byFam.get(r.familyId) ?? { gold: [], state: [], fold: r.fold, domain: r.domain };
    cur.gold.push(r.gold);
    cur.state.push(states[i]);
    byFam.set(r.familyId, cur);
  });

  const familyRows = [...byFam.entries()].map(([familyId, s]) => {
    const decided = s.gold
      .map((g, i) => ({ gold: g, state: s.state[i] }))
      .filter((x) => x.state !== 'UNCERTAIN');
    const nUnc = s.state.filter((x) => x === 'UNCERTAIN').length;
    const origTwo = twoSided.has(familyId);
    const decidedDev = decided.filter((x) => x.gold === 'DEVELOPMENTAL');
    const decidedNonR = decided.filter((x) => x.gold === 'NON_DEVELOPMENTAL');
    const retained = origTwo && decidedDev.length > 0 && decidedNonR.length > 0;
    const allCorrect =
      retained && decided.every((x) => x.gold === x.state);
    const sel =
      decided.length === 0
        ? null
        : metrics(
            decided.map((x) => x.gold),
            decided.map((x) => x.state as string)
          );
    return {
      familyId,
      fold: s.fold,
      domain: s.domain,
      n: s.gold.length,
      nDecided: decided.length,
      coverage: Number((decided.length / s.gold.length).toFixed(4)),
      nUncertain: nUnc,
      originallyTwoSided: origTwo,
      retainedTwoSided: retained,
      selectiveBothSidesPass: retained ? allCorrect : null,
      selectiveROW_BA: sel ? sel.ROW_BA : null,
    };
  });

  const f2 = [...twoSided];
  const retained = familyRows.filter((f) => f.retainedTwoSided);
  const A = f2.length ? retained.length / f2.length : 0;
  const B = retained.length
    ? retained.filter((f) => f.selectiveBothSidesPass).length / retained.length
    : 0;
  const C = A * B;

  const decidedFamBaRows = familyRows
    .filter((f) => f.nDecided > 0 && f.selectiveROW_BA !== null)
    .map((f) => f.selectiveROW_BA as number);

  return {
    coverage: Number(coverage.toFixed(4)),
    abstentionRate: Number(abstention.toFixed(4)),
    selectiveRowAccuracy: row ? row.accuracy : null,
    selectiveROW_BA: row ? row.ROW_BA : null,
    FAMILY_BA_context: decidedFamBaRows.length
      ? Number(mean(decidedFamBaRows).toFixed(4))
      : null,
    A: Number(A.toFixed(4)),
    B: Number(B.toFixed(4)),
    C: Number(C.toFixed(4)),
    nRetainedTwoSided: retained.length,
    nOriginallyTwoSided: f2.length,
    falseDevRate: falseDev === null ? null : Number(falseDev.toFixed(4)),
    falseNonRate: falseNon === null ? null : Number(falseNon.toFixed(4)),
    goldDevAbstentionRate: Number(
      (goldDevStates.filter((s) => s === 'UNCERTAIN').length / Math.max(1, goldDev.length)).toFixed(4)
    ),
    goldNonAbstentionRate: Number(
      (goldNonStates.filter((s) => s === 'UNCERTAIN').length / Math.max(1, goldNon.length)).toFixed(4)
    ),
    nZeroCoverageFamilies: familyRows.filter((f) => f.nDecided === 0).length,
    nLostTwoSided: familyRows.filter((f) => f.originallyTwoSided && !f.retainedTwoSided).length,
    families: familyRows,
  };
}

function evaluatePolicy(oof: Oof[], L: number, U: number, twoSided: Set<string>) {
  const core = evaluatePolicySlice(oof, L, U, twoSided);
  const perFold = [0, 1, 2, 3, 4].map((k) => {
    const slice = oof.filter((r) => r.fold === k);
    const subTwo = new Set(slice.filter((r) => twoSided.has(r.familyId)).map((r) => r.familyId));
    const inner = evaluatePolicySlice(slice, L, U, subTwo);
    return {
      fold: k,
      n: slice.length,
      coverage: inner.coverage,
      abstentionRate: inner.abstentionRate,
      selectiveRowAccuracy: inner.selectiveRowAccuracy,
      selectiveROW_BA: inner.selectiveROW_BA,
      A: inner.A,
      B: inner.B,
      C: inner.C,
      FAMILY_BA_context: inner.FAMILY_BA_context,
    };
  });
  return {
    ...core,
    meanFoldSelectiveROW_BA: Number(
      mean(perFold.map((f) => f.selectiveROW_BA ?? 0)).toFixed(4)
    ),
    perFold,
  };
}

function calibration(oof: Oof[]) {
  const labels = oof.map((r) => (r.gold === 'DEVELOPMENTAL' ? 1 : 0));
  const ps = oof.map((r) => r.p_dev);
  const nll = nllFromP(ps, labels);
  const brier = mean(ps.map((p, i) => (p - labels[i]) ** 2));
  const hist = Array.from({ length: 10 }, (_, b) => {
    const lo = b / 10;
    const hi = (b + 1) / 10;
    const idx = oof.filter((r) => (b === 9 ? r.p_dev >= lo && r.p_dev <= hi : r.p_dev >= lo && r.p_dev < hi));
    return { lo, hi, n: idx.length };
  });
  const bins = [
    [0, 0.2],
    [0.2, 0.4],
    [0.4, 0.6],
    [0.6, 0.8],
    [0.8, 1.0000001],
  ] as const;
  const reliability = bins.map(([lo, hi], bi) => {
    const idx = oof.filter((r) =>
      bi === bins.length - 1 ? r.p_dev >= lo && r.p_dev <= 1 : r.p_dev >= lo && r.p_dev < hi
    );
    const meanP = idx.length ? mean(idx.map((r) => r.p_dev)) : 0;
    const emp =
      idx.length === 0 ? null : idx.filter((r) => r.gold === 'DEVELOPMENTAL').length / idx.length;
    const pred = idx.map((r) => (r.p_dev >= 0.5 ? 'DEVELOPMENTAL' : 'NON_DEVELOPMENTAL'));
    const acc = idx.length ? metrics(idx.map((r) => r.gold), pred).accuracy : null;
    return {
      lo,
      hi: bi === bins.length - 1 ? 1 : hi,
      n: idx.length,
      meanP: Number(meanP.toFixed(4)),
      empiricalDevRate: emp === null ? null : Number(emp.toFixed(4)),
      accuracyAt050: acc,
      absGap: emp === null ? null : Number(Math.abs(meanP - emp).toFixed(4)),
    };
  });
  const ece = reliability.reduce((s, b) => {
    if (b.empiricalDevRate === null) return s;
    return s + (b.n / oof.length) * Math.abs(b.meanP - b.empiricalDevRate);
  }, 0);
  return {
    nll: Number(nll.toFixed(4)),
    brier: Number(brier.toFixed(4)),
    ece: Number(ece.toFixed(4)),
    histogram10: hist,
    reliability5: reliability,
  };
}

function close(a: number, b: number, eps = 0.00015) {
  return Math.abs(a - b) <= eps;
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
  if (train.length !== 405) throw new Error(`Expected 405 rows, got ${train.length}`);

  const foldFile = JSON.parse(readFileSync(FOLDS_PATH, 'utf8')) as {
    foldConstruction: { folds: Array<{ fold: number; familyIds: string[] }> };
    results: Array<{
      id: string;
      meanFamilyBalancedAccuracy: number;
      meanBothSidesRate: number;
      meanRowBalancedAccuracy: number;
      meanHoldoutNll: number;
      folds: Array<{
        fold: number;
        holdoutNll: number;
        row: { confusion: { tp: number; tn: number; fp: number; fn: number }; balancedAccuracy: number };
        meanFamilyBalancedAccuracy: number;
        bothSidesRate: number;
      }>;
    }>;
  };
  const stored = foldFile.results.find((r) => r.id === 'l2=0.01_lr=0.4_ep=400');
  if (!stored) throw new Error('missing stored architecture-of-record config');
  const familyToFold = new Map<string, number>();
  for (const fold of foldFile.foldConstruction.folds) {
    for (const id of fold.familyIds) familyToFold.set(id, fold.fold);
  }

  await loadMiniLm();
  const embeddings: number[][] = [];
  for (const row of train) embeddings.push(await embedText(row.text));
  const labels = train.map((r) => (r.label === 'DEVELOPMENTAL' ? 1 : 0));

  const oof: Oof[] = [];
  const replayFolds = [];
  for (let k = 0; k < 5; k++) {
    const trainIdx: number[] = [];
    const holdIdx: number[] = [];
    train.forEach((row, i) => {
      if (familyToFold.get(row.familyId) === k) holdIdx.push(i);
      else trainIdx.push(i);
    });
    const holdFams = new Set(holdIdx.map((i) => train[i].familyId));
    for (const i of trainIdx) {
      if (holdFams.has(train[i].familyId)) throw new Error('family leakage');
    }
    const model = trainBinaryLogistic({
      embeddings: trainIdx.map((i) => embeddings[i]),
      labels: trainIdx.map((i) => labels[i]),
      l2: PROBE.l2,
      learningRate: PROBE.learningRate,
      epochs: PROBE.epochs,
    });
    const holdP = holdIdx.map((i) => predictProbability(model, embeddings[i]));
    const pred = holdP.map((p) => (p >= 0.5 ? 'DEVELOPMENTAL' : 'NON_DEVELOPMENTAL'));
    const holdRows = holdIdx.map((i) => train[i]);
    const rowM = metrics(
      holdRows.map((r) => r.label),
      pred
    );
    const fam = familyBaAndBothSides(
      holdRows.map((r, i) => ({ familyId: r.familyId, gold: r.label, pred: pred[i] }))
    );
    const holdNll = nllFromP(holdP, holdIdx.map((i) => labels[i]));
    replayFolds.push({
      fold: k,
      nHoldout: holdIdx.length,
      holdoutNll: Number(holdNll.toFixed(4)),
      ROW_BA: rowM.ROW_BA,
      FAMILY_BA: fam.FAMILY_BA,
      bothSides: fam.bothSides,
      confusion: rowM.confusion,
    });
    holdIdx.forEach((i, j) => {
      oof.push({
        id: train[i].id,
        familyId: train[i].familyId,
        domain: train[i].domain,
        fold: k,
        gold: train[i].label as 'DEVELOPMENTAL' | 'NON_DEVELOPMENTAL',
        p_dev: holdP[j],
      });
    });
  }

  const replayBoth = Number(mean(replayFolds.map((f) => f.bothSides ?? 0)).toFixed(4));
  const replayFam = Number(mean(replayFolds.map((f) => f.FAMILY_BA)).toFixed(4));
  const replayRow = Number(mean(replayFolds.map((f) => f.ROW_BA)).toFixed(4));
  const replayNll = Number(mean(replayFolds.map((f) => f.holdoutNll)).toFixed(4));

  const foldMismatches: string[] = [];
  for (const rf of replayFolds) {
    const st = stored.folds.find((f) => f.fold === rf.fold);
    if (!st) continue;
    if (rf.confusion.tp !== st.row.confusion.tp || rf.confusion.fn !== st.row.confusion.fn) {
      foldMismatches.push(`fold ${rf.fold} confusion replay=${JSON.stringify(rf.confusion)} stored=${JSON.stringify(st.row.confusion)}`);
    }
    if (!close(rf.holdoutNll, st.holdoutNll, 0.0015)) {
      foldMismatches.push(`fold ${rf.fold} NLL replay=${rf.holdoutNll} stored=${st.holdoutNll}`);
    }
  }

  const verified =
    close(replayBoth, EXPECTED.bothSides) &&
    close(replayFam, EXPECTED.familyBa) &&
    close(replayRow, EXPECTED.meanRowBa) &&
    foldMismatches.length === 0;

  if (!verified) {
    const fail = {
      evaluator: 'candidate-3a-abstention',
      replayFailed: true,
      replay: { bothSides: replayBoth, FAMILY_BA: replayFam, ROW_BA: replayRow, holdoutNll: replayNll, folds: replayFolds },
      expected: EXPECTED,
      foldMismatches,
    };
    mkdirSync(join(process.cwd(), 'benchmarks/semantic/results'), { recursive: true });
    writeFileSync(OUT_PATH, JSON.stringify(fail, null, 2));
    console.log('REPLAY FAILED — abstention study stopped');
    console.log(JSON.stringify(fail, null, 2));
    return;
  }

  const twoSided = goldTwoSided(oof);
  const none = evaluatePolicy(oof, 0.5, 0.5, twoSided);
  const policies = POLICIES.map((p) => {
    const ev = evaluatePolicy(oof, p.L, p.U, twoSided);
    return { ...p, ...ev };
  });

  const noneP = policies.find((p) => p.id === 'NONE')!;
  const baselineMeanFoldRowBa = none.meanFoldSelectiveROW_BA;
  const baselineC = none.C;

  const gateFor = (p: (typeof policies)[number]) => {
    if (p.id === 'NONE') return null;
    const g1 = p.coverage >= 0.7;
    const g2 = p.meanFoldSelectiveROW_BA >= baselineMeanFoldRowBa + 0.05;
    const g3 = p.C >= baselineC + 0.05;
    const g4 = p.A >= 0.7;
    const g5a = p.perFold.every((f) => f.coverage >= 0.6);
    const g5b = p.perFold.every((f, i) => f.C >= noneP.perFold[i].C - 0.1);
    const g5c = p.perFold.filter((f, i) => f.C >= noneP.perFold[i].C).length >= 4;
    const pass = g1 && g2 && g3 && g4 && g5a && g5b && g5c;
    return { g1, g2, g3, g4, g5a, g5b, g5c, pass };
  };

  const gates = Object.fromEntries(
    policies.filter((p) => p.id !== 'NONE').map((p) => [p.id, gateFor(p)])
  );
  const order = ['NARROW', 'MODERATE', 'STRONG'] as const;
  const selected = order.find((id) => gates[id]?.pass) ?? 'NULL';

  const slimPolicies = policies.map((p) => ({
    id: p.id,
    L: p.L,
    U: p.U,
    coverage: p.coverage,
    abstentionRate: p.abstentionRate,
    selectiveRowAccuracy: p.selectiveRowAccuracy,
    selectiveROW_BA: p.selectiveROW_BA,
    meanFoldSelectiveROW_BA: p.meanFoldSelectiveROW_BA,
    FAMILY_BA_context: p.FAMILY_BA_context,
    A: p.A,
    B: p.B,
    C: p.C,
    nRetainedTwoSided: p.nRetainedTwoSided,
    nOriginallyTwoSided: p.nOriginallyTwoSided,
    falseDevRate: p.falseDevRate,
    falseNonRate: p.falseNonRate,
    goldDevAbstentionRate: p.goldDevAbstentionRate,
    goldNonAbstentionRate: p.goldNonAbstentionRate,
    nZeroCoverageFamilies: p.nZeroCoverageFamilies,
    nLostTwoSided: p.nLostTwoSided,
    perFold: p.perFold,
    families: p.families,
  }));

  const report = {
    evaluator: 'candidate-3a-abstention',
    probe: PROBE,
    terminology: {
      ROW_BA: 'balanced accuracy on individual rows (decided rows when abstaining)',
      FAMILY_BA: 'mean of per-family balanced accuracy (3A.3 / 4A definition, all families in the slice)',
    },
    replay: {
      verified: true,
      bothSides: replayBoth,
      FAMILY_BA: replayFam,
      ROW_BA_meanFold: replayRow,
      meanHoldoutNll: replayNll,
      folds: replayFolds,
    },
    nOof: oof.length,
    nOriginallyTwoSided: twoSided.size,
    calibration: calibration(oof),
    policies: slimPolicies,
    gates,
    selectedPolicy: selected,
    baselineNONE: {
      coverage: noneP.coverage,
      meanFoldROW_BA: baselineMeanFoldRowBa,
      C: baselineC,
      A: noneP.A,
      B: noneP.B,
      bothSides: replayBoth,
      FAMILY_BA: replayFam,
    },
  };

  mkdirSync(join(process.cwd(), 'benchmarks/semantic/results'), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        replayVerified: true,
        selectedPolicy: selected,
        baseline: report.baselineNONE,
        policies: slimPolicies.map(({ families, ...rest }) => rest),
        gates,
        calibration: report.calibration,
        outPath: OUT_PATH,
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
