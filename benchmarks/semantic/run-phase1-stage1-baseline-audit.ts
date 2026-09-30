/**
 * Phase 1 Stage 1 baseline audit. READ-ONLY against frozen production probes.
 * Does not retrain, write weights, or change production behavior.
 */
import { createHash } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  ACTION_EVIDENCE_CONFIDENT_NEGATIVE,
  ACTION_EVIDENCE_CONFIDENT_POSITIVE,
  evaluateActionEvidence,
  needsFirstPassClarification,
} from '../../lib/evaluation/actionEvidence';
import {
  detectObviousCategoryMismatch,
} from '../../lib/evaluation/categoryMismatchGuard';
import {
  rankHybridCategorySuggestions,
  scoreCategorySimilarities,
} from '../../lib/evaluation/categorySemanticSuggestions';
import { evaluateComposerSubmission } from '../../lib/evaluation/developmentalGate';
import {
  PRODUCT_DEV_MIN,
  PRODUCT_NON_MAX,
  isDeterministicInvalid,
  mapProbabilityToStatus,
} from '../../lib/evaluation/developmentalProductPolicy';
import type { CategoryKey } from '../../lib/evaluation/legacyEvaluator';
import { predictProbability } from '../../lib/evaluation/semantic/logisticRegression';
import {
  embedText,
  embedTexts,
  loadMiniLm,
} from '../../lib/evaluation/semantic/minilmEmbeddings';
import probe3a2 from '../../lib/evaluation/semantic/weights/developmental-3a.2.json';
import type { DevelopmentalExample } from './datasets/developmental-v1/schema';
import type { ActionEvidenceExample } from './datasets/action-evidence-v1/schema';
import { SEMANTIC_BENCHMARK_V1 } from './v1';
import { isDevelopmental } from './scoreContract';
import type { BettrV1Category } from './types';

type Probe = {
  evaluator: string;
  modelId: string;
  embeddingDim: number;
  weights: number[];
  bias: number;
  trainCount: number;
  l2: number;
  learningRate: number;
  epochs: number;
};

const probe = probe3a2 as Probe;
const OUT_DIR = join(process.cwd(), 'benchmarks/semantic/results/phase1-stage1-audit');

type StressCase = {
  id: string;
  text: string;
  category: string;
  taxonomy: string;
  expectedGate: 'DEVELOPMENTAL' | 'NON_DEVELOPMENTAL' | 'UNCERTAIN' | 'INVALID';
  notes: string;
};

