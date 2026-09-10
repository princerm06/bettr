import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
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

const TAG = process.argv[2] ?? '3a.2';
const DATASET_PATH = join(
  process.cwd(),
  'benchmarks/semantic/datasets/developmental-v1/developmental-v1.jsonl'
);
const WEIGHTS_PATH = join(
  process.cwd(),
  'lib/evaluation/semantic/weights',
  TAG === '3a.1' ? 'developmental-v1.json' : `developmental-${TAG}.json`
);
const RESULTS_PATH = join(
  process.cwd(),
  'benchmarks/semantic/results',
  TAG === '3a.1'
    ? 'developmental-candidate-3a-val.json'
    : `developmental-candidate-${TAG}-val.json`
);
const FIRST_PASS_RESULTS = join(
  process.cwd(),
  'benchmarks/semantic/results/developmental-candidate-3a-val.json'
);

const ORIGINAL_ERROR_IDS = [
  'DV-0005',
  'DV-0033',
  'DV-0098',
  'DV-0185',
  'DV-0186',
  'DV-0187',
  'DV-0217',
  'DV-0282',
  'DV-0283',
  'DV-0284',
  'DV-0285',
  'DV-0288',
  'DV-0323',
  'DV-0387',
] as const;

const TRAIN_CONFIG = {
  seed: 42,
  l2: 0.01,
  learningRate: 0.4,
  epochs: 400,
  binaryThreshold: BINARY_THRESHOLD,
};

const VERBOSITY_PAIRS = [
  {
    id: 'V01',
    label: 'DEVELOPMENTAL',
    short: 'Practiced piano scales.',
    long: 'Spent some time this afternoon practicing piano scales at home before dinner.',
  },
  {
    id: 'V02',
    label: 'NON_DEVELOPMENTAL',
    short: 'Bought a hoodie.',
    long: 'After class I went to the store, looked around for a while, and ended up buying a hoodie that was on sale.',
  },
  {
    id: 'V03',
    label: 'DEVELOPMENTAL',
    short: 'Drilled flashcards.',
    long: 'This evening I sat at my desk and drilled a flashcard deck until I could recall the terms without looking.',
  },
  {
    id: 'V04',
    label: 'NON_DEVELOPMENTAL',
    short: 'Reheated leftovers.',
    long: 'When I got home I pulled yesterday leftover plate from the fridge and reheated it in the microwave.',
  },
  {
    id: 'V05',
    label: 'DEVELOPMENTAL',
    short: 'Soldered a headphone jack.',
    long: 'I sat down at the bench, soldered the broken headphone jack, and then tested both sides to confirm the repair.',
  },
  {
    id: 'V06',
    label: 'NON_DEVELOPMENTAL',
    short: 'Sat in the hot tub.',
    long: 'I went over to the pool building and sat in the hot tub talking while other people were actually practicing.',
  },
  {
    id: 'V07',
    label: 'DEVELOPMENTAL',
    short: 'Asked how they prefer feedback.',
    long: 'Before standup I asked two teammates how they prefer to get feedback and then used that style when I spoke.',
  },
  {
    id: 'V08',
    label: 'NON_DEVELOPMENTAL',
    short: 'Refreshed a job board.',
    long: 'I opened a job board after lunch, refreshed it a few times, skimmed listings, and did not apply to anything.',
  },
  {
    id: 'V09',
    label: 'DEVELOPMENTAL',
    short: 'Did box breathing.',
    long: 'After a hard conversation I sat still and did box breathing for several minutes until I felt more settled.',
  },
  {
    id: 'V10',
    label: 'NON_DEVELOPMENTAL',
    short: 'Found a twenty.',
    long: 'While cleaning out a winter coat I found a twenty in the pocket and put it on the table.',
  },
  {
    id: 'V11',
    label: 'DEVELOPMENTAL',
    short: 'Quoted a client from a rate card.',
    long: 'I built a simple hourly rate card and then used those numbers to send a quote to a new client.',
  },
  {
    id: 'V12',
    label: 'NON_DEVELOPMENTAL',
    short: 'Liked a bunch of posts.',
    long: 'I opened the app on the bus and liked a bunch of friends posts without writing anything back.',
  },
];

