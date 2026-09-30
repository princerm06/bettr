/**
 * Stage 3 data + retrain arena. Writes only under benchmarks/semantic/stage3
 * and results/phase1-stage3-experiments. Never overwrites production weights.
 */
import { createHash } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  ACTION_EVIDENCE_CONFIDENT_NEGATIVE,
  ACTION_EVIDENCE_CONFIDENT_POSITIVE,
  isProcessWithoutComplement,
  needsFirstPassClarification,
  needsSingletonActivityClarification,
} from '../../lib/evaluation/actionEvidence';
import { isDeterministicInvalid } from '../../lib/evaluation/developmentalProductPolicy';
import {
  PRODUCT_DEV_MIN,
  PRODUCT_NON_MAX,
} from '../../lib/evaluation/developmentalProductPolicy';
import { predictProbability } from '../../lib/evaluation/semantic/logisticRegression';
import { embedText as embedMiniLm, loadMiniLm } from '../../lib/evaluation/semantic/minilmEmbeddings';
import { embedTextMpnet, loadClientMpnet } from '../../lib/evaluation/mpnetClient';
import prod3a from '../../lib/evaluation/semantic/weights/developmental-3a.2.json';
import prodAe from '../../lib/evaluation/semantic/weights/action-evidence-mpnet.json';
import type { DevelopmentalExample } from './datasets/developmental-v1/schema';
import type { ActionEvidenceExample } from './datasets/action-evidence-v1/schema';
import { SEMANTIC_BENCHMARK_V1 } from './v1';
import { isDevelopmental } from './scoreContract';
import {
  FALSE_CREDIT_SAFETY,
  NEGATION_PROBE,
  SHORT_VALID,
  STAGE1_STRESS,
  STRUCTURAL_PROBE,
  COMPLETE_INTRANSITIVE,
} from './stage2/fixtures';
import { decidePolicy, type Outcome, type PolicyId } from './stage2/policies';
import { STAGE3_NEW } from './stage3/newExamples';
import { trainHead } from './stage3/train';

const ART = join(process.cwd(), 'benchmarks/semantic/stage3/artifacts');
const OUT = join(process.cwd(), 'benchmarks/semantic/results/phase1-stage3-experiments');
const PROD_3A = join(process.cwd(), 'lib/evaluation/semantic/weights/developmental-3a.2.json');
const PROD_AE = join(process.cwd(), 'lib/evaluation/semantic/weights/action-evidence-mpnet.json');

type Head = { weights: number[]; bias: number; evaluator: string; l2: number; epochs: number; trainCount: number };

const prod3aHead = prod3a as Head;
const prodAeHead = prodAe as { weights: number[]; bias: number };

