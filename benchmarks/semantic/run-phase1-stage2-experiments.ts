/**
 * Phase 1 Stage 2 experiment arena. Frozen production weights only.
 * Alternate policies/thresholds/calibration are simulated in-process.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  ACTION_EVIDENCE_CONFIDENT_NEGATIVE,
  ACTION_EVIDENCE_CONFIDENT_POSITIVE,
  evaluateActionEvidence,
  isProcessWithoutComplement,
  needsFirstPassClarification,
  needsSingletonActivityClarification,
} from '../../lib/evaluation/actionEvidence';
import { evaluateComposerSubmission } from '../../lib/evaluation/developmentalGate';
import {
  PRODUCT_DEV_MIN,
  PRODUCT_NON_MAX,
  isDeterministicInvalid,
} from '../../lib/evaluation/developmentalProductPolicy';
import { predictProbability } from '../../lib/evaluation/semantic/logisticRegression';
import { embedText, loadMiniLm } from '../../lib/evaluation/semantic/minilmEmbeddings';
import { FROZEN_BACKBONES } from '../../lib/evaluation/semantic/frozenSentenceEmbeddings';
import probe3a2 from '../../lib/evaluation/semantic/weights/developmental-3a.2.json';
import type { DevelopmentalExample } from './datasets/developmental-v1/schema';
import type { ActionEvidenceExample } from './datasets/action-evidence-v1/schema';
import { SEMANTIC_BENCHMARK_V1 } from './v1';
import { isDevelopmental } from './scoreContract';
import {
  COMPLETE_INTRANSITIVE,
  ENCODER_PAIRS,
  FALSE_CREDIT_SAFETY,
  NEGATION_PROBE,
  SHORT_VALID,
  STAGE1_STRESS,
  STRUCTURAL_PROBE,
  type GoldGate,
  type LabeledCase,
} from './stage2/fixtures';
import {
  aeBand,
  decidePolicy,
  devBand,
  productionOutcomeToPolicy,
  type Outcome,
  type PolicyId,
} from './stage2/policies';

type Probe = { evaluator: string; weights: number[]; bias: number };
const probe = probe3a2 as Probe;
const OUT = join(process.cwd(), 'benchmarks/semantic/results/phase1-stage2-experiments');

const AE_NEG = ACTION_EVIDENCE_CONFIDENT_NEGATIVE;
const AE_POS = ACTION_EVIDENCE_CONFIDENT_POSITIVE;

type Scored = {
  id: string;
  text: string;
  gold: GoldGate;
  domain?: string;
  invalid: boolean;
  structural: boolean;
  pAction: number | null;
  pDev: number | null;
  productionStatus?: string;
};

function loadJsonl<T>(rel: string): T[] {
  return readFileSync(join(process.cwd(), rel), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
}

function round(n: number, d = 4) {
  return Number(n.toFixed(d));
}

function wanted(gold: GoldGate): Outcome {
  if (gold === 'DEVELOPMENTAL') return 'CREDIT';
  if (gold === 'UNCERTAIN') return 'ASK';
  if (gold === 'INVALID') return 'INVALID';
  return 'REJECT';
}

function gateGold(row: (typeof SEMANTIC_BENCHMARK_V1)[number]): GoldGate {
  if (isDevelopmental(row.expectedOutcome)) return 'DEVELOPMENTAL';
  if (row.expectedOutcome === 'NEEDS_CLARIFICATION') return 'UNCERTAIN';
  return 'NON_DEVELOPMENTAL';
}

function metrics(rows: Scored[], decide: (r: Scored) => Outcome) {
  const n = rows.length || 1;
  let creditFP = 0;
  let rejectFN = 0;
  let ask = 0;
  let correctImmediate = 0;
  let uncertainAsk = 0;
  let uncertainN = 0;
  let tp = 0;
  let tn = 0;
  let committed = 0;
  let committedCorrect = 0;
  for (const r of rows) {
    const o = decide(r);
    const w = wanted(r.gold);
    if (o === 'ASK') ask += 1;
    if (r.gold === 'UNCERTAIN') {
      uncertainN += 1;
      if (o === 'ASK') uncertainAsk += 1;
    }
    const goldDev = r.gold === 'DEVELOPMENTAL';
    const goldNon = r.gold === 'NON_DEVELOPMENTAL' || r.gold === 'INVALID';
    if (o === 'CREDIT' && !goldDev) creditFP += 1;
    if ((o === 'REJECT' || o === 'INVALID') && goldDev) rejectFN += 1;
    if (o !== 'ASK') {
      committed += 1;
      if ((o === 'CREDIT' && goldDev) || ((o === 'REJECT' || o === 'INVALID') && goldNon)) {
        committedCorrect += 1;
      }
    }
    if (o === 'CREDIT' && goldDev) tp += 1;
    if ((o === 'REJECT' || o === 'INVALID') && goldNon) tn += 1;
    if ((o === 'CREDIT' && w === 'CREDIT') || ((o === 'REJECT' || o === 'INVALID') && (w === 'REJECT' || w === 'INVALID'))) {
      correctImmediate += 1;
    }
  }
  const prec = tp + creditFP ? tp / (tp + creditFP) : null;
  const rec = tp + rejectFN ? tp / (tp + rejectFN) : null;
  return {
    n: rows.length,
    creditFP,
    rejectFN,
    clarificationRate: round(ask / n),
    ask,
    correctImmediate: round(correctImmediate / n),
    correctImmediateN: correctImmediate,
    uncertainGoldAskRate: uncertainN ? round(uncertainAsk / uncertainN) : null,
    uncertainN,
    committed,
    committedAccuracy: committed ? round(committedCorrect / committed) : null,
    committedPrecision: prec == null ? null : round(prec),
    committedRecall: rec == null ? null : round(rec),
    tp,
    tn,
  };
}

function diffs(rows: Scored[], a: (r: Scored) => Outcome, b: (r: Scored) => Outcome) {
  const newCredit: { id: string; text: string; gold: GoldGate; from: Outcome; to: Outcome }[] = [];
  const newReject: typeof newCredit = [];
  for (const r of rows) {
    const oa = a(r);
    const ob = b(r);
    if (oa === ob) continue;
    const rec = { id: r.id, text: r.text, gold: r.gold, from: oa, to: ob };
    if (ob === 'CREDIT' && oa !== 'CREDIT') newCredit.push(rec);
    if ((ob === 'REJECT' || ob === 'INVALID') && oa !== 'REJECT' && oa !== 'INVALID') newReject.push(rec);
  }
  return { newCredit, newReject, nChanged: rows.filter((r) => a(r) !== b(r)).length };
}

function mkDecide(
  policy: PolicyId,
  tAeNeg = AE_NEG,
  tAePos = AE_POS,
  tNon = PRODUCT_NON_MAX,
  tDev = PRODUCT_DEV_MIN,
  mapP?: (r: Scored) => { pAction: number | null; pDev: number | null }
) {
  return (r: Scored): Outcome => {
    const p = mapP ? mapP(r) : { pAction: r.pAction, pDev: r.pDev };
    return decidePolicy({
      policy,
      invalid: r.invalid,
      structural: r.structural,
      pAction: p.pAction,
      pDev: p.pDev,
      tAeNeg,
      tAePos,
      tDevNon: tNon,
      tDevMin: tDev,
    });
  };
}

function sigmoid(z: number) {
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

function logit(p: number) {
  const x = Math.min(1 - 1e-6, Math.max(1e-6, p));
  return Math.log(x / (1 - x));
}

function brier(pairs: { y: number; p: number }[]) {
  if (!pairs.length) return null;
  return round(pairs.reduce((s, r) => s + (r.p - r.y) ** 2, 0) / pairs.length);
}

function ece(pairs: { y: number; p: number }[], bins = 10) {
  if (!pairs.length) return null;
  const bucket: { n: number; p: number; y: number }[] = Array.from({ length: bins }, () => ({
    n: 0,
    p: 0,
    y: 0,
  }));
  for (const r of pairs) {
    const i = Math.min(bins - 1, Math.floor(r.p * bins));
    bucket[i].n += 1;
    bucket[i].p += r.p;
    bucket[i].y += r.y;
  }
  let s = 0;
  for (const b of bucket) {
    if (!b.n) continue;
    s += (b.n / pairs.length) * Math.abs(b.p / b.n - b.y / b.n);
  }
  return round(s);
}

function fitPlatt(logits: number[], labels: number[]) {
  let a = 1;
  let b = 0;
  const n = logits.length;
  for (let epoch = 0; epoch < 400; epoch++) {
    let da = 0;
    let db = 0;
    for (let i = 0; i < n; i++) {
      const p = sigmoid(a * logits[i] + b);
      const err = p - labels[i];
      da += err * logits[i];
      db += err;
    }
    a -= 0.05 * (da / n + 0.001 * a);
    b -= 0.05 * (db / n);
  }
  return { a: round(a, 6), b: round(b, 6) };
}

function fitTemperature(logits: number[], labels: number[]) {
  let bestT = 1;
  let bestNll = Infinity;
  for (let t = 0.4; t <= 3.01; t += 0.05) {
    let nll = 0;
    for (let i = 0; i < logits.length; i++) {
      const p = Math.min(1 - 1e-9, Math.max(1e-9, sigmoid(logits[i] / t)));
      const y = labels[i];
      nll += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
    }
    if (nll < bestNll) {
      bestNll = nll;
      bestT = t;
    }
  }
  return { T: round(bestT, 4), trainNll: round(bestNll / logits.length, 6) };
}

function cosine(a: number[], b: number[]) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return round(s, 4);
}

async function embedWithModel(modelId: string, pooling: 'mean' | 'cls', texts: string[]) {
  const { env, pipeline } = await import('@xenova/transformers');
  env.allowLocalModels = false;
  env.cacheDir = join(process.cwd(), '.cache/transformers');
  const loaded = await pipeline('feature-extraction', modelId, { quantized: true });
  const out: number[][] = [];
  const t0 = Date.now();
  for (const text of texts) {
    const result = await loaded(text, { pooling, normalize: true });
    out.push(Array.from(result.data as Float32Array));
  }
  return { vectors: out, ms: Date.now() - t0, dim: out[0]?.length ?? 0 };
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

function experimentalInvalid(text: string) {
  return isDeterministicInvalid(text) || looksLikeKeyboardSmash(text);
}

function attr(r: Scored) {
  if (r.invalid) return 'deterministic_invalid';
  if (r.structural) return 'structural';
  if (r.pAction == null) return 'missing_action';
  const ae = aeBand(r.pAction, AE_NEG, AE_POS);
  const d = r.pDev == null ? 'missing' : devBand(r.pDev, PRODUCT_NON_MAX, PRODUCT_DEV_MIN);
  if (ae === 'NEG') return 'AE_confident_negative';
  if (ae === 'UNC') {
    if (d === 'NON') return 'AE_uncertain+3A_NON';
    if (d === 'DEV') return 'AE_uncertain+3A_DEV';
    return 'AE_uncertain+3A_UNC';
  }
  if (d === 'NON') return 'AE_POS+3A_NON';
  if (d === 'DEV') return 'AE_POS+3A_DEV';
  return 'AE_POS+3A_UNC';
}

async function scoreCase(id: string, text: string, gold: GoldGate, domain?: string): Promise<Scored> {
  const invalid = isDeterministicInvalid(text);
  const structural = needsFirstPassClarification(text, '');
  let pAction: number | null = null;
  let pDev: number | null = null;
  if (!invalid) {
    const z = await embedText(text);
    pDev = predictProbability({ weights: probe.weights, bias: probe.bias }, z);
  }
  if (!invalid && !structural) {
    const action = await evaluateActionEvidence(text);
    pAction = action.pAction;
  }
  return { id, text, gold, domain, invalid, structural, pAction, pDev };
}

async function main() {
  if (probe.evaluator !== 'candidate-developmental-3a.2') {
    throw new Error('Refusing non-3A.2 probe');
  }
  await loadMiniLm();

  const dev = loadJsonl<DevelopmentalExample>(
    'benchmarks/semantic/datasets/developmental-v1/developmental-v1.jsonl'
  );
  const ae = loadJsonl<ActionEvidenceExample>(
    'benchmarks/semantic/datasets/action-evidence-v2/action-evidence-v2.jsonl'
  );
  const valSrc = dev.filter(
    (r) =>
      r.split === 'val' &&
      r.role === 'core_trainable' &&
      (r.label === 'DEVELOPMENTAL' || r.label === 'NON_DEVELOPMENTAL')
  );
  const auxSrc = dev.filter((r) => r.role === 'uncertain_auxiliary');
  const trainSrc = dev.filter(
    (r) =>
      r.split === 'train' &&
      r.role === 'core_trainable' &&
      (r.label === 'DEVELOPMENTAL' || r.label === 'NON_DEVELOPMENTAL')
  );
  const aeTrain = ae.filter(
    (r) => r.split === 'train' && (r.label === 'ACTION_POSITIVE' || r.label === 'ACTION_NEGATIVE')
  );

  const val: Scored[] = [];
  for (const r of valSrc) {
    val.push(await scoreCase(r.id, r.text, r.label as GoldGate, r.domain));
  }
  const aux: Scored[] = [];
  for (const r of auxSrc) aux.push(await scoreCase(r.id, r.text, 'UNCERTAIN', r.domain));
  const v1: Scored[] = [];
  for (const r of SEMANTIC_BENCHMARK_V1) {
    v1.push(await scoreCase(r.id, r.text, gateGold(r), r.selectedCategories.join(',')));
  }
  const stress: Scored[] = [];
  for (const r of STAGE1_STRESS) stress.push(await scoreCase(r.id, r.text, r.gold, r.domain));
  const fc: Scored[] = [];
  for (const r of FALSE_CREDIT_SAFETY) fc.push(await scoreCase(r.id, r.text, r.gold, r.domain));
  const sv: Scored[] = [];
  for (const r of SHORT_VALID) sv.push(await scoreCase(r.id, r.text, r.gold, r.domain));
  const st: Scored[] = [];
  for (const r of STRUCTURAL_PROBE) st.push(await scoreCase(r.id, r.text, r.gold));

  const probeRows: Scored[] = [];
  for (const fam of NEGATION_PROBE) {
    probeRows.push(await scoreCase(`${fam.id}-done`, fam.done, 'DEVELOPMENTAL', fam.domain));
    probeRows.push(await scoreCase(`${fam.id}-neg`, fam.negated, 'NON_DEVELOPMENTAL', fam.domain));
    probeRows.push(await scoreCase(`${fam.id}-fut`, fam.future, 'NON_DEVELOPMENTAL', fam.domain));
    probeRows.push(await scoreCase(`${fam.id}-alm`, fam.almost, 'NON_DEVELOPMENTAL', fam.domain));
  }

  let parityMismatches = 0;
  const parityExamples: { id: string; prod: string; p0: Outcome }[] = [];
  for (const r of [...val, ...v1, ...stress]) {
    const prod = await evaluateComposerSubmission({ activity: r.text, details: '' });
    r.productionStatus = prod.status;
    const p0 = mkDecide('P0')(r);
    const mapped = productionOutcomeToPolicy(prod.status);
    if (p0 !== mapped) {
      parityMismatches += 1;
      if (parityExamples.length < 12) {
        parityExamples.push({ id: r.id, prod: prod.status, p0 });
      }
    }
  }

  if (parityMismatches > 0) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(
      join(OUT, 'PARITY_FAIL.json'),
      JSON.stringify({ parityMismatches, parityExamples }, null, 2)
    );
    console.error(JSON.stringify({ ok: false, parityMismatches, parityExamples }, null, 2));
    process.exit(1);
  }

  const sets: Record<string, Scored[]> = { val, v1, stress, aux, fc, sv };
  const policies: PolicyId[] = ['P0', 'P1', 'P2', 'P3'];
  const policyTable: Record<string, Record<string, ReturnType<typeof metrics>>> = {};
  const policyDiffs: Record<string, unknown> = {};
  for (const p of policies) {
    policyTable[p] = {};
    for (const [name, rows] of Object.entries(sets)) {
      policyTable[p][name] = metrics(rows, mkDecide(p));
    }
  }
  for (const p of ['P1', 'P2', 'P3'] as PolicyId[]) {
    policyDiffs[p] = {
      val: diffs(val, mkDecide('P0'), mkDecide(p)),
      v1: diffs(v1, mkDecide('P0'), mkDecide(p)),
      stress: diffs(stress, mkDecide('P0'), mkDecide(p)),
      fc: diffs(fc, mkDecide('P0'), mkDecide(p)),
      sv: diffs(sv, mkDecide('P0'), mkDecide(p)),
      aux: diffs(aux, mkDecide('P0'), mkDecide(p)),
    };
  }

  const aeNegs = [0.35, 0.4, 0.4407, 0.48, 0.5];
  const aePoss = [0.52, 0.55, 0.58, 0.6165, 0.65, 0.7];
  const aeSweep = [];
  for (const lo of aeNegs) {
    for (const hi of aePoss) {
      if (lo >= hi) continue;
      const decide = mkDecide('P0', lo, hi);
      aeSweep.push({
        tNeg: lo,
        tPos: hi,
        val: metrics(val, decide),
        v1: metrics(v1, decide),
        stress: metrics(stress, decide),
        fc: metrics(fc, decide),
        sv: metrics(sv, decide),
      });
    }
  }
  const interestingAe = aeSweep
    .filter((row) => row.val.creditFP <= 1 && row.fc.creditFP <= 1)
    .sort((a, b) => a.val.clarificationRate - b.val.clarificationRate)
    .slice(0, 8);

  const devBands: [number, number][] = [
    [0.45, 0.55],
    [0.48, 0.52],
    [0.47, 0.53],
    [0.42, 0.58],
    [0.4, 0.6],
    [0.45, 0.6],
    [0.4, 0.55],
    [0.43, 0.57],
  ];
  const devSweep = [];
  for (const policy of ['P0', 'P1', 'P2'] as PolicyId[]) {
    for (const [lo, hi] of devBands) {
      const decide = mkDecide(policy, AE_NEG, AE_POS, lo, hi);
      devSweep.push({
        policy,
        tNon: lo,
        tDev: hi,
        val: metrics(val, decide),
        v1: metrics(v1, decide),
        sv: metrics(sv, decide),
        fc: metrics(fc, decide),
      });
    }
  }

  const trainDev: { y: number; p: number; z: number }[] = [];
  for (const r of trainSrc) {
    if (isDeterministicInvalid(r.text)) continue;
    const e = await embedText(r.text);
    const p = predictProbability({ weights: probe.weights, bias: probe.bias }, e);
    trainDev.push({ y: r.label === 'DEVELOPMENTAL' ? 1 : 0, p, z: logit(p) });
  }
  const valPairs = val
    .filter((r) => r.pDev != null)
    .map((r) => ({ y: r.gold === 'DEVELOPMENTAL' ? 1 : 0, p: r.pDev as number, z: logit(r.pDev as number) }));
  const platt = fitPlatt(
    trainDev.map((r) => r.z),
    trainDev.map((r) => r.y)
  );
  const temp = fitTemperature(
    trainDev.map((r) => r.z),
    trainDev.map((r) => r.y)
  );
  const applyPlatt = (p: number) => sigmoid(platt.a * logit(p) + platt.b);
  const applyTemp = (p: number) => sigmoid(logit(p) / temp.T);

  const aeTrainPairs: { y: number; p: number; z: number }[] = [];
  for (const r of aeTrain) {
    if (isDeterministicInvalid(r.text) || needsFirstPassClarification(r.text, '')) continue;
    const a = await evaluateActionEvidence(r.text);
    aeTrainPairs.push({
      y: r.label === 'ACTION_POSITIVE' ? 1 : 0,
      p: a.pAction,
      z: logit(a.pAction),
    });
  }
  const plattAe = fitPlatt(
    aeTrainPairs.map((r) => r.z),
    aeTrainPairs.map((r) => r.y)
  );
  const tempAe = fitTemperature(
    aeTrainPairs.map((r) => r.z),
    aeTrainPairs.map((r) => r.y)
  );

  const calValRaw = valPairs.map((r) => ({ y: r.y, p: r.p }));
  const calValPlatt = valPairs.map((r) => ({ y: r.y, p: applyPlatt(r.p) }));
  const calValTemp = valPairs.map((r) => ({ y: r.y, p: applyTemp(r.p) }));

  const mapPlattDev = (r: Scored) => ({
    pAction: r.pAction,
    pDev: r.pDev == null ? null : applyPlatt(r.pDev),
  });
  const mapTempDev = (r: Scored) => ({
    pAction: r.pAction,
    pDev: r.pDev == null ? null : applyTemp(r.pDev),
  });
  const mapPlattAe = (r: Scored) => ({
    pAction: r.pAction == null ? null : sigmoid(plattAe.a * logit(r.pAction) + plattAe.b),
    pDev: r.pDev,
  });
  const mapBothPlatt = (r: Scored) => ({
    pAction: r.pAction == null ? null : sigmoid(plattAe.a * logit(r.pAction) + plattAe.b),
    pDev: r.pDev == null ? null : applyPlatt(r.pDev),
  });

  function calBlock(
    name: string,
    mapper: (r: Scored) => { pAction: number | null; pDev: number | null }
  ) {
    return {
      name,
      P0: { val: metrics(val, mkDecide('P0', AE_NEG, AE_POS, PRODUCT_NON_MAX, PRODUCT_DEV_MIN, mapper)), v1: metrics(v1, mkDecide('P0', AE_NEG, AE_POS, PRODUCT_NON_MAX, PRODUCT_DEV_MIN, mapper)), sv: metrics(sv, mkDecide('P0', AE_NEG, AE_POS, PRODUCT_NON_MAX, PRODUCT_DEV_MIN, mapper)), fc: metrics(fc, mkDecide('P0', AE_NEG, AE_POS, PRODUCT_NON_MAX, PRODUCT_DEV_MIN, mapper)) },
      P1: { val: metrics(val, mkDecide('P1', AE_NEG, AE_POS, PRODUCT_NON_MAX, PRODUCT_DEV_MIN, mapper)), v1: metrics(v1, mkDecide('P1', AE_NEG, AE_POS, PRODUCT_NON_MAX, PRODUCT_DEV_MIN, mapper)), sv: metrics(sv, mkDecide('P1', AE_NEG, AE_POS, PRODUCT_NON_MAX, PRODUCT_DEV_MIN, mapper)), fc: metrics(fc, mkDecide('P1', AE_NEG, AE_POS, PRODUCT_NON_MAX, PRODUCT_DEV_MIN, mapper)) },
      P2: { val: metrics(val, mkDecide('P2', AE_NEG, AE_POS, PRODUCT_NON_MAX, PRODUCT_DEV_MIN, mapper)), fc: metrics(fc, mkDecide('P2', AE_NEG, AE_POS, PRODUCT_NON_MAX, PRODUCT_DEV_MIN, mapper)), sv: metrics(sv, mkDecide('P2', AE_NEG, AE_POS, PRODUCT_NON_MAX, PRODUCT_DEV_MIN, mapper)) },
    };
  }

  const bandOcc = (ps: number[], lo: number, hi: number) => {
    const n = ps.length || 1;
    return {
      le: round(ps.filter((p) => p <= lo).length / n),
      mid: round(ps.filter((p) => p > lo && p < hi).length / n),
      ge: round(ps.filter((p) => p >= hi).length / n),
    };
  };

  const attribution: Record<string, Record<string, number>> = {};
  for (const [name, rows] of Object.entries(sets)) {
    const c: Record<string, number> = {};
    for (const r of rows) {
      const k = attr(r);
      c[k] = (c[k] || 0) + 1;
    }
    attribution[name] = c;
  }

  const aeUncVal = val.filter((r) => !r.invalid && !r.structural && r.pAction != null && aeBand(r.pAction, AE_NEG, AE_POS) === 'UNC');
  const aeUncBreakdown = {
    n: aeUncVal.length,
    threeA_NON: aeUncVal.filter((r) => r.pDev != null && devBand(r.pDev, PRODUCT_NON_MAX, PRODUCT_DEV_MIN) === 'NON').length,
    threeA_DEV: aeUncVal.filter((r) => r.pDev != null && devBand(r.pDev, PRODUCT_NON_MAX, PRODUCT_DEV_MIN) === 'DEV').length,
    threeA_UNC: aeUncVal.filter((r) => r.pDev != null && devBand(r.pDev, PRODUCT_NON_MAX, PRODUCT_DEV_MIN) === 'UNC').length,
    goldDev: aeUncVal.filter((r) => r.gold === 'DEVELOPMENTAL').length,
    goldNon: aeUncVal.filter((r) => r.gold !== 'DEVELOPMENTAL').length,
    threeA_DEV_but_goldNon: aeUncVal
      .filter((r) => r.gold !== 'DEVELOPMENTAL' && r.pDev != null && devBand(r.pDev, PRODUCT_NON_MAX, PRODUCT_DEV_MIN) === 'DEV')
      .map((r) => ({ id: r.id, text: r.text, pDev: round(r.pDev!), pAction: round(r.pAction!) })),
    threeA_NON_but_goldDev: aeUncVal
      .filter((r) => r.gold === 'DEVELOPMENTAL' && r.pDev != null && devBand(r.pDev, PRODUCT_NON_MAX, PRODUCT_DEV_MIN) === 'NON')
      .map((r) => ({ id: r.id, text: r.text, pDev: round(r.pDev!), pAction: round(r.pAction!) })),
  };

  const negationReport = NEGATION_PROBE.map((fam) => {
    const done = probeRows.find((r) => r.id === `${fam.id}-done`)!;
    const neg = probeRows.find((r) => r.id === `${fam.id}-neg`)!;
    const fut = probeRows.find((r) => r.id === `${fam.id}-fut`)!;
    const alm = probeRows.find((r) => r.id === `${fam.id}-alm`)!;
    const row = (r: Scored) => ({
      pAction: r.pAction == null ? null : round(r.pAction),
      pDev: r.pDev == null ? null : round(r.pDev),
      P0: mkDecide('P0')(r),
      P1: mkDecide('P1')(r),
      P2: mkDecide('P2')(r),
      P3: mkDecide('P3')(r),
      structural: r.structural,
    });
    return {
      id: fam.id,
      done: { text: fam.done, ...row(done) },
      negated: {
        text: fam.negated,
        ...row(neg),
        dPAction: done.pAction != null && neg.pAction != null ? round(neg.pAction - done.pAction) : null,
        dPDev: done.pDev != null && neg.pDev != null ? round(neg.pDev - done.pDev) : null,
      },
      future: {
        text: fam.future,
        ...row(fut),
        dPAction: done.pAction != null && fut.pAction != null ? round(fut.pAction - done.pAction) : null,
        dPDev: done.pDev != null && fut.pDev != null ? round(fut.pDev - done.pDev) : null,
      },
      almost: {
        text: fam.almost,
        ...row(alm),
        dPAction: done.pAction != null && alm.pAction != null ? round(alm.pAction - done.pAction) : null,
        dPDev: done.pDev != null && alm.pDev != null ? round(alm.pDev - done.pDev) : null,
      },
    };
  });

  const uniqueProbeTexts = [...new Set(ENCODER_PAIRS.flatMap((p) => [p.a, p.b]))];
  const minilmVecs: number[][] = [];
  for (const t of uniqueProbeTexts) minilmVecs.push(await embedText(t));
  const mpnetVecs: number[][] = [];
  for (const t of uniqueProbeTexts) {
    const { embedTextMpnet, loadClientMpnet } = await import('../../lib/evaluation/mpnetClient');
    await loadClientMpnet();
    mpnetVecs.push(await embedTextMpnet(t));
  }
  let bge:
    | { ok: true; dim: number; ms: number; pairs: unknown[] }
    | { ok: false; error: string } = { ok: false, error: 'not run' };
  try {
    const spec = FROZEN_BACKBONES.find((s) => s.id === 'bge')!;
    const loaded = await embedWithModel(spec.runtimeModelId, spec.pooling, uniqueProbeTexts);
    const idx = (t: string) => uniqueProbeTexts.indexOf(t);
    bge = {
      ok: true,
      dim: loaded.dim,
      ms: loaded.ms,
      pairs: ENCODER_PAIRS.map((p) => ({
        id: p.id,
        kind: p.kind,
        cosine: cosine(loaded.vectors[idx(p.a)], loaded.vectors[idx(p.b)]),
      })),
    };
  } catch (err) {
    bge = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const idx = (t: string) => uniqueProbeTexts.indexOf(t);
  const encoderCompare = {
    minilm: {
      model: 'Xenova/all-MiniLM-L6-v2',
      dim: 384,
      pairs: ENCODER_PAIRS.map((p) => ({
        id: p.id,
        kind: p.kind,
        cosine: cosine(minilmVecs[idx(p.a)], minilmVecs[idx(p.b)]),
      })),
    },
    mpnet: {
      model: 'Xenova/all-mpnet-base-v2',
      dim: 768,
      pairs: ENCODER_PAIRS.map((p) => ({
        id: p.id,
        kind: p.kind,
        cosine: cosine(mpnetVecs[idx(p.a)], mpnetVecs[idx(p.b)]),
      })),
    },
    bge,
    note: 'Cosine on frozen embeddings only. No classifier trained. Lower cosine on contrast pairs is better separation.',
  };

  const structuralAlt = STRUCTURAL_PROBE.map((c) => {
    const prodInvalid = isDeterministicInvalid(c.text);
    const prodStruct = needsFirstPassClarification(c.text, '');
    const expInvalid = experimentalInvalid(c.text);
    const expStruct = !expInvalid && experimentalStructural(c.text);
    return {
      id: c.id,
      text: c.text,
      gold: c.gold,
      production: prodInvalid ? 'INVALID' : prodStruct ? 'ASK' : 'ml',
      experimental: expInvalid ? 'INVALID' : expStruct ? 'ASK' : 'ml',
    };
  });

  const p0Stage1 = {
    val: metrics(val, mkDecide('P0')),
    expected: { clarificationRate: 0.6739, creditFP: 1, rejectFN: 1, n: 92 },
  };

  const report = {
    generatedAt: new Date().toISOString(),
    productionUnchanged: true,
    harnessParity: {
      mismatches: parityMismatches,
      compared: val.length + v1.length + stress.length,
      note: 'P0 simulated from frozen pAction/pDev + production structural/invalid matched evaluateComposerSubmission.',
    },
    p0Stage1Check: p0Stage1,
    policyTable,
    policyDiffs,
    aeSweepTopSafe: interestingAe,
    aeSweepN: aeSweep.length,
    devSweep,
    calibration: {
      platt3a: platt,
      temperature3a: temp,
      plattAe,
      temperatureAe: tempAe,
      isotonic: {
        skipped: true,
        reason:
          'Val n=92 is too small for a reliable isotonic fit+eval split; fitting on train and evaluating on val is possible but isotonic is high-variance with 405 points and was skipped to avoid over-claiming.',
      },
      valBrier: {
        raw: brier(calValRaw),
        platt: brier(calValPlatt),
        temperature: brier(calValTemp),
      },
      valEce: {
        raw: ece(calValRaw),
        platt: ece(calValPlatt),
        temperature: ece(calValTemp),
      },
      bandOccupancyValPDev: {
        raw: bandOcc(valPairs.map((r) => r.p), 0.45, 0.55),
        platt: bandOcc(valPairs.map((r) => applyPlatt(r.p)), 0.45, 0.55),
        temperature: bandOcc(valPairs.map((r) => applyTemp(r.p)), 0.45, 0.55),
      },
      downstream: {
        platt3a: calBlock('platt3a', mapPlattDev),
        temp3a: calBlock('temp3a', mapTempDev),
        plattAe: calBlock('plattAe', mapPlattAe),
        bothPlatt: calBlock('bothPlatt', mapBothPlatt),
      },
    },
    attribution,
    aeUncBreakdown,
    negationReport,
    encoderCompare,
    structuralAlt,
    falseCreditP0toP3: {
      P0: metrics(fc, mkDecide('P0')),
      P1: metrics(fc, mkDecide('P1')),
      P2: metrics(fc, mkDecide('P2')),
      P3: metrics(fc, mkDecide('P3')),
      p1NewCredit: (policyDiffs as { P1: { fc: { newCredit: unknown[] } } }).P1.fc.newCredit,
      p3NewCredit: (policyDiffs as { P3: { fc: { newCredit: unknown[] } } }).P3.fc.newCredit,
    },
    shortValid: {
      P0: metrics(sv, mkDecide('P0')),
      P1: metrics(sv, mkDecide('P1')),
      P2: metrics(sv, mkDecide('P2')),
      P3: metrics(sv, mkDecide('P3')),
    },
  };

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(report, null, 2));
  writeFileSync(
    join(OUT, 'ae-sweep.json'),
    JSON.stringify(aeSweep, null, 2)
  );
  writeFileSync(
    join(OUT, 'rows-compact.json'),
    JSON.stringify(
      {
        val: val.map((r) => ({
          id: r.id,
          gold: r.gold,
          pA: r.pAction == null ? null : round(r.pAction),
          pD: r.pDev == null ? null : round(r.pDev),
          P0: mkDecide('P0')(r),
          P1: mkDecide('P1')(r),
          P2: mkDecide('P2')(r),
          P3: mkDecide('P3')(r),
          attr: attr(r),
        })),
        v1: v1.map((r) => ({
          id: r.id,
          gold: r.gold,
          pA: r.pAction == null ? null : round(r.pAction),
          pD: r.pDev == null ? null : round(r.pDev),
          P0: mkDecide('P0')(r),
          P1: mkDecide('P1')(r),
          P2: mkDecide('P2')(r),
          P3: mkDecide('P3')(r),
        })),
      },
      null,
      2
    )
  );
  console.log(
    JSON.stringify(
      {
        ok: true,
        parityMismatches,
        p0val: policyTable.P0.val,
        p1val: policyTable.P1.val,
        p2val: policyTable.P2.val,
        p3val: policyTable.P3.val,
        p0v1: policyTable.P0.v1,
        p1fc: policyTable.P1.fc,
        p3fc: policyTable.P3.fc,
        p1sv: policyTable.P1.sv,
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