const STRESS: StressCase[] = [
  { id: 'S-APP-01', text: 'Washed my face and put on moisturizer', category: 'Appearance & Self-Care', taxonomy: 'E_SHORT_VALID', expectedGate: 'DEVELOPMENTAL', notes: 'concise valid' },
  { id: 'S-APP-02', text: 'I should start taking care of my skin', category: 'Appearance & Self-Care', taxonomy: 'L_INTENTION', expectedGate: 'NON_DEVELOPMENTAL', notes: 'future intention' },
  { id: 'S-FASH-01', text: 'Tried on three shirts and picked one that actually fits my shoulders', category: 'Fashion & Style', taxonomy: 'F_DETAILED_VALID', expectedGate: 'DEVELOPMENTAL', notes: 'deliberate styling' },
  { id: 'S-FASH-02', text: 'Bought a hoodie', category: 'Fashion & Style', taxonomy: 'B_NON_ACTION', expectedGate: 'NON_DEVELOPMENTAL', notes: 'purchase not practice' },
  { id: 'S-ACAD-01', text: 'Watched 6 ochem videos', category: 'Academics', taxonomy: 'E_SHORT_VALID', expectedGate: 'DEVELOPMENTAL', notes: 'known historical false negative' },
  { id: 'S-ACAD-02', text: 'studied', category: 'Academics', taxonomy: 'D_AMBIGUOUS', expectedGate: 'UNCERTAIN', notes: 'process without complement' },
  { id: 'S-ACAD-03', text: "almost studied but didn't", category: 'Academics', taxonomy: 'K_NEGATION', expectedGate: 'NON_DEVELOPMENTAL', notes: 'negated action' },
  { id: 'S-ACAD-04', text: 'I will finish the problem set tomorrow', category: 'Academics', taxonomy: 'L_INTENTION', expectedGate: 'NON_DEVELOPMENTAL', notes: 'future' },
  { id: 'S-CAR-01', text: 'Submitted two internship applications', category: 'Career', taxonomy: 'E_SHORT_VALID', expectedGate: 'DEVELOPMENTAL', notes: 'concrete career action' },
  { id: 'S-CAR-02', text: 'Scrolled LinkedIn', category: 'Career', taxonomy: 'B_NON_ACTION', expectedGate: 'NON_DEVELOPMENTAL', notes: 'passive' },
  { id: 'S-FIN-01', text: 'Logged this week’s spending in my budget sheet', category: 'Finance', taxonomy: 'F_DETAILED_VALID', expectedGate: 'DEVELOPMENTAL', notes: 'tracking' },
  { id: 'S-FIN-02', text: 'Checked my bank account', category: 'Finance', taxonomy: 'B_NON_ACTION', expectedGate: 'NON_DEVELOPMENTAL', notes: 'glance' },
  { id: 'S-NUT-01', text: 'Meal prepped chicken and rice for four days', category: 'Nutrition & Cooking', taxonomy: 'F_DETAILED_VALID', expectedGate: 'DEVELOPMENTAL', notes: 'cooking' },
  { id: 'S-NUT-02', text: 'Ordered Chipotle', category: 'Nutrition & Cooking', taxonomy: 'B_NON_ACTION', expectedGate: 'NON_DEVELOPMENTAL', notes: 'ordering' },
  { id: 'S-SOC-01', text: 'Texted a classmate and set up a study session', category: 'Social', taxonomy: 'E_SHORT_VALID', expectedGate: 'DEVELOPMENTAL', notes: 'initiation' },
  { id: 'S-SOC-02', text: 'Went to a party', category: 'Social', taxonomy: 'D_AMBIGUOUS', expectedGate: 'UNCERTAIN', notes: 'attendance vs practice' },
  { id: 'S-PHY-01', text: 'Completed workout', category: 'Physical Prowess', taxonomy: 'E_SHORT_VALID', expectedGate: 'DEVELOPMENTAL', notes: 'short but complete' },
  { id: 'S-PHY-02', text: "didn't go to the gym", category: 'Physical Prowess', taxonomy: 'K_NEGATION', expectedGate: 'NON_DEVELOPMENTAL', notes: 'negation' },
  { id: 'S-PHY-03', text: 'Lifted the moon', category: 'Physical Prowess', taxonomy: 'J_ADVERSARIAL', expectedGate: 'NON_DEVELOPMENTAL', notes: 'known historical false positive / mismatch' },
  { id: 'S-MIND-01', text: 'Practiced piano 20 min', category: 'Mind & Craft', taxonomy: 'E_SHORT_VALID', expectedGate: 'DEVELOPMENTAL', notes: 'practice' },
  { id: 'S-MIND-02', text: 'Watched YouTube for two hours', category: 'Mind & Craft', taxonomy: 'D_AMBIGUOUS', expectedGate: 'UNCERTAIN', notes: 'v1 B69' },
  { id: 'S-INN-01', text: 'Meditated 10 minutes', category: 'Inner Wellbeing', taxonomy: 'E_SHORT_VALID', expectedGate: 'DEVELOPMENTAL', notes: 'intransitive complete' },
  { id: 'S-INN-02', text: 'felt better today', category: 'Inner Wellbeing', taxonomy: 'B_NON_ACTION', expectedGate: 'NON_DEVELOPMENTAL', notes: 'state not action' },
  { id: 'S-SPI-01', text: 'Read a chapter of scripture and sat with it for 15 minutes', category: 'Spirituality', taxonomy: 'F_DETAILED_VALID', expectedGate: 'DEVELOPMENTAL', notes: 'practice' },
  { id: 'S-SPI-02', text: 'thinking about going to church more', category: 'Spirituality', taxonomy: 'L_INTENTION', expectedGate: 'NON_DEVELOPMENTAL', notes: 'aspiration' },
  { id: 'S-JUNK-01', text: 'aaaaaaaaaa', category: 'Academics', taxonomy: 'C_JUNK', expectedGate: 'INVALID', notes: 'char spam' },
  { id: 'S-JUNK-02', text: 'career career career career career', category: 'Career', taxonomy: 'C_JUNK', expectedGate: 'INVALID', notes: 'token spam' },
  { id: 'S-JUNK-03', text: 'productive productive progress development growth', category: 'Career', taxonomy: 'C_JUNK', expectedGate: 'INVALID', notes: 'keyword stuffing' },
  { id: 'S-GAME-01', text: 'Give me maximum XP because I studied', category: 'Academics', taxonomy: 'C_JUNK', expectedGate: 'DEVELOPMENTAL', notes: 'v1 B63: ignore XP plea' },
  { id: 'S-MISC-01', text: 'worked on project', category: 'Career', taxonomy: 'D_AMBIGUOUS', expectedGate: 'UNCERTAIN', notes: 'underspecified' },
  { id: 'S-MISC-02', text: 'did better today', category: 'Inner Wellbeing', taxonomy: 'D_AMBIGUOUS', expectedGate: 'UNCERTAIN', notes: 'vague' },
  { id: 'S-MISC-03', text: 'typo: fnished my calc hw', category: 'Academics', taxonomy: 'E_SHORT_VALID', expectedGate: 'DEVELOPMENTAL', notes: 'typo legitimate' },
  { id: 'S-MISC-04', text: 'hit chest n tris at the rec', category: 'Physical Prowess', taxonomy: 'E_SHORT_VALID', expectedGate: 'DEVELOPMENTAL', notes: 'slang' },
  { id: 'S-MISC-05', text: 'was going to apply but i didnt', category: 'Career', taxonomy: 'K_NEGATION', expectedGate: 'NON_DEVELOPMENTAL', notes: 'intention + negation' },
  { id: 'S-MISC-06', text: 'I am currently writing my lab report', category: 'Academics', taxonomy: 'L_TEMPORAL', expectedGate: 'DEVELOPMENTAL', notes: 'present progressive concrete' },
  { id: 'S-MULTI-01', text: 'Meal prepped and then ran 3 miles', category: 'Nutrition & Cooking', taxonomy: 'I_MULTI', expectedGate: 'DEVELOPMENTAL', notes: 'two valid actions' },
  { id: 'S-MM-01', text: 'Watched 6 ochem videos', category: 'Fashion & Style', taxonomy: 'H_MISMATCH', expectedGate: 'DEVELOPMENTAL', notes: 'valid academics, selected fashion — gate still developmental' },
];