const LEXICAL_PROBES = [
  { id: 'L01', text: 'Practiced piano scales', note: 'practice + skill object' },
  { id: 'L02', text: 'Practiced sitting on the couch', note: 'practiced + idle object' },
  { id: 'L03', text: 'Bought a hoodie', note: 'bought + acquisition' },
  { id: 'L04', text: 'Bought time to practice piano scales', note: 'bought used idiomatically; still not the skill' },
  { id: 'L05', text: 'Completed a timed swim set', note: 'completed + training' },
  { id: 'L06', text: 'Completed a load of laundry', note: 'completed + chore' },
  { id: 'L07', text: 'Learned a stir-fry method and cooked it', note: 'learned + cooking skill' },
  { id: 'L08', text: 'Learned that the store was closed', note: 'learned + trivia' },
  { id: 'L09', text: 'Watched other people climb from the benches', note: 'watched + spectating' },
  { id: 'L10', text: 'Watched my own footwork on a climb I was projecting', note: 'watched + training review' },
  { id: 'L11', text: 'Created a rate card and quoted a client', note: 'created + earning system' },
  { id: 'L12', text: 'Created a shopping list', note: 'created + ordinary list' },
  { id: 'L13', text: 'Checked whether a transfer had landed', note: 'checked + status' },
  { id: 'L14', text: 'Checked my knife cuts against even dice then cooked soup', note: 'checked + skill' },
  { id: 'L15', text: 'Scrolled clothing sites for an hour', note: 'scrolled + browse' },
  { id: 'L16', text: 'Scrolled my flashcards until I could recall the pathways', note: 'scrolled used for study' },
];

function dirSizeBytes(dir: string): number {
  try {
    let total = 0;
    const walk = (p: string) => {
      const st = statSync(p);
      if (st.isFile()) total += st.size;
      else if (st.isDirectory()) {
        for (const name of readdirSync(p)) walk(join(p, name));
      }
    };
    walk(dir);
    return total;
  } catch {
    return 0;
  }
}

function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (!sorted.length) return 0;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function loadRows(): DevelopmentalExample[] {
  return readFileSync(DATASET_PATH, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as DevelopmentalExample);
}

function classify(p: number) {
  return p >= TRAIN_CONFIG.binaryThreshold ? 'DEVELOPMENTAL' : 'NON_DEVELOPMENTAL';
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
  const accuracy = (tp + tn) / yTrue.length;
  const recPos = tp / Math.max(1, tp + fn);
  const recNeg = tn / Math.max(1, tn + fp);
  const prec = tp / Math.max(1, tp + fp);
  const rec = recPos;
  const f1 = (2 * prec * rec) / Math.max(1e-12, prec + rec);
  return {
    n: yTrue.length,
    accuracy: Number(accuracy.toFixed(4)),
    balancedAccuracy: Number(((recPos + recNeg) / 2).toFixed(4)),
    precision: Number(prec.toFixed(4)),
    recall: Number(rec.toFixed(4)),
    f1: Number(f1.toFixed(4)),
    confusion: { tp, tn, fp, fn },
    devAccuracy: Number(recPos.toFixed(4)),
    nonDevAccuracy: Number(recNeg.toFixed(4)),
  };
}

