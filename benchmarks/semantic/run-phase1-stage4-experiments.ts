/**
 * Stage 4 encoder bake-off. Writes only under benchmarks/semantic/stage4
 * and results/phase1-stage4-experiments. Never overwrites production weights.
 */
import { createHash } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  ACTION_EVIDENCE_CONFIDENT_NEGATIVE,
  ACTION_EVIDENCE_CONFIDENT_POSITIVE,
  needsFirstPassClarification,
} from '../../lib/evaluation/actionEvidence';
import { isDeterministicInvalid } from '../../lib/evaluation/developmentalProductPolicy';
import { PRODUCT_DEV_MIN, PRODUCT_NON_MAX } from '../../lib/evaluation/developmentalProductPolicy';
import { predictProbability, type LogisticModel } from '../../lib/evaluation/semantic/logisticRegression';
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
} from './stage2/fixtures';
import { decidePolicy, type Outcome, type PolicyId } from './stage2/policies';
import { STAGE3_NEW } from './stage3/newExamples';
import { trainHead } from './stage3/train';
import {
  embedStage4,
  loadStage4Encoder,
  STAGE4_ENCODERS,
  STAGE4_NOT_SELECTED,
  unloadStage4Encoder,
  type Stage4EncoderId,
  type Stage4EncoderSpec,
} from './stage4/encoders';
import { CLEAN_AE_CONTRACT_EXAMPLES, cleanAeLabelFromStage3 } from './stage4/cleanAe';
import { GEOMETRY_FAMILIES, STATE_KEYS, type StateKey } from './stage4/geometryProbes';

const ART = join(process.cwd(), 'benchmarks/semantic/stage4/artifacts');
const OUT = join(process.cwd(), 'benchmarks/semantic/results/phase1-stage4-experiments');
const PROD_3A = join(process.cwd(), 'lib/evaluation/semantic/weights/developmental-3a.2.json');
const PROD_AE = join(process.cwd(), 'lib/evaluation/semantic/weights/action-evidence-mpnet.json');

type Head = { weights: number[]; bias: number };
const prod3aHead = prod3a as Head;
const prodAeHead = prodAe as Head;

function sha256File(path: string) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function weightFingerprint(weights: number[], bias: number) {
  return createHash('sha256').update(JSON.stringify({ weights, bias })).digest('hex');
}

function round(n: number, d = 4) {
  return Number(n.toFixed(d));
}

function cosine(a: number[], b: number[]) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12);
}