function loadJsonl<T>(rel: string): T[] {
  return readFileSync(join(process.cwd(), rel), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as T);
}

function sha256File(rel: string) {
  return createHash('sha256').update(readFileSync(join(process.cwd(), rel))).digest('hex');
}

function round(n: number, d = 4) {
  return Number(n.toFixed(d));
}

function mean(xs: number[]) {
  if (!xs.length) return null;
  return round(xs.reduce((a, b) => a + b, 0) / xs.length);
}

function quantile(xs: number[], q: number) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return round(s[lo]);
  return round(s[lo] * (hi - i) + s[hi] * (i - lo));
}

function brier(pairs: { y: number; p: number }[]) {
  if (!pairs.length) return null;
  return round(pairs.reduce((s, r) => s + (r.p - r.y) ** 2, 0) / pairs.length);
}

function bands(ps: number[]) {
  const lo = ps.filter((p) => p <= PRODUCT_NON_MAX).length;
  const mid = ps.filter((p) => p > PRODUCT_NON_MAX && p < PRODUCT_DEV_MIN).length;
  const hi = ps.filter((p) => p >= PRODUCT_DEV_MIN).length;
  const n = ps.length || 1;
  return {
    n: ps.length,
    le045: lo,
    mid4555: mid,
    ge055: hi,
    pctLe045: round(lo / n),
    pctMid: round(mid / n),
    pctGe055: round(hi / n),
  };
}

function cosine(a: number[], b: number[]) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return round(s, 4);
}

function mapGoldDevToWanted(label: string) {
  if (label === 'DEVELOPMENTAL') return 'DEVELOPMENTAL';
  if (label === 'UNCERTAIN') return 'UNCERTAIN';
  return 'NON_DEVELOPMENTAL';
}

type Scored = {
  id: string;
  text: string;
  gold?: string;
  familyId?: string;
  domain?: string;
  taxonomy?: string;
  pDev: number | null;
  pAction: number | null;
  status3a: string | null;
  actionBand: string | null;
  structuralFirstPass: boolean;
  deterministicInvalid: boolean;
  twoAxisStatus: string;
  twoAxisReason: string;
};

