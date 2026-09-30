/**
 * Stage 5 action-state / NLI arena.
 *
 * One model per process:
 *   node .../run-phase1-stage5-experiments.js audit-dataset
 *   node .../run-phase1-stage5-experiments.js mobilebert
 *   node .../run-phase1-stage5-experiments.js distilbert
 *   node .../run-phase1-stage5-experiments.js summarize
 *
 * Does not load production encoders and does not download models.
 */
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildStage5Examples, SANITY_PAIRS, type NliGold, type Stage5Example } from './stage5/examples';
import { loadNli, scorePair, unloadNli } from './stage5/nli';
import { argmaxLabel, decideAt, decidePrimary, type Decision, type Probs } from './stage5/policy';

const OUT = join(process.cwd(), 'benchmarks/semantic/results/phase1-stage5-experiments');
const PROD_3A = join(process.cwd(), 'lib/evaluation/semantic/weights/developmental-3a.2.json');
const PROD_AE = join(process.cwd(), 'lib/evaluation/semantic/weights/action-evidence-mpnet.json');
const PROD_3A_TS = join(process.cwd(), 'lib/evaluation/semantic/candidateDevelopmental.ts');
const PROD_AE_TS = join(process.cwd(), 'lib/evaluation/actionEvidence.ts');
const RSS_ABORT_MB = 2200;

const MODELS = {
  mobilebert: {
    id: 'mobilebert',
    runtimeModelId: 'Xenova/mobilebert-uncased-mnli',
    approxParamsM: 25,
    approxQuantizedMb: 26,
    why: 'Smallest MNLI cross-encoder already cached. Run first.',
  },
  distilbert: {
    id: 'distilbert',
    runtimeModelId: 'Xenova/distilbert-base-uncased-mnli',
    approxParamsM: 67,
    approxQuantizedMb: 65,
    why: 'Strongest small MNLI model already cached. Fresh process after mobilebert.',
  },
} as const;

type ModelId = keyof typeof MODELS;

type Scored = Stage5Example & {
  probs: Probs;
  argmax: NliGold;
  decision: Decision;
  ms: number;
};

function sha256File(path: string) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function productionHashes() {
  return {
    threeAFile: sha256File(PROD_3A),
    aeFile: sha256File(PROD_AE),
    candidateDevelopmentalTs: sha256File(PROD_3A_TS),
    actionEvidenceTs: sha256File(PROD_AE_TS),
  };
}

function rssMb() {
  return Math.round(process.memoryUsage().rss / (1024 * 1024));
}

function round(n: number, digits = 4) {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

function roundProbs(p: Probs): Probs {
  return {
    entails: round(p.entails),
    neutral: round(p.neutral),
    contradicts: round(p.contradicts),
  };
}

function quantile(sorted: number[], q: number) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx];
}