async function main() {
  const rows = loadRows();
  const train = rows.filter(
    (r) =>
      r.role === 'core_trainable' &&
      r.split === 'train' &&
      (r.label === 'DEVELOPMENTAL' || r.label === 'NON_DEVELOPMENTAL')
  );
  const val = rows.filter(
    (r) =>
      r.role === 'core_trainable' &&
      r.split === 'val' &&
      (r.label === 'DEVELOPMENTAL' || r.label === 'NON_DEVELOPMENTAL')
  );
  const uncertain = rows.filter((r) => r.role === 'uncertain_auxiliary');
  const stress = rows.filter((r) => r.role === 'stress_auxiliary');

  const t0 = Date.now();
  const loaded = await loadMiniLm();
  const coldLoadMs = Date.now() - t0;
  const t1 = Date.now();
  await loadMiniLm();
  const warmLoadMs = Date.now() - t1;

  const cacheDir = join(process.cwd(), '.cache/transformers/Xenova/all-MiniLM-L6-v2');
  const cacheBytes = dirSizeBytes(cacheDir);

  const embedTimes: number[] = [];
  const embedCache = new Map<string, number[]>();
  async function embedTimed(text: string) {
    const hit = embedCache.get(text);
    if (hit) return hit;
    const start = Date.now();
    const vec = await embedText(text);
    embedTimes.push(Date.now() - start);
    embedCache.set(text, vec);
    return vec;
  }

  const trainStart = Date.now();
  const trainEmbeddings: number[][] = [];
  const trainLabels: number[] = [];
  for (const row of train) {
    trainEmbeddings.push(await embedTimed(row.text));
    trainLabels.push(row.label === 'DEVELOPMENTAL' ? 1 : 0);
  }

  const model = trainBinaryLogistic({
    embeddings: trainEmbeddings,
    labels: trainLabels,
    l2: TRAIN_CONFIG.l2,
    learningRate: TRAIN_CONFIG.learningRate,
    epochs: TRAIN_CONFIG.epochs,
  });
  const trainingMs = Date.now() - trainStart;

  const clfTimes: number[] = [];
  function predictFromVec(vec: number[]) {
    const start = process.hrtime.bigint();
    const p = predictProbability(model, vec);
    clfTimes.push(Number(process.hrtime.bigint() - start) / 1e6);
    return p;
  }

  type Scored = DevelopmentalExample & {
    pDevelopmental: number;
    predicted: string;
    correct: boolean;
  };

  async function scoreRows(list: DevelopmentalExample[]): Promise<Scored[]> {
    const out: Scored[] = [];
    for (const row of list) {
      const vec = await embedTimed(row.text);
      const p = predictFromVec(vec);
      const predicted = classify(p);
      out.push({
        ...row,
        pDevelopmental: p,
        predicted,
        correct: predicted === row.label,
      });
    }
    return out;
  }

  const valScored = await scoreRows(val);
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

  const familyIds = [...new Set(valScored.map((r) => r.familyId))];
  const familyAccuracy = familyIds.map((familyId) => {
    const slice = valScored.filter((r) => r.familyId === familyId);
    const bothSides =
      slice.some((r) => r.label === 'DEVELOPMENTAL') &&
      slice.some((r) => r.label === 'NON_DEVELOPMENTAL');
    const allCorrect = slice.every((r) => r.correct);
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

  const contrastGroups = [...new Set(valScored.map((r) => r.contrastGroup))];
  const contrastAccuracy = contrastGroups.map((contrastGroup) => {
    const slice = valScored.filter((r) => r.contrastGroup === contrastGroup);
    return {
      contrastGroup,
      n: slice.length,
      accuracy: Number((slice.filter((r) => r.correct).length / slice.length).toFixed(4)),
    };
  });

  const nearPairFamilies = familyAccuracy.filter((f) => f.bothSides);
  const bothSidesRate =
    nearPairFamilies.filter((f) => f.bothSidesCorrect).length /
    Math.max(1, nearPairFamilies.length);

  const errors = valScored
    .filter((r) => !r.correct)
    .map((r) => ({
      id: r.id,
      text: r.text,
      expected: r.label,
      predicted: r.predicted,
      pDevelopmental: Number(r.pDevelopmental.toFixed(4)),
      familyId: r.familyId,
      domain: r.domain,
    }));

  const valLens = valScored.map((r) => r.text.length);
  const shortCut = percentile(valLens, 33);
  const longCut = percentile(valLens, 67);
  function bucket(len: number) {
    if (len <= shortCut) return 'short';
    if (len >= longCut) return 'long';
    return 'medium';
  }
  const lengthBuckets: Record<string, ReturnType<typeof metrics> & { maxLen?: number; minLen?: number }> = {};
  for (const name of ['short', 'medium', 'long'] as const) {
    const slice = valScored.filter((r) => bucket(r.text.length) === name);
    lengthBuckets[name] = {
      ...metrics(
        slice.map((r) => r.label),
        slice.map((r) => r.predicted)
      ),
      minLen: Math.min(...slice.map((r) => r.text.length)),
      maxLen: Math.max(...slice.map((r) => r.text.length)),
    };
  }
  const shortDev = valScored.filter((r) => bucket(r.text.length) === 'short' && r.label === 'DEVELOPMENTAL');
  const longNon = valScored.filter((r) => bucket(r.text.length) === 'long' && r.label === 'NON_DEVELOPMENTAL');

  const unusedNon = valScored.filter((r) => r.label === 'NON_DEVELOPMENTAL');
  const matched: Scored[] = [];
  for (const dev of valScored.filter((r) => r.label === 'DEVELOPMENTAL')) {
    let bestIdx = -1;
    let bestAbs = Infinity;
    for (let i = 0; i < unusedNon.length; i++) {
      const abs = Math.abs(unusedNon[i].text.length - dev.text.length);
      if (abs < bestAbs) {
        bestAbs = abs;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestAbs <= 12) {
      matched.push(dev, unusedNon[bestIdx]);
      unusedNon.splice(bestIdx, 1);
    }
  }
  const lengthMatched = metrics(
    matched.map((r) => r.label),
    matched.map((r) => r.predicted)
  );

  const verbosity = [];
  for (const pair of VERBOSITY_PAIRS) {
    const pShort = predictFromVec(await embedTimed(pair.short));
    const pLong = predictFromVec(await embedTimed(pair.long));
    verbosity.push({
      id: pair.id,
      label: pair.label,
      short: pair.short,
      long: pair.long,
      pShort: Number(pShort.toFixed(4)),
      pLong: Number(pLong.toFixed(4)),
      predShort: classify(pShort),
      predLong: classify(pLong),
      delta: Number((pLong - pShort).toFixed(4)),
      flipped: classify(pShort) !== classify(pLong),
      shortCorrect: classify(pShort) === pair.label,
      longCorrect: classify(pLong) === pair.label,
    });
  }

  const lexical = [];
  for (const probe of LEXICAL_PROBES) {
    const p = predictFromVec(await embedTimed(probe.text));
    lexical.push({
      ...probe,
      pDevelopmental: Number(p.toFixed(4)),
      predicted: classify(p),
    });
  }

  const uncertainScored = await scoreRows(uncertain);
  const uP = uncertainScored.map((r) => r.pDevelopmental);
  const hist: Record<string, number> = {};
  for (const p of uP) {
    const lo = Math.floor(p * 10) / 10;
    const key = `${lo.toFixed(1)}-${(lo + 0.1).toFixed(1)}`;
    hist[key] = (hist[key] || 0) + 1;
  }
  const midBand = uncertainScored.filter((r) => Math.abs(r.pDevelopmental - 0.5) <= 0.15);

  function bandStats(lo: number, hi: number) {
    const valBand = valScored.filter((r) => r.pDevelopmental >= lo && r.pDevelopmental <= hi);
    const trainBand = train.filter((_, i) => {
      const p = predictProbability(model, trainEmbeddings[i]);
      return p >= lo && p <= hi;
    });
    const auxBand = uncertainScored.filter((r) => r.pDevelopmental >= lo && r.pDevelopmental <= hi);
    return {
      lo,
      hi,
      valN: valBand.length,
      valErrorRate:
        valBand.length === 0
          ? null
          : Number((valBand.filter((r) => !r.correct).length / valBand.length).toFixed(4)),
      trainN: trainBand.length,
      uncertainN: auxBand.length,
      uncertainFrac: Number((auxBand.length / uncertainScored.length).toFixed(4)),
    };
  }

  const abstention = {
    officialBinaryDoesNotAbstain: true,
    inspectedBands: [bandStats(0.4, 0.6), bandStats(0.35, 0.65), bandStats(0.45, 0.55)],
    proposedFromValAuxOnly: {
      range: [0.4, 0.6],
      reason:
        'Inspected only. If uncertain mass and val errors concentrate here, abstention may be useful later. Not applied to official binary metrics.',
    },
  };

  const stressScored = await scoreRows(stress);

  let originalErrorTransfer: unknown = null;
  let firstPassCompare: unknown = null;
  if (existsSync(FIRST_PASS_RESULTS) && TAG !== '3a.1') {
    const prev = JSON.parse(readFileSync(FIRST_PASS_RESULTS, 'utf8')) as {
      binaryValidation: unknown;
      nearPairBothSidesCorrect: number;
      domainMetrics: unknown;
      familyAccuracy: unknown;
      errors: Array<{
        id: string;
        text: string;
        expected: string;
        predicted: string;
        pDevelopmental: number;
        familyId: string;
      }>;
    };
    const valById = new Map(valScored.map((r) => [r.id, r]));
    originalErrorTransfer = ORIGINAL_ERROR_IDS.map((id) => {
      const old = prev.errors.find((e) => e.id === id);
      const neu = valById.get(id);
      return {
        id,
        text: neu?.text ?? old?.text,
        familyId: neu?.familyId ?? old?.familyId,
        expected: neu?.label ?? old?.expected,
        oldP: old?.pDevelopmental ?? null,
        newP: neu ? Number(neu.pDevelopmental.toFixed(4)) : null,
        oldCall: old?.predicted ?? null,
        newCall: neu?.predicted ?? null,
        oldCorrect: old ? old.predicted === old.expected : null,
        newCorrect: neu?.correct ?? null,
      };
    });
    firstPassCompare = {
      binaryValidation: { '3a.1': prev.binaryValidation, [TAG]: valMetrics },
      nearPairBothSidesCorrect: {
        '3a.1': prev.nearPairBothSidesCorrect,
        [TAG]: Number(bothSidesRate.toFixed(4)),
      },
      domainMetrics: { '3a.1': prev.domainMetrics, [TAG]: domainMetrics },
      familyAccuracy: { '3a.1': prev.familyAccuracy, [TAG]: familyAccuracy },
    };
  }

  const weightsFile: DevelopmentalWeightsFile = {
    evaluator: TAG === '3a.1' ? 'candidate-developmental-3a' : 'candidate-developmental-3a.2',
    modelId: MINILM_MODEL_ID,
    embeddingDim: MINILM_EMBEDDING_DIM,
    quantization: MINILM_QUANTIZATION,
    binaryThreshold: TRAIN_CONFIG.binaryThreshold,
    seed: TRAIN_CONFIG.seed,
    l2: TRAIN_CONFIG.l2,
    learningRate: TRAIN_CONFIG.learningRate,
    epochs: TRAIN_CONFIG.epochs,
    trainCount: train.length,
    weights: model.weights,
    bias: model.bias,
  };
  mkdirSync(join(process.cwd(), 'lib/evaluation/semantic/weights'), { recursive: true });
  writeFileSync(WEIGHTS_PATH, JSON.stringify(weightsFile));

  const results = {
    evaluator: TAG === '3a.1' ? 'candidate-developmental-3a' : 'candidate-developmental-3a.2',
    pass: TAG === '3a.1' ? 'validation-only-first-pass' : 'candidate-3a.2-dataset-coverage',
    generatedAt: new Date().toISOString(),
    model: {
      id: loaded.modelId,
      quantization: loaded.quantization,
      quantized: loaded.quantized,
      embeddingDim: loaded.embeddingDim,
      cacheBytes,
      approximateSizeMb: Number((cacheBytes / (1024 * 1024)).toFixed(2)),
    },
    trainConfig: TRAIN_CONFIG,
    counts: {
      train: train.length,
      trainDev: train.filter((r) => r.label === 'DEVELOPMENTAL').length,
      trainNon: train.filter((r) => r.label === 'NON_DEVELOPMENTAL').length,
      val: val.length,
      valDev: val.filter((r) => r.label === 'DEVELOPMENTAL').length,
      valNon: val.filter((r) => r.label === 'NON_DEVELOPMENTAL').length,
    },
    timing: {
      coldLoadTimeMs: coldLoadMs,
      warmLoadTimeMs: warmLoadMs,
      trainingMs,
      embeddingCount: embedTimes.length,
      medianEmbedMs: median(embedTimes),
      p95EmbedMs: percentile(embedTimes, 95),
      medianClassifierUs: Number((median(clfTimes) * 1000).toFixed(3)),
    },
    binaryValidation: valMetrics,
    domainMetrics,
    familyAccuracy,
    contrastAccuracy,
    nearPairBothSidesCorrect: Number(bothSidesRate.toFixed(4)),
    nearPairFamilyCount: nearPairFamilies.length,
    errors,
    originalErrorTransfer,
    firstPassCompare,
    lengthBuckets: {
      shortMax: shortCut,
      longMin: longCut,
      buckets: lengthBuckets,
      shortDevAccuracy:
        shortDev.length === 0
          ? null
          : Number((shortDev.filter((r) => r.correct).length / shortDev.length).toFixed(4)),
      shortDevN: shortDev.length,
      longNonDevAccuracy:
        longNon.length === 0
          ? null
          : Number((longNon.filter((r) => r.correct).length / longNon.length).toFixed(4)),
      longNonDevN: longNon.length,
    },
    lengthMatched: {
      n: matched.length,
      pairCount: matched.length / 2,
      maxLengthDiff: 12,
      metrics: lengthMatched,
    },
    verbosity,
    lexicalProbes: lexical,
    uncertainAux: {
      n: uncertainScored.length,
      mean: Number(mean(uP).toFixed(4)),
      median: Number(median(uP).toFixed(4)),
      min: Number(Math.min(...uP).toFixed(4)),
      max: Number(Math.max(...uP).toFixed(4)),
      histogram: hist,
      fracWithin015OfHalf: Number((midBand.length / uncertainScored.length).toFixed(4)),
      predictedDev: uncertainScored.filter((r) => r.predicted === 'DEVELOPMENTAL').length,
      predictedNon: uncertainScored.filter((r) => r.predicted === 'NON_DEVELOPMENTAL').length,
    },
    abstentionNote:
      'Optional only. Not used in official binary metrics. Inspected on train/val/aux, never benchmark v1.',
    abstention,
    stressAux: stressScored.map((r) => ({
      id: r.id,
      text: r.text,
      familyId: r.familyId,
      pDevelopmental: Number(r.pDevelopmental.toFixed(4)),
      predicted: r.predicted,
    })),
  };

  mkdirSync(join(process.cwd(), 'benchmarks/semantic/results'), { recursive: true });
  writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));

  console.log(`Candidate #${TAG} validation-only`);
  console.log(JSON.stringify({ model: results.model, counts: results.counts, timing: results.timing, binaryValidation: valMetrics, nearPairBothSidesCorrect: results.nearPairBothSidesCorrect, errorCount: errors.length, originalErrorTransfer, firstPassCompare: firstPassCompare && { binaryValidation: (firstPassCompare as { binaryValidation: unknown }).binaryValidation, nearPairBothSidesCorrect: (firstPassCompare as { nearPairBothSidesCorrect: unknown }).nearPairBothSidesCorrect } }, null, 2));
  console.log(`Wrote ${WEIGHTS_PATH}`);
  console.log(`Wrote ${RESULTS_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