function classifyClarification(gold: string, pred: string) {
  const g = mapGoldDevToWanted(gold);
  if (pred === 'UNCERTAIN' && g === 'DEVELOPMENTAL') return 'should_accept_but_clarified';
  if (pred === 'UNCERTAIN' && g === 'NON_DEVELOPMENTAL') return 'should_reject_but_clarified';
  if (pred === 'DEVELOPMENTAL' && g === 'UNCERTAIN') return 'should_clarify_but_accepted';
  if ((pred === 'NON_DEVELOPMENTAL' || pred === 'INVALID') && g === 'UNCERTAIN') {
    return 'should_clarify_but_rejected';
  }
  return null;
}

const LABEL_TO_KEY: Record<BettrV1Category, CategoryKey> = {
  'Appearance & Self-Care': 'appearance',
  'Fashion & Style': 'fashion',
  Academics: 'academics',
  Career: 'career',
  Finance: 'finance',
  'Nutrition & Cooking': 'nutrition',
  Social: 'social',
  'Physical Prowess': 'physical',
  'Mind & Craft': 'mind',
  'Inner Wellbeing': 'inner',
  Spirituality: 'spirituality',
};

async function scoreText(text: string, extra: Partial<Scored> = {}): Promise<Scored> {
  const deterministicInvalid = isDeterministicInvalid(text);
  const structuralFirstPass = needsFirstPassClarification(text, '');
  const gate = await evaluateComposerSubmission({ activity: text, details: '' });
  let pAction: number | null = gate.pAction ?? null;
  let actionBand: string | null = null;
  if (!deterministicInvalid && !structuralFirstPass) {
    const action = await evaluateActionEvidence(text);
    pAction = action.pAction;
    actionBand = action.band;
  }
  let isolatedPDev: number | null = gate.pDev;
  if (isolatedPDev == null && !deterministicInvalid) {
    const z = await embedText(text);
    isolatedPDev = predictProbability({ weights: probe.weights, bias: probe.bias }, z);
  }
  return {
    id: extra.id || '',
    text,
    gold: extra.gold,
    familyId: extra.familyId,
    domain: extra.domain,
    taxonomy: extra.taxonomy,
    pDev: isolatedPDev == null ? null : round(isolatedPDev),
    pAction: pAction == null ? null : round(pAction),
    status3a: isolatedPDev == null ? null : mapProbabilityToStatus(isolatedPDev),
    actionBand,
    structuralFirstPass,
    deterministicInvalid,
    twoAxisStatus: gate.status,
    twoAxisReason: gate.reason || gate.status,
  };
}

function summarizeSet(rows: Scored[]) {
  const withGold = rows.filter((r) => r.gold);
  const tp = withGold.filter(
    (r) => mapGoldDevToWanted(r.gold!) === 'DEVELOPMENTAL' && r.twoAxisStatus === 'DEVELOPMENTAL'
  ).length;
  const tn = withGold.filter(
    (r) =>
      mapGoldDevToWanted(r.gold!) === 'NON_DEVELOPMENTAL' &&
      (r.twoAxisStatus === 'NON_DEVELOPMENTAL' || r.twoAxisStatus === 'INVALID')
  ).length;
  const fp = withGold.filter(
    (r) => mapGoldDevToWanted(r.gold!) === 'NON_DEVELOPMENTAL' && r.twoAxisStatus === 'DEVELOPMENTAL'
  ).length;
  const fn = withGold.filter(
    (r) =>
      mapGoldDevToWanted(r.gold!) === 'DEVELOPMENTAL' &&
      (r.twoAxisStatus === 'NON_DEVELOPMENTAL' || r.twoAxisStatus === 'INVALID')
  ).length;
  const clar = withGold.filter((r) => r.twoAxisStatus === 'UNCERTAIN').length;
  const n = withGold.length || 1;
  const prec = tp + fp ? tp / (tp + fp) : null;
  const rec = tp + fn ? tp / (tp + fn) : null;
  const f1 = prec != null && rec != null && prec + rec ? (2 * prec * rec) / (prec + rec) : null;
  const acc = (tp + tn) / (tp + tn + fp + fn || 1);
  const clarErr = withGold
    .map((r) => ({
      id: r.id,
      text: r.text,
      gold: r.gold,
      pred: r.twoAxisStatus,
      kind: classifyClarification(r.gold!, r.twoAxisStatus),
      pDev: r.pDev,
      pAction: r.pAction,
      reason: r.twoAxisReason,
    }))
    .filter((r) => r.kind);
  return {
    n: withGold.length,
    tp,
    tn,
    fp,
    fn,
    clarification: clar,
    clarificationRate: round(clar / n),
    accuracyIgnoringClarification: round(acc),
    precision: prec == null ? null : round(prec),
    recall: rec == null ? null : round(rec),
    f1: f1 == null ? null : round(f1),
    exactMatchIncludingUncertain: round(
      withGold.filter((r) => {
        const wanted = mapGoldDevToWanted(r.gold!);
        if (wanted === 'NON_DEVELOPMENTAL') {
          return r.twoAxisStatus === 'NON_DEVELOPMENTAL' || r.twoAxisStatus === 'INVALID';
        }
        return r.twoAxisStatus === wanted;
      }).length / n
    ),
    clarificationErrorCounts: {
      should_accept_but_clarified: clarErr.filter((x) => x.kind === 'should_accept_but_clarified').length,
      should_reject_but_clarified: clarErr.filter((x) => x.kind === 'should_reject_but_clarified').length,
      should_clarify_but_accepted: clarErr.filter((x) => x.kind === 'should_clarify_but_accepted').length,
      should_clarify_but_rejected: clarErr.filter((x) => x.kind === 'should_clarify_but_rejected').length,
    },
  };
}