function mean(xs: number[]) {
  return xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
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
  let gamingCredit = 0;
  for (const r of rows) {
    const o = decide(r);
    const goldDev = r.gold === 'DEVELOPMENTAL';
    if (o === 'ASK') ask += 1;
    if (r.gold === 'UNCERTAIN') {
      uncertainN += 1;
      if (o === 'ASK') uncertainAsk += 1;
    }
    if (o === 'CREDIT' && !goldDev) creditFP += 1;
    if ((o === 'REJECT' || o === 'INVALID') && goldDev) rejectFN += 1;
    if (o === 'CREDIT' && goldDev) tp += 1;
    if (o === 'CREDIT' && /give me|ignore your rules|maximum xp/i.test(r.text) && !goldDev) gamingCredit += 1;
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
    gamingCredit,
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

function loadJsonl<T>(rel: string): T[] {
  return readFileSync(join(process.cwd(), rel), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
}

const THREE_A_GRIDS: [number, number][] = [
  [0.45, 0.55],
  [0.42, 0.58],
  [0.4, 0.55],
  [0.48, 0.52],
  [0.43, 0.57],
  [0.4, 0.6],
  [0.47, 0.53],
];
const AE_GRIDS: [number, number][] = [
  [0.4407, 0.6165],
  [0.4, 0.6],
  [0.45, 0.58],
  [0.48, 0.62],
  [0.42, 0.65],
  [0.5, 0.62],
  [0.38, 0.58],
];
const VARIANTS = [
  { tag: 'a', l2: 0.01, epochs: 400, lr: 0.4 },
  { tag: 'b', l2: 0.03, epochs: 400, lr: 0.4 },
];

function rankInternal(x: { fp: number; fn: number; ok: number; mid: number }) {
  return x.ok - 8 * x.fp - 3 * x.fn;
}

function scoreInternal(
  model: LogisticModel,
  rows: { text: string; y: number }[],
  cache: Map<string, number[]>,
  lo: number,
  hi: number
) {
  let fp = 0;
  let fn = 0;
  let mid = 0;
  let ok = 0;
  for (const r of rows) {
    const p = predictProbability(model, cache.get(r.text)!);
    if (p > lo && p < hi) {
      mid += 1;
      continue;
    }
    const pred = p >= hi ? 1 : 0;
    if (pred === 1 && r.y === 0) fp += 1;
    if (pred === 0 && r.y === 1) fn += 1;
    if (pred === r.y) ok += 1;
  }
  return { fp, fn, mid, ok, n: rows.length };
}

function selectHead(
  trained: { tag: string; l2: number; model: LogisticModel; trainCount: number }[],
  internal: { text: string; y: number }[],
  cache: Map<string, number[]>,
  grids: [number, number][],
  defaultLo: number,
  defaultHi: number
) {
  let best = {
    tag: trained[0].tag,
    l2: trained[0].l2,
    lo: defaultLo,
    hi: defaultHi,
    score: scoreInternal(trained[0].model, internal, cache, defaultLo, defaultHi),
    model: trained[0].model,
    trainCount: trained[0].trainCount,
  };
  for (const t of trained) {
    for (const [lo, hi] of grids) {
      const s = scoreInternal(t.model, internal, cache, lo, hi);
      const better = rankInternal(s) > rankInternal(best.score) || (rankInternal(s) === rankInternal(best.score) && s.mid < best.score.mid);
      if (better) best = { tag: t.tag, l2: t.l2, lo, hi, score: s, model: t.model, trainCount: t.trainCount };
    }
  }
  return best;
}

function trainVariants(rows: { text: string; y: number }[], cache: Map<string, number[]>) {
  return VARIANTS.map((v) => ({
    ...v,
    trainCount: rows.length,
    model: trainHead({
      embeddings: rows.map((r) => cache.get(r.text)!),
      labels: rows.map((r) => r.y),
      l2: v.l2,
      learningRate: v.lr,
      epochs: v.epochs,
    }),
  }));
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
    (r) => r.split === 'train' && r.role === 'core_trainable' && (r.label === 'DEVELOPMENTAL' || r.label === 'NON_DEVELOPMENTAL')
  );
  const orig3aVal = dev.filter(
    (r) => r.split === 'val' && r.role === 'core_trainable' && (r.label === 'DEVELOPMENTAL' || r.label === 'NON_DEVELOPMENTAL')
  );
  const origAeTrain = ae.filter(
    (r) => r.split === 'train' && (r.label === 'ACTION_POSITIVE' || r.label === 'ACTION_NEGATIVE')
  );
  const aux = dev.filter((r) => r.role === 'uncertain_auxiliary');
  const newTrain = STAGE3_NEW.filter((r) => r.split === 'train');
  const familyHold = STAGE3_NEW.filter((r) => r.split === 'family_holdout');
  const contrastHold = STAGE3_NEW.filter((r) => r.split === 'contrastive_holdout');
  const internalSrc = [...familyHold, ...contrastHold];

  const train3a = [
    ...orig3aTrain.map((r) => ({ text: r.text, y: r.label === 'DEVELOPMENTAL' ? 1 : 0 })),
    ...newTrain
      .filter((r) => r.threeA === 'DEVELOPMENTAL' || r.threeA === 'NON_DEVELOPMENTAL')
      .map((r) => ({ text: r.text, y: r.threeA === 'DEVELOPMENTAL' ? 1 : 0 })),
  ];
  const internal3a = internalSrc
    .filter((r) => r.threeA === 'DEVELOPMENTAL' || r.threeA === 'NON_DEVELOPMENTAL')
    .map((r) => ({ text: r.text, y: r.threeA === 'DEVELOPMENTAL' ? 1 : 0 }));

  const trainAeDirty = [
    ...origAeTrain.map((r) => ({ text: r.text, y: r.label === 'ACTION_POSITIVE' ? 1 : 0 })),
    ...newTrain
      .filter((r) => r.ae === 'ACTION_POSITIVE' || r.ae === 'ACTION_NEGATIVE')
      .map((r) => ({ text: r.text, y: r.ae === 'ACTION_POSITIVE' ? 1 : 0 })),
  ];
  const trainAeCleanMap = new Map<string, number>();
  for (const r of origAeTrain) trainAeCleanMap.set(r.text, r.label === 'ACTION_POSITIVE' ? 1 : 0);
  for (const r of newTrain) {
    const y = cleanAeLabelFromStage3(r);
    if (y != null) trainAeCleanMap.set(r.text, y);
  }
  for (const r of CLEAN_AE_CONTRACT_EXAMPLES) trainAeCleanMap.set(r.text, r.y);
  const trainAeClean = [...trainAeCleanMap.entries()].map(([text, y]) => ({ text, y }));
  const internalAeClean = internalSrc
    .map((r) => {
      const y = cleanAeLabelFromStage3(r);
      return y == null ? null : { text: r.text, y };
    })
    .filter((r): r is { text: string; y: number } => r != null);

  const extSets: { name: string; rows: { id: string; text: string; gold: Gold }[] }[] = [
    { name: 'val', rows: orig3aVal.map((r) => ({ id: r.id, text: r.text, gold: r.label as Gold })) },
    { name: 'v1', rows: SEMANTIC_BENCHMARK_V1.map((r) => ({ id: r.id, text: r.text, gold: gateGold(r) })) },
    { name: 'stress', rows: STAGE1_STRESS.map((r) => ({ id: r.id, text: r.text, gold: r.gold })) },
    { name: 'fc', rows: FALSE_CREDIT_SAFETY.map((r) => ({ id: r.id, text: r.text, gold: r.gold })) },
    { name: 'sv', rows: SHORT_VALID.map((r) => ({ id: r.id, text: r.text, gold: r.gold })) },
    { name: 'aux', rows: aux.map((r) => ({ id: r.id, text: r.text, gold: 'UNCERTAIN' as Gold })) },
    {
      name: 'holdout',
      rows: internalSrc.map((r) => ({
        id: r.id,
        text: r.text,
        gold: r.threeA === 'UNCERTAIN' ? 'UNCERTAIN' : (r.threeA as Gold),
      })),
    },
  ];

  const unique = new Set<string>();
  for (const t of [
    ...train3a.map((r) => r.text),
    ...trainAeDirty.map((r) => r.text),
    ...trainAeClean.map((r) => r.text),
    ...internal3a.map((r) => r.text),
    ...internalAeClean.map((r) => r.text),
    ...CLEAN_AE_CONTRACT_EXAMPLES.map((r) => r.text),
  ]) {
    unique.add(t);
  }
  for (const set of extSets) for (const r of set.rows) unique.add(r.text);
  for (const fam of NEGATION_PROBE) {
    unique.add(fam.done);
    unique.add(fam.negated);
    unique.add(fam.future);
    unique.add(fam.almost);
  }
  for (const fam of GEOMETRY_FAMILIES) {
    for (const k of STATE_KEYS) unique.add(fam.states[k]);
  }
  const nliHyps = {
    completed: 'This text states that the person already completed the action.',
    negated: 'This text states that the person did not do the action.',
    future: 'This text states that the person intends to do the action later.',
    almost: 'This text states that the person nearly did the action but did not complete it.',
  };
  for (const t of Object.values(nliHyps)) unique.add(t);
  const allTexts = [...unique];

  mkdirSync(ART, { recursive: true });
  mkdirSync(OUT, { recursive: true });

  const encoderReports: Record<string, unknown> = {};
  const mpnetSpec = STAGE4_ENCODERS.find((s) => s.id === 'mpnet')!;
  console.log('\n=== prefetch production AE encoder (mpnet) ===');
  await loadStage4Encoder(mpnetSpec);
  const mpnetCache = new Map<string, number[]>();
  for (const text of allTexts) mpnetCache.set(text, await embedStage4(text));
  unloadStage4Encoder();

  for (const spec of STAGE4_ENCODERS) {
    console.log(`\n=== encoder ${spec.id} ${spec.runtimeModelId} ===`);
    const loadInfo = await loadStage4Encoder(spec);
    const cache = new Map<string, number[]>();
    const tEmbed0 = Date.now();
    if (spec.id === 'mpnet') {
      for (const [text, vec] of mpnetCache) cache.set(text, vec);
    } else {
      for (const text of allTexts) cache.set(text, await embedStage4(text));
    }
    const embedAllMs = Date.now() - tEmbed0;
    const warmN = 40;
    const tWarm0 = Date.now();
    for (let i = 0; i < warmN; i++) await embedStage4('Completed workout');
    const warmMsPer = (Date.now() - tWarm0) / warmN;

    const geometry = GEOMETRY_FAMILIES.map((fam) => {
      const z = {} as Record<StateKey, number[]>;
      for (const k of STATE_KEYS) z[k] = cache.get(fam.states[k])!;
      const sims: Record<string, number> = {};
      for (const k of STATE_KEYS) {
        if (k === 'completed') continue;
        sims[`completed_vs_${k}`] = round(cosine(z.completed, z[k]));
      }
      sims.short_vs_completed = round(cosine(z.shortCompleted, z.completed));
      sims.short_vs_future = round(cosine(z.shortCompleted, z.future));
      sims.paraphrase_completed_short = round(cosine(z.completed, z.shortCompleted));
      const margins = {
        completed_minus_negated: round(1 - cosine(z.completed, z.negated)),
        completed_minus_future: round(1 - cosine(z.completed, z.future)),
        completed_minus_almost: round(1 - cosine(z.completed, z.almost)),
      };
      return { id: fam.id, domain: fam.domain, sims, margins };
    });
    const geoSummary = {
      meanCompletedVsNegated: round(mean(geometry.map((g) => g.sims.completed_vs_negated))),
      meanCompletedVsFuture: round(mean(geometry.map((g) => g.sims.completed_vs_future))),
      meanCompletedVsAlmost: round(mean(geometry.map((g) => g.sims.completed_vs_almost))),
      meanCompletedVsPlan: round(mean(geometry.map((g) => g.sims.completed_vs_plan))),
      meanCompletedVsPurchase: round(mean(geometry.map((g) => g.sims.completed_vs_purchase))),
      meanCompletedVsPassive: round(mean(geometry.map((g) => g.sims.completed_vs_passive))),
      meanParaphrase: round(mean(geometry.map((g) => g.sims.paraphrase_completed_short))),
    };

    const retrievalPool: { text: string; state: string; family: string }[] = [];
    for (const fam of GEOMETRY_FAMILIES) {
      for (const k of STATE_KEYS) retrievalPool.push({ text: fam.states[k], state: k, family: fam.id });
    }
    for (const fam of NEGATION_PROBE) {
      retrievalPool.push({ text: fam.done, state: 'completed', family: fam.id });
      retrievalPool.push({ text: fam.negated, state: 'negated', family: fam.id });
      retrievalPool.push({ text: fam.future, state: 'future', family: fam.id });
      retrievalPool.push({ text: fam.almost, state: 'almost', family: fam.id });
    }

    function topkPurity(queryText: string, queryState: string, k = 5) {
      const q = cache.get(queryText)!;
      const ranked = retrievalPool
        .filter((p) => p.text !== queryText)
        .map((p) => ({ ...p, sim: cosine(q, cache.get(p.text)!) }))
        .sort((a, b) => b.sim - a.sim)
        .slice(0, k);
      const sameState = ranked.filter((r) => r.state === queryState).length;
      const lexicalTrap = ranked.filter((r) => r.family === retrievalPool.find((x) => x.text === queryText)?.family && r.state !== queryState).length;
      return {
        queryState,
        k,
        sameState,
        purity: round(sameState / k),
        sameFamilyOtherState: lexicalTrap,
        top: ranked.map((r) => ({ state: r.state, family: r.family, sim: round(r.sim), text: r.text })),
      };
    }

    const retrieval = {
      completed: GEOMETRY_FAMILIES.map((f) => topkPurity(f.states.completed, 'completed')),
      future: GEOMETRY_FAMILIES.map((f) => topkPurity(f.states.future, 'future')),
      negated: GEOMETRY_FAMILIES.map((f) => topkPurity(f.states.negated, 'negated')),
    };
    const retrievalSummary = {
      completedMeanPurity: round(mean(retrieval.completed.map((r) => r.purity))),
      futureMeanPurity: round(mean(retrieval.future.map((r) => r.purity))),
      negatedMeanPurity: round(mean(retrieval.negated.map((r) => r.purity))),
    };

    const nliHits = { completed: 0, negated: 0, future: 0, almost: 0, n: 0 };
    type NliKey = keyof typeof nliHyps;
    for (const fam of [...GEOMETRY_FAMILIES.map((f) => ({
      done: f.states.completed,
      negated: f.states.negated,
      future: f.states.future,
      almost: f.states.almost,
    })), ...NEGATION_PROBE]) {
      const pairs: [string, NliKey][] = [
        [fam.done, 'completed'],
        [fam.negated, 'negated'],
        [fam.future, 'future'],
        [fam.almost, 'almost'],
      ];
      for (const [text, gold] of pairs) {
        nliHits.n += 1;
        let best: NliKey = 'completed';
        let bestSim = -1;
        for (const key of Object.keys(nliHyps) as NliKey[]) {
          const s = cosine(cache.get(text)!, cache.get(nliHyps[key])!);
          if (s > bestSim) {
            bestSim = s;
            best = key;
          }
        }
        if (best === gold) nliHits[gold] += 1;
      }
    }

    const trained3a = trainVariants(train3a, cache);
    const best3a = selectHead(trained3a, internal3a, cache, THREE_A_GRIDS, 0.45, 0.55);
    const trainedAe = trainVariants(trainAeClean, cache);
    const bestAe = selectHead(trainedAe, internalAeClean, cache, AE_GRIDS, 0.4407, 0.6165);

    writeFileSync(
      join(ART, `experimental-3a-${spec.id}.json`),
      JSON.stringify({
        evaluator: `stage4-3a-${spec.id}-${best3a.tag}`,
        modelId: spec.runtimeModelId,
        embeddingDim: spec.expectedDim,
        weights: best3a.model.weights,
        bias: best3a.model.bias,
        l2: best3a.l2,
        experimentalThresholds: { tNon: best3a.lo, tDev: best3a.hi },
        selectedOn: 'stage3 family_holdout+contrastive_holdout only',
      })
    );
    writeFileSync(
      join(ART, `experimental-ae-clean-${spec.id}.json`),
      JSON.stringify({
        evaluator: `stage4-ae-clean-${spec.id}-${bestAe.tag}`,
        modelId: spec.runtimeModelId,
        embeddingDim: spec.expectedDim,
        weights: bestAe.model.weights,
        bias: bestAe.model.bias,
        l2: bestAe.l2,
        experimentalThresholds: { tNeg: bestAe.lo, tPos: bestAe.hi },
        selectedOn: 'stage3 holdouts + clean AE contract, internal only',
      })
    );

    type Arch = {
      name: string;
      pActionOf: (text: string) => number | null;
      pDevOf: (text: string) => number;
      tAeNeg: number;
      tAePos: number;
      tNon: number;
      tDev: number;
    };

    const archs: Arch[] = [
      {
        name: 'A',
        pActionOf: (text) => predictProbability(prodAeHead, mpnetCache.get(text)!),
        pDevOf: (text) => predictProbability(best3a.model, cache.get(text)!),
        tAeNeg: ACTION_EVIDENCE_CONFIDENT_NEGATIVE,
        tAePos: ACTION_EVIDENCE_CONFIDENT_POSITIVE,
        tNon: best3a.lo,
        tDev: best3a.hi,
      },
      {
        name: 'B',
        pActionOf: (text) => predictProbability(bestAe.model, cache.get(text)!),
        pDevOf: (text) => predictProbability(best3a.model, cache.get(text)!),
        tAeNeg: bestAe.lo,
        tAePos: bestAe.hi,
        tNon: best3a.lo,
        tDev: best3a.hi,
      },
      {
        name: 'C',
        pActionOf: () => 0.99,
        pDevOf: (text) => predictProbability(best3a.model, cache.get(text)!),
        tAeNeg: ACTION_EVIDENCE_CONFIDENT_NEGATIVE,
        tAePos: ACTION_EVIDENCE_CONFIDENT_POSITIVE,
        tNon: best3a.lo,
        tDev: best3a.hi,
      },
    ];

    function scoreText(text: string, gold: Gold, arch: Arch): Scored {
      const invalid = isDeterministicInvalid(text);
      const structural = needsFirstPassClarification(text, '');
      let pAction: number | null = null;
      let pDev: number | null = null;
      if (!invalid) pDev = arch.pDevOf(text);
      if (!invalid && !structural) pAction = arch.pActionOf(text);
      return { id: '', text, gold, invalid, structural, pAction, pDev };
    }

    const matrix: Record<string, Record<string, ReturnType<typeof metrics>>> = {};
    const negFails: Record<string, { id: string; kind: string; text: string; outcome: Outcome; pDev: number | null }[]> = {};
    const svImmediate: Record<string, { credit: number; n: number; rate: number }> = {};

    for (const arch of archs) {
      for (const policy of ['P0'] as PolicyId[]) {
        const key = `${arch.name}-${policy}`;
        const decide = mkDecide(policy, arch.tAeNeg, arch.tAePos, arch.tNon, arch.tDev);
        matrix[key] = {};
        for (const set of extSets) {
          const scored: Scored[] = [];
          for (const r of set.rows) {
            const s = scoreText(r.text, r.gold, arch);
            s.id = r.id;
            scored.push(s);
          }
          matrix[key][set.name] = metrics(scored, decide);
        }
        const svRows = extSets.find((s) => s.name === 'sv')!.rows.map((r) => {
          const s = scoreText(r.text, r.gold, arch);
          s.id = r.id;
          return s;
        });
        let credit = 0;
        for (const r of svRows) if (decide(r) === 'CREDIT') credit += 1;
        svImmediate[key] = { credit, n: svRows.length, rate: round(credit / svRows.length) };

        const nf: { id: string; kind: string; text: string; outcome: Outcome; pDev: number | null }[] = [];
        for (const fam of NEGATION_PROBE) {
          for (const [kind, text] of [
            ['neg', fam.negated],
            ['fut', fam.future],
            ['alm', fam.almost],
          ] as const) {
            const s = scoreText(text, 'NON_DEVELOPMENTAL', arch);
            const o = decide(s);
            if (o === 'CREDIT') nf.push({ id: fam.id, kind, text, outcome: o, pDev: s.pDev });
          }
        }
        negFails[key] = nf;
      }
    }

    const probeDeltas = NEGATION_PROBE.map((fam) => {
      const pDone = predictProbability(best3a.model, cache.get(fam.done)!);
      const pNeg = predictProbability(best3a.model, cache.get(fam.negated)!);
      const pFut = predictProbability(best3a.model, cache.get(fam.future)!);
      const pAlm = predictProbability(best3a.model, cache.get(fam.almost)!);
      return {
        id: fam.id,
        pDone: round(pDone),
        dNeg: round(pDone - pNeg),
        dFut: round(pDone - pFut),
        dAlm: round(pDone - pAlm),
      };
    });

    encoderReports[spec.id] = {
      spec: {
        ...spec,
        load: loadInfo,
        warmMsPerEmbedMacNode: round(warmMsPer, 2),
        embedAllMs,
        uniqueTexts: allTexts.length,
      },
      geometry,
      geoSummary,
      retrievalSummary,
      retrievalSample: {
        completed0: retrieval.completed[0],
        future0: retrieval.future[0],
      },
      nliTemplateProbe: {
        note: 'Argmax cosine to four frozen hypothesis strings. Not a trained NLI model.',
        accuracy: round(
          (nliHits.completed + nliHits.negated + nliHits.future + nliHits.almost) / nliHits.n
        ),
        byGold: nliHits,
      },
      threeA: {
        tag: best3a.tag,
        l2: best3a.l2,
        lo: best3a.lo,
        hi: best3a.hi,
        internal: best3a.score,
        trainCount: best3a.trainCount,
        probeDeltas,
        meanDNeg: round(mean(probeDeltas.map((p) => p.dNeg))),
        meanDFut: round(mean(probeDeltas.map((p) => p.dFut))),
        meanDAlm: round(mean(probeDeltas.map((p) => p.dAlm))),
      },
      aeClean: {
        tag: bestAe.tag,
        l2: bestAe.l2,
        lo: bestAe.lo,
        hi: bestAe.hi,
        internal: bestAe.score,
        trainCount: bestAe.trainCount,
      },
      dirtyVsCleanTrainCounts: {
        dirty: trainAeDirty.length,
        clean: trainAeClean.length,
      },
      matrix,
      svImmediate,
      negFails,
    };

    unloadStage4Encoder();
  }

  const hashAfter = {
    threeAFile: sha256File(PROD_3A),
    aeFile: sha256File(PROD_AE),
    threeAWeights: weightFingerprint(prod3aHead.weights, prod3aHead.bias),
    aeWeights: weightFingerprint(prodAeHead.weights, prodAeHead.bias),
  };

  const table = STAGE4_ENCODERS.map((spec) => {
    const r = encoderReports[spec.id] as {
      spec: { expectedDim: number; approxQuantizedOnnxMb: number; load: { coldLoadMs: number }; warmMsPerEmbedMacNode: number };
      geoSummary: { meanCompletedVsNegated: number; meanCompletedVsFuture: number; meanCompletedVsAlmost: number };
      threeA: { meanDNeg: number; meanDFut: number; meanDAlm: number };
      matrix: Record<string, Record<string, { creditFP: number; rejectFN: number; clarificationRate: number; uncertainGoldAskRate: number | null }>>;
      svImmediate: Record<string, { rate: number }>;
      negFails: Record<string, unknown[]>;
    };
    const a = r.matrix['A-P0'];
    const b = r.matrix['B-P0'];
    return {
      encoder: spec.id,
      dim: spec.expectedDim,
      approxQuantizedMb: spec.approxQuantizedOnnxMb,
      stateSepCosineCompletedVsNeg: r.geoSummary.meanCompletedVsNegated,
      stateSepCosineCompletedVsFut: r.geoSummary.meanCompletedVsFuture,
      stateSepCosineCompletedVsAlm: r.geoSummary.meanCompletedVsAlmost,
      probeMeanDpDevNeg: r.threeA.meanDNeg,
      probeMeanDpDevFut: r.threeA.meanDFut,
      probeMeanDpDevAlm: r.threeA.meanDAlm,
      archA_val_FP: a?.val.creditFP ?? null,
      archA_val_FN: a?.val.rejectFN ?? null,
      archA_val_ASK: a?.val.clarificationRate ?? null,
      archA_v1_FP: a?.v1.creditFP ?? null,
      archA_v1_FN: a?.v1.rejectFN ?? null,
      archA_svImmediate: r.svImmediate['A-P0']?.rate ?? null,
      archA_fc_FP: a?.fc.creditFP ?? null,
      archA_negCreditFails: r.negFails['A-P0']?.length ?? null,
      archA_auxAsk: a?.aux.uncertainGoldAskRate ?? null,
      archB_val_ASK: b?.val.clarificationRate ?? null,
      archB_val_FP: b?.val.creditFP ?? null,
      archB_svImmediate: r.svImmediate['B-P0']?.rate ?? null,
      archB_fc_FP: b?.fc.creditFP ?? null,
      archB_negCreditFails: r.negFails['B-P0']?.length ?? null,
      coldLoadMsMacNode: r.spec.load.coldLoadMs,
      warmMsPerEmbedMacNode: r.spec.warmMsPerEmbedMacNode,
      browserFeasible: spec.transformersJs && spec.approxQuantizedOnnxMb <= 120,
    };
  });

  const summary = {
    stage: 4,
    productionFrozen: true,
    hashBefore,
    hashAfter,
    hashesMatch: JSON.stringify(hashBefore) === JSON.stringify(hashAfter),
    candidateSelectionDocs: {
      selected: STAGE4_ENCODERS.map((s) => ({ id: s.id, docs: s.docs, why: s.whySelected, prefix: s.prefix })),
      notSelected: STAGE4_NOT_SELECTED,
    },
    cleanAeContract: {
      definition: 'Did the user provide evidence that a concrete action actually occurred?',
      not: 'Does the action deserve developmental credit?',
      extras: CLEAN_AE_CONTRACT_EXAMPLES,
      implication:
        'Shared-encoder AE can fire POS on completed purchases/errands while 3A remains NON. Production AE v2 already treated many purchases as POS; Stage 3 AE training fought that contract.',
    },
    methodology: {
      linearProbe: 'Identical Stage 3 family splits, labels for 3A, trainBinaryLogistic variants l2 0.01/0.03 lr 0.4 epochs 400, internal rank ok-8FP-3FN then fewer mid-band, no external threshold peek-then-tune.',
      policy: 'P0 two-axis only (production-shaped). P1/P2/P3 not shipped and not used as winners.',
      archA: 'Frozen production MPNet AE weights+thresholds + candidate 3A head.',
      archB: 'Same candidate embedding, clean-contract AE head + 3A head.',
      archC: 'Diagnostic: AE forced POS, 3A decides. Not a product proposal.',
    },
    table,
    encoders: encoderReports,
  };

  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  writeFileSync(join(OUT, 'comparison-table.json'), JSON.stringify(table, null, 2));
  console.log('\nStage 4 written. hashesMatch=', summary.hashesMatch);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