function sha256File(path: string) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function weightFingerprint(weights: number[], bias: number) {
  return createHash('sha256').update(JSON.stringify({ weights, bias })).digest('hex');
}

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/['’]/g, "'")
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function loadJsonl<T>(rel: string): T[] {
  return readFileSync(join(process.cwd(), rel), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
}

function round(n: number, d = 4) {
  return Number(n.toFixed(d));
}

function looksLikeKeyboardSmash(text: string) {
  const compact = text.toLowerCase().replace(/[^a-z]/g, '');
  if (compact.length < 6) return false;
  const vowels = (compact.match(/[aeiouy]/g) || []).length;
  if (vowels / compact.length < 0.12) return true;
  return /asdf|qwer|zxcv|hjkl/.test(compact);
}

function experimentalStructural(text: string) {
  if (isProcessWithoutComplement(text)) return true;
  if (!needsSingletonActivityClarification(text, '')) return false;
  const token = text.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (COMPLETE_INTRANSITIVE.has(token)) return false;
  if (looksLikeKeyboardSmash(text)) return false;
  return true;
}

type Gold = 'DEVELOPMENTAL' | 'NON_DEVELOPMENTAL' | 'UNCERTAIN' | 'INVALID';

function wanted(gold: Gold): Outcome {
  if (gold === 'DEVELOPMENTAL') return 'CREDIT';
  if (gold === 'UNCERTAIN') return 'ASK';
  if (gold === 'INVALID') return 'INVALID';
  return 'REJECT';
}

type Scored = {
  id: string;
  text: string;
  gold: Gold;
  invalid: boolean;
  structural: boolean;
  pAction: number | null;
  pDev: number | null;
};

function metrics(rows: Scored[], decide: (r: Scored) => Outcome) {
  const n = rows.length || 1;
  let creditFP = 0;
  let rejectFN = 0;
  let ask = 0;
  let correctImmediate = 0;
  let uncertainAsk = 0;
  let uncertainN = 0;
  let tp = 0;
  for (const r of rows) {
    const o = decide(r);
    const goldDev = r.gold === 'DEVELOPMENTAL';
    const goldNon = r.gold === 'NON_DEVELOPMENTAL' || r.gold === 'INVALID';
    if (o === 'ASK') ask += 1;
    if (r.gold === 'UNCERTAIN') {
      uncertainN += 1;
      if (o === 'ASK') uncertainAsk += 1;
    }
    if (o === 'CREDIT' && !goldDev) creditFP += 1;
    if ((o === 'REJECT' || o === 'INVALID') && goldDev) rejectFN += 1;
    if (o === 'CREDIT' && goldDev) tp += 1;
    const w = wanted(r.gold);
    if ((o === 'CREDIT' && w === 'CREDIT') || ((o === 'REJECT' || o === 'INVALID') && (w === 'REJECT' || w === 'INVALID'))) {
      correctImmediate += 1;
    }
  }
  return {
    n: rows.length,
    creditFP,
    rejectFN,
    ask,
    clarificationRate: round(ask / n),
    correctImmediate: round(correctImmediate / n),
    uncertainGoldAskRate: uncertainN ? round(uncertainAsk / uncertainN) : null,
    uncertainN,
    tp,
  };
}

function mkDecide(
  policy: PolicyId,
  tAeNeg: number,
  tAePos: number,
  tNon: number,
  tDev: number
) {
  return (r: Scored): Outcome =>
    decidePolicy({
      policy,
      invalid: r.invalid,
      structural: r.structural,
      pAction: r.pAction,
      pDev: r.pDev,
      tAeNeg,
      tAePos,
      tDevNon: tNon,
      tDevMin: tDev,
    });
}

function gateGold(row: (typeof SEMANTIC_BENCHMARK_V1)[number]): Gold {
  if (isDevelopmental(row.expectedOutcome)) return 'DEVELOPMENTAL';
  if (row.expectedOutcome === 'NEEDS_CLARIFICATION') return 'UNCERTAIN';
  return 'NON_DEVELOPMENTAL';
}

function collectForbidden() {
  const set = new Set<string>();
  for (const r of SEMANTIC_BENCHMARK_V1) set.add(normalize(r.text));
  for (const r of [...STAGE1_STRESS, ...FALSE_CREDIT_SAFETY, ...SHORT_VALID, ...STRUCTURAL_PROBE]) {
    set.add(normalize(r.text));
  }
  for (const fam of NEGATION_PROBE) {
    for (const t of [fam.done, fam.negated, fam.future, fam.almost]) set.add(normalize(t));
  }
  return set;
}

async function main() {
  const hashBefore = {
    threeAFile: sha256File(PROD_3A),
    aeFile: sha256File(PROD_AE),
    threeAWeights: weightFingerprint(prod3aHead.weights, prod3aHead.bias),
    aeWeights: weightFingerprint(prodAeHead.weights, prodAeHead.bias),
  };

  const dev = loadJsonl<DevelopmentalExample>(
    'benchmarks/semantic/datasets/developmental-v1/developmental-v1.jsonl'
  );
  const ae = loadJsonl<ActionEvidenceExample>(
    'benchmarks/semantic/datasets/action-evidence-v2/action-evidence-v2.jsonl'
  );
  const orig3aTrain = dev.filter(
    (r) =>
      r.split === 'train' &&
      r.role === 'core_trainable' &&
      (r.label === 'DEVELOPMENTAL' || r.label === 'NON_DEVELOPMENTAL')
  );
  const orig3aVal = dev.filter(
    (r) =>
      r.split === 'val' &&
      r.role === 'core_trainable' &&
      (r.label === 'DEVELOPMENTAL' || r.label === 'NON_DEVELOPMENTAL')
  );
  const origAeTrain = ae.filter(
    (r) =>
      r.split === 'train' &&
      (r.label === 'ACTION_POSITIVE' || r.label === 'ACTION_NEGATIVE')
  );
  const origAeVal = ae.filter(
    (r) => r.split === 'val' && (r.label === 'ACTION_POSITIVE' || r.label === 'ACTION_NEGATIVE')
  );
  const origAeFamilies = {
    train: new Set(origAeTrain.map((r) => r.familyId)).size,
    val: new Set(origAeVal.map((r) => r.familyId)).size,
  };

  const forbidden = collectForbidden();
  for (const r of [...orig3aVal, ...dev.filter((x) => x.split === 'val')]) forbidden.add(normalize(r.text));
  for (const r of ae.filter((x) => x.split === 'val' || x.split === 'exam')) forbidden.add(normalize(r.text));

  const leaks: { id: string; text: string }[] = [];
  const seen = new Map<string, string>();
  const near: { a: string; b: string }[] = [];
  for (const r of STAGE3_NEW) {
    const nrm = normalize(r.text);
    if (forbidden.has(nrm)) leaks.push({ id: r.id, text: r.text });
    if (seen.has(nrm)) near.push({ a: seen.get(nrm)!, b: r.id });
    else seen.set(nrm, r.id);
  }
  if (leaks.length) {
    throw new Error(`Leakage into Stage 3 new data: ${JSON.stringify(leaks)}`);
  }

  const newTrain = STAGE3_NEW.filter((r) => r.split === 'train');
  const familyHold = STAGE3_NEW.filter((r) => r.split === 'family_holdout');
  const contrastHold = STAGE3_NEW.filter((r) => r.split === 'contrastive_holdout');
  const internal3a = [...familyHold, ...contrastHold].filter(
    (r) => r.threeA === 'DEVELOPMENTAL' || r.threeA === 'NON_DEVELOPMENTAL'
  );
  const internalAe = [...familyHold, ...contrastHold].filter(
    (r) => r.ae === 'ACTION_POSITIVE' || r.ae === 'ACTION_NEGATIVE'
  );

  const train3aTexts = [
    ...orig3aTrain.map((r) => ({ text: r.text, y: r.label === 'DEVELOPMENTAL' ? 1 : 0 })),
    ...newTrain
      .filter((r) => r.threeA === 'DEVELOPMENTAL' || r.threeA === 'NON_DEVELOPMENTAL')
      .map((r) => ({ text: r.text, y: r.threeA === 'DEVELOPMENTAL' ? 1 : 0 })),
  ];
  const trainAeTexts = [
    ...origAeTrain.map((r) => ({ text: r.text, y: r.label === 'ACTION_POSITIVE' ? 1 : 0 })),
    ...newTrain
      .filter((r) => r.ae === 'ACTION_POSITIVE' || r.ae === 'ACTION_NEGATIVE')
      .map((r) => ({ text: r.text, y: r.ae === 'ACTION_POSITIVE' ? 1 : 0 })),
  ];

  await loadMiniLm();
  await loadClientMpnet();

  const miniCache = new Map<string, number[]>();
  const mpnetCache = new Map<string, number[]>();
  async function zMini(text: string) {
    let v = miniCache.get(text);
    if (!v) {
      v = await embedMiniLm(text);
      miniCache.set(text, v);
    }
    return v;
  }
  async function zMpnet(text: string) {
    let v = mpnetCache.get(text);
    if (!v) {
      v = await embedTextMpnet(text);
      mpnetCache.set(text, v);
    }
    return v;
  }

  const uniqueTrain = [...new Set([...train3aTexts.map((r) => r.text), ...trainAeTexts.map((r) => r.text)])];
  for (const t of uniqueTrain) {
    await zMini(t);
    await zMpnet(t);
  }
  for (const r of [...internal3a, ...internalAe, ...STAGE3_NEW]) {
    await zMini(r.text);
    await zMpnet(r.text);
  }

  const variants3a = [
    { tag: 'a', l2: 0.01, epochs: 400, lr: 0.4 },
    { tag: 'b', l2: 0.03, epochs: 400, lr: 0.4 },
  ];
  const trained3a = [];
  for (const v of variants3a) {
    const model = trainHead({
      embeddings: train3aTexts.map((r) => miniCache.get(r.text)!),
      labels: train3aTexts.map((r) => r.y),
      l2: v.l2,
      learningRate: v.lr,
      epochs: v.epochs,
    });
    trained3a.push({ ...v, model, trainCount: train3aTexts.length });
  }
  const variantsAe = [
    { tag: 'a', l2: 0.01, epochs: 400, lr: 0.4 },
    { tag: 'b', l2: 0.03, epochs: 400, lr: 0.4 },
  ];
  const trainedAe = [];
  for (const v of variantsAe) {
    const model = trainHead({
      embeddings: trainAeTexts.map((r) => mpnetCache.get(r.text)!),
      labels: trainAeTexts.map((r) => r.y),
      l2: v.l2,
      learningRate: v.lr,
      epochs: v.epochs,
    });
    trainedAe.push({ ...v, model, trainCount: trainAeTexts.length });
  }

  const threeAGrids: [number, number][] = [
    [0.45, 0.55],
    [0.42, 0.58],
    [0.4, 0.55],
    [0.48, 0.52],
    [0.43, 0.57],
    [0.4, 0.6],
    [0.47, 0.53],
  ];
  const aeGrids: [number, number][] = [
    [0.4407, 0.6165],
    [0.4, 0.6],
    [0.45, 0.58],
    [0.48, 0.62],
    [0.42, 0.65],
    [0.5, 0.62],
    [0.38, 0.58],
  ];

  function score3aInternal(model: { weights: number[]; bias: number }, lo: number, hi: number) {
    let fp = 0;
    let fn = 0;
    let mid = 0;
    let ok = 0;
    for (const r of internal3a) {
      const p = predictProbability(model, miniCache.get(r.text)!);
      const goldDev = r.threeA === 'DEVELOPMENTAL';
      if (p > lo && p < hi) {
        mid += 1;
        continue;
      }
      const predDev = p >= hi;
      if (predDev && !goldDev) fp += 1;
      if (!predDev && goldDev) fn += 1;
      if (predDev === goldDev) ok += 1;
    }
    return { fp, fn, mid, ok, n: internal3a.length };
  }

  function scoreAeInternal(model: { weights: number[]; bias: number }, lo: number, hi: number) {
    let fp = 0;
    let fn = 0;
    let mid = 0;
    let ok = 0;
    for (const r of internalAe) {
      const p = predictProbability(model, mpnetCache.get(r.text)!);
      const goldPos = r.ae === 'ACTION_POSITIVE';
      if (p > lo && p < hi) {
        mid += 1;
        continue;
      }
      const predPos = p >= hi;
      if (predPos && !goldPos) fp += 1;
      if (!predPos && goldPos) fn += 1;
      if (predPos === goldPos) ok += 1;
    }
    return { fp, fn, mid, ok, n: internalAe.length };
  }

  let best3a = { tag: 'a', l2: 0.01, lo: 0.45, hi: 0.55, score: score3aInternal(trained3a[0].model, 0.45, 0.55), model: trained3a[0].model, trainCount: trained3a[0].trainCount };
  for (const t of trained3a) {
    for (const [lo, hi] of threeAGrids) {
      const s = score3aInternal(t.model, lo, hi);
      const cur = best3a.score;
      const rank = (x: { fp: number; fn: number; ok: number; mid: number }) => x.ok - 8 * x.fp - 3 * x.fn;
      const better = rank(s) > rank(cur) || (rank(s) === rank(cur) && s.mid < cur.mid);
      if (better) best3a = { tag: t.tag, l2: t.l2, lo, hi, score: s, model: t.model, trainCount: t.trainCount };
    }
  }

  let bestAe = { tag: 'a', l2: 0.01, lo: 0.4407, hi: 0.6165, score: scoreAeInternal(trainedAe[0].model, 0.4407, 0.6165), model: trainedAe[0].model, trainCount: trainedAe[0].trainCount };
  for (const t of trainedAe) {
    for (const [lo, hi] of aeGrids) {
      const s = scoreAeInternal(t.model, lo, hi);
      const cur = bestAe.score;
      const rank = (x: { fp: number; fn: number; ok: number; mid: number }) => x.ok - 8 * x.fp - 3 * x.fn;
      const better = rank(s) > rank(cur) || (rank(s) === rank(cur) && s.mid < cur.mid);
      if (better) bestAe = { tag: t.tag, l2: t.l2, lo, hi, score: s, model: t.model, trainCount: t.trainCount };
    }
  }

  mkdirSync(ART, { recursive: true });
  const art3a = {
    evaluator: `experimental-3a-stage3-${best3a.tag}`,
    modelId: 'Xenova/all-MiniLM-L6-v2',
    embeddingDim: 384,
    weights: best3a.model.weights,
    bias: best3a.model.bias,
    l2: best3a.l2,
    learningRate: 0.4,
    epochs: 400,
    trainCount: best3a.trainCount,
    experimentalThresholds: { tNon: best3a.lo, tDev: best3a.hi },
    selectedOn: 'stage3 family_holdout+contrastive_holdout only',
  };
  const artAe = {
    evaluator: `experimental-ae-stage3-${bestAe.tag}`,
    modelId: 'Xenova/all-mpnet-base-v2',
    embeddingDim: 768,
    weights: bestAe.model.weights,
    bias: bestAe.model.bias,
    l2: bestAe.l2,
    learningRate: 0.4,
    epochs: 400,
    trainCount: bestAe.trainCount,
    experimentalThresholds: { tNeg: bestAe.lo, tPos: bestAe.hi },
    selectedOn: 'stage3 family_holdout+contrastive_holdout only',
  };
  writeFileSync(join(ART, `experimental-3a-stage3-${best3a.tag}.json`), JSON.stringify(art3a));
  writeFileSync(join(ART, `experimental-ae-stage3-${bestAe.tag}.json`), JSON.stringify(artAe));

  type Stack = {
    name: string;
    ae: { weights: number[]; bias: number };
    threeA: { weights: number[]; bias: number };
    tAeNeg: number;
    tAePos: number;
    tNon: number;
    tDev: number;
  };
  const stacks: Stack[] = [
    {
      name: 'E0',
      ae: prodAeHead,
      threeA: prod3aHead,
      tAeNeg: ACTION_EVIDENCE_CONFIDENT_NEGATIVE,
      tAePos: ACTION_EVIDENCE_CONFIDENT_POSITIVE,
      tNon: PRODUCT_NON_MAX,
      tDev: PRODUCT_DEV_MIN,
    },
    {
      name: 'E1',
      ae: prodAeHead,
      threeA: best3a.model,
      tAeNeg: ACTION_EVIDENCE_CONFIDENT_NEGATIVE,
      tAePos: ACTION_EVIDENCE_CONFIDENT_POSITIVE,
      tNon: best3a.lo,
      tDev: best3a.hi,
    },
    {
      name: 'E2',
      ae: bestAe.model,
      threeA: prod3aHead,
      tAeNeg: bestAe.lo,
      tAePos: bestAe.hi,
      tNon: PRODUCT_NON_MAX,
      tDev: PRODUCT_DEV_MIN,
    },
    {
      name: 'E3',
      ae: bestAe.model,
      threeA: best3a.model,
      tAeNeg: bestAe.lo,
      tAePos: bestAe.hi,
      tNon: best3a.lo,
      tDev: best3a.hi,
    },
  ];

  async function scoreText(text: string, gold: Gold, stack: Stack, structuralMode: 'prod' | 'bypass'): Promise<Scored> {
    const invalid = isDeterministicInvalid(text) || (structuralMode === 'bypass' && looksLikeKeyboardSmash(text));
    const structural =
      structuralMode === 'prod' ? needsFirstPassClarification(text, '') : experimentalStructural(text);
    let pAction: number | null = null;
    let pDev: number | null = null;
    if (!invalid) {
      pDev = predictProbability(stack.threeA, await zMini(text));
    }
    if (!invalid && !structural) {
      pAction = predictProbability(stack.ae, await zMpnet(text));
    }
    return { id: '', text, gold, invalid, structural, pAction, pDev };
  }

  const aux = dev.filter((r) => r.role === 'uncertain_auxiliary');

  type ExtSet = { name: string; rows: { id: string; text: string; gold: Gold }[] };
  const extSets: ExtSet[] = [
    { name: 'val', rows: orig3aVal.map((r) => ({ id: r.id, text: r.text, gold: r.label as Gold })) },
    { name: 'v1', rows: SEMANTIC_BENCHMARK_V1.map((r) => ({ id: r.id, text: r.text, gold: gateGold(r) })) },
    { name: 'stress', rows: STAGE1_STRESS.map((r) => ({ id: r.id, text: r.text, gold: r.gold })) },
    { name: 'fc', rows: FALSE_CREDIT_SAFETY.map((r) => ({ id: r.id, text: r.text, gold: r.gold })) },
    { name: 'sv', rows: SHORT_VALID.map((r) => ({ id: r.id, text: r.text, gold: r.gold })) },
    { name: 'aux', rows: aux.map((r) => ({ id: r.id, text: r.text, gold: 'UNCERTAIN' as Gold })) },
  ];

  const matrix: Record<string, Record<string, ReturnType<typeof metrics>>> = {};
  const negFails: Record<string, { id: string; text: string; outcome: Outcome }[]> = {};

  for (const stack of stacks) {
    for (const policy of ['P0', 'P2'] as PolicyId[]) {
      const key = `${stack.name}-${policy}`;
      matrix[key] = {};
      const decide = mkDecide(policy, stack.tAeNeg, stack.tAePos, stack.tNon, stack.tDev);
      for (const set of extSets) {
        const scored: Scored[] = [];
        for (const r of set.rows) {
          const s = await scoreText(r.text, r.gold, stack, 'prod');
          s.id = r.id;
          scored.push(s);
        }
        matrix[key][set.name] = metrics(scored, decide);
      }
      const nf: { id: string; text: string; outcome: Outcome }[] = [];
      for (const fam of NEGATION_PROBE) {
        for (const [suffix, text, gold] of [
          ['neg', fam.negated, 'NON_DEVELOPMENTAL'],
          ['fut', fam.future, 'NON_DEVELOPMENTAL'],
          ['alm', fam.almost, 'NON_DEVELOPMENTAL'],
        ] as const) {
          const s = await scoreText(text, gold, stack, 'prod');
          const o = decide(s);
          if (o === 'CREDIT') nf.push({ id: `${fam.id}-${suffix}`, text, outcome: o });
        }
      }
      negFails[key] = nf;
    }
  }

  const e3 = stacks.find((s) => s.name === 'E3')!;
  const structReport = [];
  for (const c of STRUCTURAL_PROBE) {
    const prodS = await scoreText(c.text, c.gold, e3, 'prod');
    const bypS = await scoreText(c.text, c.gold, e3, 'bypass');
    const d = mkDecide('P0', e3.tAeNeg, e3.tAePos, e3.tNon, e3.tDev);
    structReport.push({
      id: c.id,
      text: c.text,
      gold: c.gold,
      prod: { structural: prodS.structural, invalid: prodS.invalid, P0: d(prodS), pDev: prodS.pDev, pAction: prodS.pAction },
      bypass: { structural: bypS.structural, invalid: bypS.invalid, P0: d(bypS), pDev: bypS.pDev, pAction: bypS.pAction },
    });
  }

  const probeDeltas = [];
  for (const fam of NEGATION_PROBE) {
    const done = await scoreText(fam.done, 'DEVELOPMENTAL', e3, 'prod');
    const neg = await scoreText(fam.negated, 'NON_DEVELOPMENTAL', e3, 'prod');
    const fut = await scoreText(fam.future, 'NON_DEVELOPMENTAL', e3, 'prod');
    const alm = await scoreText(fam.almost, 'NON_DEVELOPMENTAL', e3, 'prod');
    probeDeltas.push({
      id: fam.id,
      done: { pDev: done.pDev, pAction: done.pAction },
      dNegPDev: done.pDev != null && neg.pDev != null ? round(neg.pDev - done.pDev) : null,
      dFutPDev: done.pDev != null && fut.pDev != null ? round(fut.pDev - done.pDev) : null,
      dAlmPDev: done.pDev != null && alm.pDev != null ? round(alm.pDev - done.pDev) : null,
      dNegPAct: done.pAction != null && neg.pAction != null ? round(neg.pAction - done.pAction) : null,
    });
  }

  const hashAfter = {
    threeAFile: sha256File(PROD_3A),
    aeFile: sha256File(PROD_AE),
    threeAWeights: weightFingerprint(prod3aHead.weights, prod3aHead.bias),
    aeWeights: weightFingerprint(prodAeHead.weights, prodAeHead.bias),
  };

  const byFamily: Record<string, number> = {};
  const byDomain: Record<string, number> = {};
  const byState: Record<string, number> = {};
  const lens: number[] = [];
  for (const r of STAGE3_NEW) {
    byFamily[r.familyId] = (byFamily[r.familyId] || 0) + 1;
    byDomain[r.domain] = (byDomain[r.domain] || 0) + 1;
    byState[r.state] = (byState[r.state] || 0) + 1;
    lens.push(r.text.length);
  }
  lens.sort((a, b) => a - b);

  const report = {
    generatedAt: new Date().toISOString(),
    productionUnchanged: hashBefore.threeAFile === hashAfter.threeAFile && hashBefore.aeFile === hashAfter.aeFile,
    hashes: { before: hashBefore, after: hashAfter, match: hashBefore.threeAFile === hashAfter.threeAFile },
    existingAudit: {
      threeA: {
        train: orig3aTrain.length,
        val: orig3aVal.length,
        trainFamilies: new Set(orig3aTrain.map((r) => r.familyId)).size,
        valFamilies: new Set(orig3aVal.map((r) => r.familyId)).size,
        split: 'family-level VALIDATION_FAMILY_IDS, not random rows',
        trainDev: orig3aTrain.filter((r) => r.label === 'DEVELOPMENTAL').length,
        trainNon: orig3aTrain.filter((r) => r.label === 'NON_DEVELOPMENTAL').length,
      },
      aeV2: {
        train: origAeTrain.length,
        val: origAeVal.length,
        families: origAeFamilies,
        split: 'family-level (val families distinct in jsonl split field)',
        trainPos: origAeTrain.filter((r) => r.label === 'ACTION_POSITIVE').length,
        trainNeg: origAeTrain.filter((r) => r.label === 'ACTION_NEGATIVE').length,
        note: 'Purchases often labeled ACTION_POSITIVE (ordinary completed action). Identity/vibe lines are NEGATIVE.',
      },
    },
    newData: {
      n: STAGE3_NEW.length,
      source: 'manual_stage3',
      leaks,
      exactDupes: near,
      train: newTrain.length,
      familyHoldout: familyHold.length,
      contrastiveHoldout: contrastHold.length,
      threeATrainNew: newTrain.filter((r) => r.threeA === 'DEVELOPMENTAL' || r.threeA === 'NON_DEVELOPMENTAL').length,
      aeTrainNew: newTrain.filter((r) => r.ae === 'ACTION_POSITIVE' || r.ae === 'ACTION_NEGATIVE').length,
      combined3aTrain: train3aTexts.length,
      combinedAeTrain: trainAeTexts.length,
      byFamily,
      byDomain,
      byState,
      length: { min: lens[0], median: lens[Math.floor(lens.length / 2)], max: lens[lens.length - 1] },
    },
    selection: {
      method:
        'Internal val = Stage 3 family_holdout + contrastive_holdout only. Rank = committed_correct - 8*FP - 3*FN, then narrower mid. First attempt (min FP then min FN then min mid) collapsed to near-total abstention; ranking was revised on internal val only. External sets unused.',
      threeA: { tag: best3a.tag, l2: best3a.l2, tNon: best3a.lo, tDev: best3a.hi, internal: best3a.score },
      ae: { tag: bestAe.tag, l2: bestAe.l2, tNeg: bestAe.lo, tPos: bestAe.hi, internal: bestAe.score },
      all3aInternal: trained3a.map((t) => ({
        tag: t.tag,
        l2: t.l2,
        grids: threeAGrids.map(([lo, hi]) => ({ lo, hi, ...score3aInternal(t.model, lo, hi) })),
      })),
    },
    matrix,
    negationCreditFailures: negFails,
    structuralSingleton: structReport,
    probeDeltasAfterRetrain: probeDeltas,
    artifacts: {
      threeA: join(ART, `experimental-3a-stage3-${best3a.tag}.json`),
      ae: join(ART, `experimental-ae-stage3-${bestAe.tag}.json`),
    },
  };

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(ART, 'dataset-stage3.jsonl'), STAGE3_NEW.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(
    JSON.stringify(
      {
        ok: true,
        hashesMatch: report.productionUnchanged,
        leaks: leaks.length,
        selected3a: report.selection.threeA,
        selectedAe: report.selection.ae,
        E0P0val: matrix['E0-P0']?.val,
        E3P0val: matrix['E3-P0']?.val,
        E3P0sv: matrix['E3-P0']?.sv,
        E3P0fc: matrix['E3-P0']?.fc,
        E3P2val: matrix['E3-P2']?.val,
        E1P0val: matrix['E1-P0']?.val,
        E2P0val: matrix['E2-P0']?.val,
        out: OUT,
      },
      null,
      2
    )
  );
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