function simulateThresholds(rows: { y: number; p: number }[]) {
  const cuts = [
    { lo: 0.4, hi: 0.6 },
    { lo: 0.45, hi: 0.55 },
    { lo: 0.48, hi: 0.52 },
    { lo: 0.5, hi: 0.5 },
    { lo: 0.42, hi: 0.58 },
    { lo: 0.35, hi: 0.65 },
  ];
  return cuts.map((cut) => {
    let tp = 0;
    let tn = 0;
    let fp = 0;
    let fn = 0;
    let mid = 0;
    for (const r of rows) {
      if (r.p > cut.lo && r.p < cut.hi) {
        mid += 1;
        continue;
      }
      const pred = r.p >= cut.hi ? 1 : 0;
      if (pred === 1 && r.y === 1) tp += 1;
      else if (pred === 0 && r.y === 0) tn += 1;
      else if (pred === 1 && r.y === 0) fp += 1;
      else fn += 1;
    }
    const prec = tp + fp ? tp / (tp + fp) : 0;
    const rec = tp + fn ? tp / (tp + fn) : 0;
    return {
      ...cut,
      tp,
      tn,
      fp,
      fn,
      mid,
      precision: round(prec),
      recall: round(rec),
      f1: prec + rec ? round((2 * prec * rec) / (prec + rec)) : 0,
      fpCostNote: 'FP more costly than FN for credit',
    };
  });
}