function countBy<T>(rows: T[], key: (row: T) => string) {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const k = key(row);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function datasetAudit() {
  const examples = buildStage5Examples();
  return {
    n: examples.length,
    byGroup: countBy(examples, (r) => r.group),
    byGold: countBy(examples, (r) => r.gold),
    bySlice: countBy(examples, (r) => r.slice),
    bySource: countBy(examples, (r) => r.source),
    state56: examples.filter((r) => r.group === 'state56').length,
    unsafeIfSupports: examples.filter((r) => r.unsafeIfSupports).length,
    productCaution: countBy(
      examples.filter((r) => r.productCaution),
      (r) => r.productCaution as string
    ),
  };
}

function scoreMetrics(rows: Scored[], entailMin = 0.5) {
  const decided = rows.map((row) => ({
    ...row,
    decision: entailMin === 0.5 ? row.decision : decideAt(row.probs, entailMin),
  }));
  const n = decided.length;
  let argmaxCorrect = 0;
  let supports = 0;
  let supportsGoldEntails = 0;
  let goldEntails = 0;
  let entailsSupported = 0;
  let falseSupports = 0;
  let unsafeSupports = 0;
  let unsafeN = 0;
  let hardRejectEntails = 0;
  let abstainEntails = 0;
  const confusion: Record<string, number> = {};
  const sumP: Record<NliGold, Probs> = {
    entails: { entails: 0, neutral: 0, contradicts: 0 },
    neutral: { entails: 0, neutral: 0, contradicts: 0 },
    contradicts: { entails: 0, neutral: 0, contradicts: 0 },
  };
  const goldN: Record<NliGold, number> = { entails: 0, neutral: 0, contradicts: 0 };

  for (const row of decided) {
    if (row.argmax === row.gold) argmaxCorrect += 1;
    confusion[`${row.gold}->${row.argmax}`] = (confusion[`${row.gold}->${row.argmax}`] ?? 0) + 1;
    goldN[row.gold] += 1;
    sumP[row.gold].entails += row.probs.entails;
    sumP[row.gold].neutral += row.probs.neutral;
    sumP[row.gold].contradicts += row.probs.contradicts;
    if (row.unsafeIfSupports) unsafeN += 1;
    if (row.decision === 'SUPPORTS') {
      supports += 1;
      if (row.gold === 'entails') supportsGoldEntails += 1;
      else falseSupports += 1;
      if (row.unsafeIfSupports) unsafeSupports += 1;
    }
    if (row.gold === 'entails') {
      goldEntails += 1;
      if (row.decision === 'SUPPORTS') entailsSupported += 1;
      else if (row.decision === 'CONTRADICTS') hardRejectEntails += 1;
      else abstainEntails += 1;
    }
  }

  function meanP(gold: NliGold): Probs | null {
    if (goldN[gold] === 0) return null;
    return {
      entails: round(sumP[gold].entails / goldN[gold]),
      neutral: round(sumP[gold].neutral / goldN[gold]),
      contradicts: round(sumP[gold].contradicts / goldN[gold]),
    };
  }

  return {
    n,
    entailMin,
    argmaxAccuracy: n ? round(argmaxCorrect / n) : null,
    supports,
    falseSupports,
    unsafeSupports,
    unsafeN,
    falseSupportRate: supports ? round(falseSupports / supports) : null,
    unsafeSupportRateOnUnsafe: unsafeN ? round(unsafeSupports / unsafeN) : null,
    supportPrecision: supports ? round(supportsGoldEntails / supports) : null,
    supportRecall: goldEntails ? round(entailsSupported / goldEntails) : null,
    hardRejectEntails,
    abstainEntails,
    goldEntails,
    confusion,
    meanProbByGold: {
      entails: meanP('entails'),
      neutral: meanP('neutral'),
      contradicts: meanP('contradicts'),
    },
  };
}

function sliceMetrics(rows: Scored[]) {
  const slices = [...new Set(rows.map((r) => r.slice))].sort();
  const out: Record<string, ReturnType<typeof scoreMetrics>> = {};
  for (const slice of slices) out[slice] = scoreMetrics(rows.filter((r) => r.slice === slice));
  return out;
}

function groupMetrics(rows: Scored[]) {
  const groups = [...new Set(rows.map((r) => r.group))].sort();
  const out: Record<string, ReturnType<typeof scoreMetrics>> = {};
  for (const group of groups) out[group] = scoreMetrics(rows.filter((r) => r.group === group));
  return out;
}

function compactRow(row: Scored) {
  return {
    id: row.id,
    group: row.group,
    slice: row.slice,
    source: row.source,
    text: row.text,
    target: row.target,
    gold: row.gold,
    argmax: row.argmax,
    decision: row.decision,
    probs: row.probs,
    unsafeIfSupports: row.unsafeIfSupports,
    productCaution: row.productCaution ?? null,
    ms: row.ms,
  };
}

function pick(rows: Scored[], pred: (row: Scored) => boolean, limit = 12) {
  return rows.filter(pred).slice(0, limit).map(compactRow);
}

async function runModel(modelKey: ModelId) {
  const spec = MODELS[modelKey];
  const examples = buildStage5Examples();
  mkdirSync(OUT, { recursive: true });
  const hashesBefore = productionHashes();
  console.log(`stage5 ${spec.id} examples=${examples.length} rss=${rssMb()}MB cache-only`);
  const loaded = await loadNli(spec.runtimeModelId);
  const rssAfterLoad = rssMb();
  console.log(`loaded ${spec.runtimeModelId} in ${loaded.coldLoadMs}ms rss=${rssAfterLoad}MB`);
  if (rssAfterLoad > RSS_ABORT_MB) {
    await unloadNli();
    throw new Error(`Aborting ${spec.id}: RSS ${rssAfterLoad}MB after load exceeds ${RSS_ABORT_MB}MB`);
  }

  const sanity = [];
  for (const pair of SANITY_PAIRS) {
    const probs = roundProbs(await scorePair(pair.text, pair.hypothesis));
    sanity.push({ ...pair, probs, argmax: argmaxLabel(probs) });
  }
  const entailOk = sanity.find((row) => row.id === 'SANITY-ENTAIL')?.argmax === 'entails';
  const contraOk = sanity.find((row) => row.id === 'SANITY-CONTRADICT')?.argmax === 'contradicts';
  const neutralOk = sanity.find((row) => row.id === 'SANITY-NEUTRAL')?.argmax === 'neutral';
  const labelOrderSuspect = !entailOk || !contraOk;
  const neutralCollapsed = !neutralOk;

  const warmTexts = SANITY_PAIRS[0];
  const warm: number[] = [];
  for (let i = 0; i < 8; i++) {
    const t0 = Date.now();
    await scorePair(warmTexts.text, warmTexts.hypothesis);
    warm.push(Date.now() - t0);
  }

  const scored: Scored[] = [];
  let aborted = false;
  const tEval0 = Date.now();
  for (const example of examples) {
    if (rssMb() > RSS_ABORT_MB) {
      aborted = true;
      console.log(`abort ${spec.id} at n=${scored.length} rss=${rssMb()}MB`);
      break;
    }
    const t0 = Date.now();
    const probs = roundProbs(await scorePair(example.text, example.hypothesis));
    const ms = Date.now() - t0;
    scored.push({
      ...example,
      probs,
      argmax: argmaxLabel(probs),
      decision: decidePrimary(probs),
      ms,
    });
    if (scored.length % 25 === 0) {
      console.log(`  ${spec.id} ${scored.length}/${examples.length} rss=${rssMb()}MB`);
      writeFileSync(join(OUT, `${spec.id}.partial.json`), JSON.stringify({ n: scored.length, rssMb: rssMb() }));
    }
  }
  const evalMs = Date.now() - tEval0;
  const times = scored.map((r) => r.ms).sort((a, b) => a - b);
  const warmSorted = [...warm].sort((a, b) => a - b);

  const result = {
    model: spec,
    load: { ...loaded, rssAfterLoadMb: rssAfterLoad },
    labelOrderSuspect,
    neutralCollapsed,
    sanity,
    aborted,
    scoredN: scored.length,
    expectedN: examples.length,
    timing: {
      evalMs,
      meanMs: times.length ? round(times.reduce((a, b) => a + b, 0) / times.length, 2) : null,
      p50Ms: quantile(times, 0.5),
      p95Ms: quantile(times, 0.95),
      warmMs: warm,
      warmP50Ms: quantile(warmSorted, 0.5),
      rssEndMb: rssMb(),
    },
    metrics: scoreMetrics(scored),
    thresholdDiagnostic: {
      note: 'Computed from saved probabilities. 0.50 is the pre-registered policy. 0.40 and 0.70 were not used to pick a model.',
      t40: scoreMetrics(scored, 0.4),
      t50: scoreMetrics(scored, 0.5),
      t70: scoreMetrics(scored, 0.7),
    },
    byGroup: groupMetrics(scored),
    bySlice: sliceMetrics(scored),
    falseSupports: pick(scored, (r) => r.decision === 'SUPPORTS' && r.gold !== 'entails', 40),
    unsafeSupports: pick(scored, (r) => r.decision === 'SUPPORTS' && r.unsafeIfSupports, 40),
    missedEntails: pick(scored, (r) => r.gold === 'entails' && r.decision !== 'SUPPORTS', 40),
    hardRejects: pick(scored, (r) => r.gold === 'entails' && r.decision === 'CONTRADICTS', 20),
    rows: scored.map(compactRow),
    productionHashesBefore: hashesBefore,
    productionHashesAfter: productionHashes(),
  };
  result.productionHashesAfter = productionHashes();
  writeFileSync(join(OUT, `${spec.id}.json`), JSON.stringify(result));
  const partial = join(OUT, `${spec.id}.partial.json`);
  if (existsSync(partial)) writeFileSync(partial, JSON.stringify({ done: true, n: scored.length }));
  await unloadNli();
  console.log(
    `wrote ${spec.id}.json argmax=${result.metrics.argmaxAccuracy} falseSupports=${result.metrics.falseSupports} supportRecall=${result.metrics.supportRecall} rss=${rssMb()}MB suspect=${labelOrderSuspect}`
  );
  if (aborted) process.exitCode = 2;
}

function readModel(id: string) {
  const path = join(OUT, `${id}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as {
    model: { id: string; runtimeModelId: string; approxParamsM: number; approxQuantizedMb: number };
    labelOrderSuspect: boolean;
    aborted: boolean;
    scoredN: number;
    expectedN: number;
    timing: { meanMs: number; p50Ms: number; p95Ms: number; warmP50Ms: number; rssEndMb: number; evalMs: number };
    load: { coldLoadMs: number; rssAfterLoadMb: number; quantized: boolean; id2label: Record<string, string> };
    metrics: ReturnType<typeof scoreMetrics>;
    thresholdDiagnostic: { t40: ReturnType<typeof scoreMetrics>; t50: ReturnType<typeof scoreMetrics>; t70: ReturnType<typeof scoreMetrics> };
    byGroup: Record<string, ReturnType<typeof scoreMetrics>>;
    bySlice: Record<string, ReturnType<typeof scoreMetrics>>;
    falseSupports: ReturnType<typeof compactRow>[];
    unsafeSupports: ReturnType<typeof compactRow>[];
    missedEntails: ReturnType<typeof compactRow>[];
    hardRejects: ReturnType<typeof compactRow>[];
    sanity: Array<{ id: string; gold: NliGold; argmax: NliGold; probs: Probs }>;
    productionHashesBefore: ReturnType<typeof productionHashes>;
    productionHashesAfter: ReturnType<typeof productionHashes>;
    rows: Array<{ id: string; group: string; slice: string; text: string; gold: NliGold; decision: Decision; argmax: NliGold; unsafeIfSupports: boolean }>;
  };
}

function summarize() {
  const audit = datasetAudit();
  const stage4 = JSON.parse(
    readFileSync(join(process.cwd(), 'benchmarks/semantic/results/phase1-stage4-experiments/summary.json'), 'utf8')
  ) as {
    table: Array<Record<string, number | string | boolean>>;
    encoders: Record<string, { nliTemplateProbe: { accuracy: number; byGold: { completed: number; negated: number; future: number; almost: number; n: number } } }>;
  };
  const stage2 = JSON.parse(
    readFileSync(join(process.cwd(), 'benchmarks/semantic/results/phase1-stage2-experiments/summary.json'), 'utf8')
  ) as {
    policyTable: { P0: { fc: { creditFP: number; n: number; clarificationRate: number }; sv: { n: number; correctImmediateN: number; rejectFN: number; clarificationRate: number } } };
  };
  const mobile = readModel('mobilebert');
  const distil = readModel('distilbert');
  const hashes = productionHashes();
  const models = [mobile, distil].filter((m) => m !== null);

  function state56View(model: NonNullable<typeof mobile> | null) {
    if (!model) return null;
    const g = model.byGroup.state56;
    return g
      ? {
          n: g.n,
          argmaxAccuracy: g.argmaxAccuracy,
          supportRecall: g.supportRecall,
          falseSupports: g.falseSupports,
          supportPrecision: g.supportPrecision,
          hardRejectEntails: g.hardRejectEntails,
          abstainEntails: g.abstainEntails,
        }
      : null;
  }

  const summary = {
    stage: 5,
    generatedAt: new Date().toISOString(),
    productionFrozen: models.every(
      (m) =>
        m!.productionHashesBefore.threeAFile === m!.productionHashesAfter.threeAFile &&
        m!.productionHashesBefore.aeFile === m!.productionHashesAfter.aeFile
    ),
    productionHashesNow: hashes,
    stage4HashReference: {
      threeAFile: '69a7d9c8d8e1ec170b263f908c7463137aa8fa3f7272eb82ffc2f91d913db595',
      aeFile: 'ad5fd348f8a99f2514fb461c88cf3c05ff8f36c447f901138541d036c6fde782',
    },
    formulation: {
      premise: 'user log text',
      hypothesisTemplate: 'The person already {target}.',
      labels: ['entails', 'neutral', 'contradicts'],
      labelMeaning: {
        entails: 'The log says the target action already happened, including paraphrase, noise, ongoing work, and double negation that affirms it.',
        contradicts: 'The log denies the target, including explicit negation, quitting, and internal contradiction.',
        neutral: 'Future, desire, vague, passive, purchase-instead-of-practice, lexical overlap, junk, or a different action. Not a logical denial.',
      },
      decisionPolicy: {
        name: 'supports_only_if_entailment_majority',
        supports: 'P(entails) >= 0.50 and strictly greater than neutral and contradiction',
        contradicts: 'P(contradicts) >= 0.50 and greater than entailment and at least neutral',
        else: 'INSUFFICIENT',
        preRegistered: true,
        note: 'Zero-shot pipelines that softmax only entailment vs contradiction were not used. Neutral is kept.',
      },
    },
    dataset: audit,
    models: Object.fromEntries(
      models.map((m) => [
        m!.model.id,
        {
          runtimeModelId: m!.model.runtimeModelId,
          approxParamsM: m!.model.approxParamsM,
          approxQuantizedMb: m!.model.approxQuantizedMb,
          quantized: m!.load.quantized,
          id2label: m!.load.id2label,
          labelOrderSuspect:
            m!.sanity.find((row) => row.id === 'SANITY-ENTAIL')?.argmax !== 'entails' ||
            m!.sanity.find((row) => row.id === 'SANITY-CONTRADICT')?.argmax !== 'contradicts',
          neutralCollapsed: m!.sanity.find((row) => row.id === 'SANITY-NEUTRAL')?.argmax !== 'neutral',
          sanity: m!.sanity,
          aborted: m!.aborted,
          scoredN: m!.scoredN,
          expectedN: m!.expectedN,
          timing: m!.timing,
          load: { coldLoadMs: m!.load.coldLoadMs, rssAfterLoadMb: m!.load.rssAfterLoadMb },
          metrics: m!.metrics,
          thresholdDiagnostic: m!.thresholdDiagnostic,
          byGroup: m!.byGroup,
          bySlice: Object.fromEntries(
            Object.entries(m!.bySlice).map(([k, v]) => [
              k,
              {
                n: v.n,
                argmaxAccuracy: v.argmaxAccuracy,
                falseSupports: v.falseSupports,
                unsafeSupports: v.unsafeSupports,
                supportRecall: v.supportRecall,
                supportPrecision: v.supportPrecision,
                hardRejectEntails: v.hardRejectEntails,
              },
            ])
          ),
          falseSupports: m!.falseSupports,
          unsafeSupports: m!.unsafeSupports,
          missedEntails: m!.missedEntails,
          hardRejects: m!.hardRejects,
        },
      ])
    ),
    comparison: {
      stage4NliTemplateProbe: Object.fromEntries(
        Object.entries(stage4.encoders).map(([id, enc]) => [id, enc.nliTemplateProbe])
      ),
      stage4CompletedRecallNote:
        'Stage 4 byGold.completed is correct argmax hits out of 14 completed items (6 geometry + 8 negation). It is cosine-to-template, not a cross-encoder.',
      stage4Table: stage4.table.map((row) => ({
        encoder: row.encoder,
        stateSepCosineCompletedVsNeg: row.stateSepCosineCompletedVsNeg,
        probeMeanDpDevNeg: row.probeMeanDpDevNeg,
        archA_val_ASK: row.archA_val_ASK,
        archA_fc_FP: row.archA_fc_FP,
        archA_svImmediate: row.archA_svImmediate,
        archA_negCreditFails: row.archA_negCreditFails,
        warmMsPerEmbedMacNode: row.warmMsPerEmbedMacNode,
      })),
      stage2P0: {
        falseCredit: stage2.policyTable.P0.fc,
        shortValid: stage2.policyTable.P0.sv,
      },
      stage5State56: {
        mobilebert: state56View(mobile),
        distilbert: state56View(distil),
      },
    },
    files: {
      arena: [
        'benchmarks/semantic/stage5/examples.ts',
        'benchmarks/semantic/stage5/policy.ts',
        'benchmarks/semantic/stage5/nli.ts',
        'benchmarks/semantic/run-phase1-stage5-experiments.ts',
      ],
      results: [
        'benchmarks/semantic/results/phase1-stage5-experiments/mobilebert.json',
        'benchmarks/semantic/results/phase1-stage5-experiments/distilbert.json',
        'benchmarks/semantic/results/phase1-stage5-experiments/summary.json',
      ],
    },
  };

  writeFileSync(join(OUT, 'computed-metrics.json'), JSON.stringify(summary, null, 2));
  console.log(`wrote computed-metrics.json models=${models.map((m) => m!.model.id).join(',') || 'none'}`);
}

async function main() {
  const cmd = process.argv[2];
  mkdirSync(OUT, { recursive: true });
  if (cmd === 'audit-dataset') {
    const audit = datasetAudit();
    writeFileSync(join(OUT, 'dataset-audit.json'), JSON.stringify({ audit, productionHashes: productionHashes() }, null, 2));
    console.log(JSON.stringify(audit, null, 2));
    return;
  }
  if (cmd === 'mobilebert' || cmd === 'distilbert') {
    await runModel(cmd);
    return;
  }
  if (cmd === 'summarize') {
    summarize();
    return;
  }
  console.error('Usage: audit-dataset | mobilebert | distilbert | summarize');
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