async function main() {
  if (probe.evaluator !== 'candidate-developmental-3a.2') {
    throw new Error(`Refusing ${probe.evaluator}`);
  }
  await loadMiniLm();

  const dev = loadJsonl<DevelopmentalExample>(
    'benchmarks/semantic/datasets/developmental-v1/developmental-v1.jsonl'
  );
  const ae = loadJsonl<ActionEvidenceExample>(
    'benchmarks/semantic/datasets/action-evidence-v2/action-evidence-v2.jsonl'
  );
  const val = dev.filter(
    (r) =>
      r.split === 'val' &&
      r.role === 'core_trainable' &&
      (r.label === 'DEVELOPMENTAL' || r.label === 'NON_DEVELOPMENTAL')
  );
  const auxUncertain = dev.filter((r) => r.role === 'uncertain_auxiliary');
  const stressAux = dev.filter((r) => r.role === 'stress_auxiliary');
  const train = dev.filter(
    (r) =>
      r.split === 'train' &&
      r.role === 'core_trainable' &&
      (r.label === 'DEVELOPMENTAL' || r.label === 'NON_DEVELOPMENTAL')
  );
  const aeVal = ae.filter(
    (r) =>
      r.split === 'val' &&
      (r.label === 'ACTION_POSITIVE' || r.label === 'ACTION_NEGATIVE')
  );

  const valScored: Scored[] = [];
  for (const row of val) {
    valScored.push(
      await scoreText(row.text, {
        id: row.id,
        gold: row.label,
        familyId: row.familyId,
        domain: row.domain,
      })
    );
  }
  const auxScored: Scored[] = [];
  for (const row of auxUncertain) {
    auxScored.push(
      await scoreText(row.text, {
        id: row.id,
        gold: row.label,
        familyId: row.familyId,
        domain: row.domain,
      })
    );
  }
  const stressAuxScored: Scored[] = [];
  for (const row of stressAux) {
    stressAuxScored.push(
      await scoreText(row.text, {
        id: row.id,
        gold: row.label === 'DEVELOPMENTAL' ? 'DEVELOPMENTAL' : 'NON_DEVELOPMENTAL',
        familyId: row.familyId,
        domain: row.domain,
        taxonomy: 'J_STRESS_AUX',
      })
    );
  }

  const v1Scored: Scored[] = [];
  for (const row of SEMANTIC_BENCHMARK_V1) {
    const gold = isDevelopmental(row.expectedOutcome)
      ? 'DEVELOPMENTAL'
      : row.expectedOutcome === 'NEEDS_CLARIFICATION'
        ? 'UNCERTAIN'
        : 'NON_DEVELOPMENTAL';
    v1Scored.push(
      await scoreText(row.text, {
        id: row.id,
        gold,
        taxonomy: row.benchmarkFamily,
        domain: row.selectedCategories.join(','),
      })
    );
  }

  const v1Category = [];
  for (const row of SEMANTIC_BENCHMARK_V1) {
    const selected = row.selectedCategories.map((label) => LABEL_TO_KEY[label]);
    const scores = await scoreCategorySimilarities(row.text, embedTexts);
    const mismatch = detectObviousCategoryMismatch(scores, selected);
    const suggestions = rankHybridCategorySuggestions({ scores, selected });
    const expectedSuggest = row.expectedSuggestedCategories.map((label) => LABEL_TO_KEY[label]);
    const expectedMismatch = row.expectedOutcome === 'VALID_WITH_SUGGESTION' && expectedSuggest.length > 0;
    v1Category.push({
      id: row.id,
      family: row.benchmarkFamily,
      expectedOutcome: row.expectedOutcome,
      selected: row.selectedCategories,
      expectedSuggested: row.expectedSuggestedCategories,
      suggestedKeys: suggestions,
      mismatch: mismatch.mismatch,
      mismatchAlt: mismatch.mismatch ? mismatch.alternativeKey : null,
      missedExpectedSuggestion:
        expectedSuggest.length > 0 && !expectedSuggest.every((k) => suggestions.includes(k)),
      unexpectedSuggestion:
        expectedSuggest.length === 0 && suggestions.length > 0 && row.expectedOutcome !== 'VALID_WITH_SUGGESTION',
      missedMismatch: expectedMismatch && row.benchmarkFamily === 'E_CATEGORY_MISMATCH' && !mismatch.mismatch,
    });
  }

  const stressScored: Scored[] = [];
  for (const row of STRESS) {
    const scored = await scoreText(row.text, {
      id: row.id,
      gold: row.expectedGate === 'INVALID' ? 'NON_DEVELOPMENTAL' : row.expectedGate,
      taxonomy: row.taxonomy,
      domain: row.category,
    });
    if (row.expectedGate === 'INVALID') {
      scored.gold = 'NON_DEVELOPMENTAL';
    }
    stressScored.push(scored);
  }

  const aeValRows = [];
  for (const row of aeVal) {
    const action = await evaluateActionEvidence(row.text);
    aeValRows.push({
      id: row.id,
      text: row.text,
      gold: row.label,
      pAction: round(action.pAction),
      band: action.band,
    });
  }

  const pDevVal = valScored.filter((r) => r.pDev != null) as (Scored & { pDev: number })[];
  const yP = pDevVal.map((r) => ({
    y: r.gold === 'DEVELOPMENTAL' ? 1 : 0,
    p: r.pDev,
  }));
  const pDevAllKnown = valScored
    .filter((r) => r.pDev != null)
    .map((r) => r.pDev as number);

  const validPs = pDevVal.filter((r) => r.gold === 'DEVELOPMENTAL').map((r) => r.pDev);
  const invalidPs = pDevVal.filter((r) => r.gold === 'NON_DEVELOPMENTAL').map((r) => r.pDev);

  const fpRows = valScored.filter(
    (r) => r.gold === 'NON_DEVELOPMENTAL' && r.twoAxisStatus === 'DEVELOPMENTAL'
  );
  const fnRows = valScored.filter(
    (r) =>
      r.gold === 'DEVELOPMENTAL' &&
      (r.twoAxisStatus === 'NON_DEVELOPMENTAL' || r.twoAxisStatus === 'INVALID')
  );

  const neighborPairs = [
    ['Studied calculus', "I didn't study"],
    ['Went to the gym and did my push workout', "didn't go to the gym"],
    ['Submitted two internship applications', 'I will apply tomorrow'],
    ['Meditated for 15 minutes', 'felt better today'],
    ['Watched 6 ochem videos', 'Watched Netflix for 3 hours'],
    ['Practiced guitar for 30 minutes', 'studied'],
  ];
  const neighborSims = [];
  for (const [a, b] of neighborPairs) {
    const ea = await embedText(a);
    const eb = await embedText(b);
    neighborSims.push({ a, b, cosine: cosine(ea, eb) });
  }

  const trainPDev: { y: number; p: number }[] = [];
  for (const row of train.slice(0, 80)) {
    if (isDeterministicInvalid(row.text)) continue;
    const z = await embedText(row.text);
    const p = predictProbability({ weights: probe.weights, bias: probe.bias }, z);
    trainPDev.push({ y: row.label === 'DEVELOPMENTAL' ? 1 : 0, p });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    productionUnchanged: true,
    identity: {
      developmental: probe.evaluator,
      embedding: probe.modelId,
      embeddingDim: probe.embeddingDim,
      trainCount: probe.trainCount,
      l2: probe.l2,
      lr: probe.learningRate,
      epochs: probe.epochs,
      productBand: { nonMax: PRODUCT_NON_MAX, devMin: PRODUCT_DEV_MIN },
      actionEvidence: {
        tNeg: ACTION_EVIDENCE_CONFIDENT_NEGATIVE,
        tPos: ACTION_EVIDENCE_CONFIDENT_POSITIVE,
        fingerprint: sha256File('lib/evaluation/semantic/weights/action-evidence-mpnet.json'),
      },
      probe3a2Sha256: sha256File('lib/evaluation/semantic/weights/developmental-3a.2.json'),
    },
    datasets: {
      developmentalV1: {
        n: dev.length,
        train: train.length,
        val: val.length,
        auxUncertain: auxUncertain.length,
        stressAux: stressAux.length,
        labels: {
          DEVELOPMENTAL: dev.filter((r) => r.label === 'DEVELOPMENTAL').length,
          NON_DEVELOPMENTAL: dev.filter((r) => r.label === 'NON_DEVELOPMENTAL').length,
          UNCERTAIN: dev.filter((r) => r.label === 'UNCERTAIN').length,
        },
        splits: {
          train: dev.filter((r) => r.split === 'train').length,
          val: dev.filter((r) => r.split === 'val').length,
          aux: dev.filter((r) => r.split === 'aux').length,
        },
      },
      actionEvidenceV2: {
        n: ae.length,
        valBinary: aeVal.length,
        labels: {
          ACTION_POSITIVE: ae.filter((r) => r.label === 'ACTION_POSITIVE').length,
          ACTION_NEGATIVE: ae.filter((r) => r.label === 'ACTION_NEGATIVE').length,
          AMBIGUOUS: ae.filter((r) => r.label === 'AMBIGUOUS').length,
        },
        splits: {
          train: ae.filter((r) => r.split === 'train').length,
          val: ae.filter((r) => r.split === 'val').length,
          aux: ae.filter((r) => r.split === 'aux').length,
          exam: ae.filter((r) => r.split === 'exam').length,
        },
      },
      semanticBenchmarkV1: SEMANTIC_BENCHMARK_V1.length,
      stressDiagnostic: STRESS.length,
    },
    valTwoAxis: summarizeSet(valScored),
    val3aIsolated: {
      n: pDevVal.length,
      note: 'Isolated MiniLM+3A.2 pDev even when production skipped 3A.2 due to AE/structural.',
      productExact: round(
        pDevVal.filter((r) => r.status3a === mapGoldDevToWanted(r.gold || '')).length /
          (pDevVal.length || 1)
      ),
      calibration: {
        validMeanP: mean(validPs),
        invalidMeanP: mean(invalidPs),
        validMedian: quantile(validPs, 0.5),
        invalidMedian: quantile(invalidPs, 0.5),
        brier: brier(yP),
        bands: bands(pDevAllKnown),
      },
    },
    thresholdSimulationOnValPDev: simulateThresholds(yP),
    auxUncertainTwoAxis: summarizeSet(auxScored),
    stressAuxTwoAxis: summarizeSet(stressAuxScored),
    v1TwoAxis: summarizeSet(v1Scored),
    v1Category: {
      n: v1Category.length,
      mismatchDetected: v1Category.filter((r) => r.mismatch).length,
      missedMismatchFamilyE: v1Category.filter((r) => r.missedMismatch).length,
      missedExpectedSuggestions: v1Category.filter((r) => r.missedExpectedSuggestion).length,
      rows: v1Category.filter(
        (r) => r.missedMismatch || r.missedExpectedSuggestion || r.mismatch
      ),
    },
    stressDiagnosticTwoAxis: summarizeSet(stressScored),
    actionEvidenceVal: {
      n: aeValRows.length,
      goldPos_confidentPos: aeValRows.filter(
        (r) => r.gold === 'ACTION_POSITIVE' && r.band === 'CONFIDENT_ACTION_POSITIVE'
      ).length,
      goldPos_uncertain: aeValRows.filter(
        (r) => r.gold === 'ACTION_POSITIVE' && r.band === 'ACTION_UNCERTAIN'
      ).length,
      goldPos_confidentNeg: aeValRows.filter(
        (r) => r.gold === 'ACTION_POSITIVE' && r.band === 'CONFIDENT_ACTION_NEGATIVE'
      ).length,
      goldNeg_confidentPos: aeValRows.filter(
        (r) => r.gold === 'ACTION_NEGATIVE' && r.band === 'CONFIDENT_ACTION_POSITIVE'
      ).length,
      goldNeg_uncertain: aeValRows.filter(
        (r) => r.gold === 'ACTION_NEGATIVE' && r.band === 'ACTION_UNCERTAIN'
      ).length,
      goldNeg_confidentNeg: aeValRows.filter(
        (r) => r.gold === 'ACTION_NEGATIVE' && r.band === 'CONFIDENT_ACTION_NEGATIVE'
      ).length,
    },
    representativeFP: fpRows.slice(0, 12),
    representativeFN: fnRows.slice(0, 12),
    v1Mismatches: v1Scored
      .filter((r) => r.gold && r.twoAxisStatus !== mapGoldDevToWanted(r.gold))
      .map((r) => ({
        id: r.id,
        text: r.text,
        gold: r.gold,
        pred: r.twoAxisStatus,
        reason: r.twoAxisReason,
        pDev: r.pDev,
        pAction: r.pAction,
        taxonomy: r.taxonomy,
      })),
    stressMismatches: stressScored
      .filter((r) => {
        const wanted = STRESS.find((s) => s.id === r.id)?.expectedGate;
        if (!wanted) return false;
        if (wanted === 'INVALID') return r.twoAxisStatus !== 'INVALID';
        return r.twoAxisStatus !== wanted;
      })
      .map((r) => ({
        id: r.id,
        text: r.text,
        expected: STRESS.find((s) => s.id === r.id)?.expectedGate,
        pred: r.twoAxisStatus,
        reason: r.twoAxisReason,
        pDev: r.pDev,
        pAction: r.pAction,
        taxonomy: r.taxonomy,
      })),
    neighborCosines: neighborSims,
    trainFrozenPDevSample80: {
      n: trainPDev.length,
      brier: brier(trainPDev),
      meanPDev: mean(trainPDev.filter((r) => r.y === 1).map((r) => r.p)),
      meanPNon: mean(trainPDev.filter((r) => r.y === 0).map((r) => r.p)),
    },
    rows: {
      val: valScored,
      v1: v1Scored,
      stress: stressScored,
      aeVal: aeValRows,
    },
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'full.json'), JSON.stringify(report, null, 2));
  const { rows: _omit, ...summary } = report;
  writeFileSync(join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(
    JSON.stringify(
      {
        ok: true,
        out: OUT_DIR,
        valTwoAxis: report.valTwoAxis,
        v1TwoAxis: report.v1TwoAxis,
        stress: report.stressDiagnosticTwoAxis,
        aeVal: report.actionEvidenceVal,
        v1MismatchCount: report.v1Mismatches.length,
        stressMismatchCount: report.stressMismatches.length,
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
