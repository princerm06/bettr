/**
 * ONE-SHOT Semantic Benchmark v1 evaluation against frozen Candidate #3A.2.
 * Does not retrain, retune, or load the retired 92-row set.
 * Does not invoke legacy, 3B, 4A, 5A, or 6A.
 */
import { createHash } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  mapProbabilityToStatus,
  PRODUCT_DEV_MIN,
  PRODUCT_NON_MAX,
  PRODUCT_PROBE_FILE,
  isDeterministicInvalid,
} from '../../lib/evaluation/developmentalProductPolicy';
import { predictProbability } from '../../lib/evaluation/semantic/logisticRegression';
import {
  embedText,
  loadMiniLm,
  MINILM_EMBEDDING_DIM,
  MINILM_MODEL_ID,
  MINILM_QUANTIZATION,
} from '../../lib/evaluation/semantic/minilmEmbeddings';
import probeFile from '../../lib/evaluation/semantic/weights/developmental-3a.2.json';
import { isDevelopmental } from './scoreContract';
import type { SemanticBenchmarkCase, SemanticOutcome } from './types';
import { SEMANTIC_BENCHMARK_V1 } from './v1';

type ProbeFile = {
  evaluator: string;
  modelId: string;
  embeddingDim: number;
  quantization: string;
  l2: number;
  learningRate: number;
  epochs: number;
  trainCount: number;
  weights: number[];
  bias: number;
};

const probe = probeFile as ProbeFile;
const OUT_PATH = join(
  process.cwd(),
  'benchmarks/semantic/results/semantic-benchmark-v1-candidate-3a.json'
);

type GoldState = 'DEVELOPMENTAL' | 'NON_DEVELOPMENTAL' | 'UNCERTAIN';
type PredState =
  | 'INVALID'
  | 'NON_DEVELOPMENTAL'
  | 'UNCERTAIN'
  | 'DEVELOPMENTAL';

function goldGateState(outcome: SemanticOutcome): GoldState {
  if (isDevelopmental(outcome)) return 'DEVELOPMENTAL';
  if (outcome === 'NEEDS_CLARIFICATION') return 'UNCERTAIN';
  return 'NON_DEVELOPMENTAL';
}

function confidentReject(status: PredState) {
  return status === 'NON_DEVELOPMENTAL' || status === 'INVALID';
}

function classifyDecision(gold: GoldState, pred: PredState) {
  if (pred === 'UNCERTAIN') {
    return gold === 'UNCERTAIN' ? 'appropriate_abstention' : 'undesirable_abstention';
  }
  if (pred === 'DEVELOPMENTAL') {
    if (gold === 'DEVELOPMENTAL') return 'correct_confident';
    return 'incorrect_confident';
  }
  if (gold === 'NON_DEVELOPMENTAL') return 'correct_confident';
  return 'incorrect_confident';
}

function assertFrozenRuntime() {
  if (probe.evaluator !== 'candidate-developmental-3a.2') {
    throw new Error(`STOP: probe is ${probe.evaluator}, not candidate-developmental-3a.2`);
  }
  if (probe.modelId !== MINILM_MODEL_ID) {
    throw new Error(`STOP: probe modelId ${probe.modelId}`);
  }
  if (probe.embeddingDim !== 384 || probe.weights.length !== 384) {
    throw new Error('STOP: probe is not 384-d');
  }
  if (probe.quantization !== 'int8-onnx') {
    throw new Error(`STOP: probe quantization ${probe.quantization}`);
  }
  if (probe.l2 !== 0.01 || probe.learningRate !== 0.4 || probe.epochs !== 400) {
    throw new Error('STOP: 3A.2 hyperparameters do not match architecture of record');
  }
  if (PRODUCT_PROBE_FILE !== 'developmental-3a.2.json') {
    throw new Error(`STOP: PRODUCT_PROBE_FILE is ${PRODUCT_PROBE_FILE}`);
  }
  if (PRODUCT_NON_MAX !== 0.45 || PRODUCT_DEV_MIN !== 0.55) {
    throw new Error('STOP: NARROW thresholds are not 0.45 / 0.55');
  }
  if (MINILM_QUANTIZATION !== 'int8-onnx' || MINILM_EMBEDDING_DIM !== 384) {
    throw new Error('STOP: MiniLM identity mismatch');
  }
}

async function main() {
  assertFrozenRuntime();
  if (SEMANTIC_BENCHMARK_V1.length !== 72) {
    throw new Error(`STOP: v1 has ${SEMANTIC_BENCHMARK_V1.length} cases, expected 72`);
  }

  const encoder = await loadMiniLm();
  if (encoder.modelId !== MINILM_MODEL_ID || encoder.quantization !== 'int8-onnx') {
    throw new Error('STOP: loaded encoder is not frozen MiniLM INT8');
  }

  const model = { weights: probe.weights, bias: probe.bias };
  const cases: SemanticBenchmarkCase[] = SEMANTIC_BENCHMARK_V1;
  type Row = {
    id: string;
    text: string;
    family: string;
    selectedCategories: SemanticBenchmarkCase['selectedCategories'];
    expectedOutcome: SemanticOutcome;
    expectedEvidenceTier: SemanticBenchmarkCase['expectedEvidenceTier'];
    expectedBaseCredit: SemanticBenchmarkCase['expectedBaseCredit'];
    expectedSupportedCategories: SemanticBenchmarkCase['expectedSupportedCategories'];
    expectedSuggestedCategories: SemanticBenchmarkCase['expectedSuggestedCategories'];
    reason: string;
    goldGateState: GoldState;
    predictedState: PredState;
    p_dev: number | null;
    decisionClass: ReturnType<typeof classifyDecision>;
    gateMatch: boolean;
    falseDev: boolean;
    falseNon: boolean;
    abstained: boolean;
  };
  const rows: Row[] = [];

  for (const testCase of cases) {
    const gold = goldGateState(testCase.expectedOutcome);
    let pDev: number | null = null;
    let predicted: PredState;
    if (isDeterministicInvalid(testCase.text)) {
      predicted = 'INVALID';
    } else {
      const z = await embedText(testCase.text);
      if (z.length !== 384) throw new Error(`STOP: embedding dim ${z.length}`);
      pDev = predictProbability(model, z);
      predicted = mapProbabilityToStatus(pDev);
    }
    const decision = classifyDecision(gold, predicted);
    rows.push({
      id: testCase.id,
      text: testCase.text,
      family: testCase.benchmarkFamily,
      selectedCategories: testCase.selectedCategories,
      expectedOutcome: testCase.expectedOutcome,
      expectedEvidenceTier: testCase.expectedEvidenceTier,
      expectedBaseCredit: testCase.expectedBaseCredit,
      expectedSupportedCategories: testCase.expectedSupportedCategories,
      expectedSuggestedCategories: testCase.expectedSuggestedCategories,
      reason: testCase.reason,
      goldGateState: gold,
      predictedState: predicted,
      p_dev: pDev,
      decisionClass: decision,
      gateMatch: predicted === gold || (gold === 'NON_DEVELOPMENTAL' && predicted === 'INVALID'),
      falseDev: predicted === 'DEVELOPMENTAL' && gold !== 'DEVELOPMENTAL',
      falseNon:
        confidentReject(predicted) && gold === 'DEVELOPMENTAL',
      abstained: predicted === 'UNCERTAIN',
    });
  }

  const n = rows.length;
  const expectedDev = rows.filter((r) => r.goldGateState === 'DEVELOPMENTAL');
  const expectedNon = rows.filter((r) => r.goldGateState === 'NON_DEVELOPMENTAL');
  const expectedUnc = rows.filter((r) => r.goldGateState === 'UNCERTAIN');
  const predDev = rows.filter((r) => r.predictedState === 'DEVELOPMENTAL');
  const predNon = rows.filter((r) => confidentReject(r.predictedState));
  const predUnc = rows.filter((r) => r.predictedState === 'UNCERTAIN');
  const confident = rows.filter((r) => r.predictedState !== 'UNCERTAIN');

  const recDev = expectedDev.filter((r) => r.predictedState === 'DEVELOPMENTAL').length / Math.max(1, expectedDev.length);
  const recNon = expectedNon.filter((r) => confidentReject(r.predictedState)).length / Math.max(1, expectedNon.length);
  const recUnc = expectedUnc.filter((r) => r.predictedState === 'UNCERTAIN').length / Math.max(1, expectedUnc.length);

  const falseDev = rows.filter((r) => r.falseDev);
  const falseNon = rows.filter((r) => r.falseNon);
  const appropriateAbs = rows.filter((r) => r.decisionClass === 'appropriate_abstention');
  const undesirableAbs = rows.filter((r) => r.decisionClass === 'undesirable_abstention');
  const correctConf = rows.filter((r) => r.decisionClass === 'correct_confident');
  const incorrectConf = rows.filter((r) => r.decisionClass === 'incorrect_confident');

  const selectiveCorrect = confident.filter((r) => r.gateMatch).length;
  const families = [...new Set(rows.map((r) => r.family))].sort();
  const byFamily = Object.fromEntries(
    families.map((family) => {
      const slice = rows.filter((r) => r.family === family);
      return [
        family,
        {
          n: slice.length,
          gateMatch: slice.filter((r) => r.gateMatch).length,
          falseDev: slice.filter((r) => r.falseDev).length,
          falseNon: slice.filter((r) => r.falseNon).length,
          abstained: slice.filter((r) => r.abstained).length,
          predicted: {
            DEVELOPMENTAL: slice.filter((r) => r.predictedState === 'DEVELOPMENTAL').length,
            UNCERTAIN: slice.filter((r) => r.predictedState === 'UNCERTAIN').length,
            NON_DEVELOPMENTAL: slice.filter((r) => r.predictedState === 'NON_DEVELOPMENTAL').length,
            INVALID: slice.filter((r) => r.predictedState === 'INVALID').length,
          },
        },
      ];
    })
  );

  const v1Source = readFileSync(join(process.cwd(), 'benchmarks/semantic/v1.ts'));
  const report = {
    benchmark: 'Bettr Semantic Benchmark v1',
    benchmarkPath: 'benchmarks/semantic/v1.ts',
    benchmarkSha256: createHash('sha256').update(v1Source).digest('hex'),
    nCases: n,
    timestamp: new Date().toISOString(),
    run: 'one-shot',
    encoder: {
      modelId: MINILM_MODEL_ID,
      quantization: MINILM_QUANTIZATION,
      pooling: 'mean',
      normalize: 'L2',
      embeddingDim: MINILM_EMBEDDING_DIM,
    },
    probe: {
      file: PRODUCT_PROBE_FILE,
      evaluator: probe.evaluator,
      l2: probe.l2,
      learningRate: probe.learningRate,
      epochs: probe.epochs,
      trainCount: probe.trainCount,
      weightCount: probe.weights.length,
      bias: probe.bias,
    },
    thresholds: {
      policy: 'NARROW',
      nonMax: PRODUCT_NON_MAX,
      devMin: PRODUCT_DEV_MIN,
    },
    invoked: {
      legacyHeuristic: false,
      candidate3B: false,
      candidate4A: false,
      candidate5A: false,
      candidate6A: false,
      candidate3A2: true,
    },
    note: '3A.2 is a developmental gate only. Full v1 contract fields (category suggestion, evidence tier, XP 5 vs 7) are recorded as expected labels but are not produced by this probe.',
    metrics: {
      threeWayGateAccuracy: Number((rows.filter((r) => r.gateMatch).length / n).toFixed(4)),
      coverage: Number((confident.length / n).toFixed(4)),
      abstentionRate: Number((predUnc.length / n).toFixed(4)),
      selectiveAccuracy: Number((selectiveCorrect / Math.max(1, confident.length)).toFixed(4)),
      balancedAccuracyROW: Number(((recDev + recNon) / 2).toFixed(4)),
      recallDevelopmental: Number(recDev.toFixed(4)),
      recallNonDevelopmental: Number(recNon.toFixed(4)),
      recallUncertain: Number(recUnc.toFixed(4)),
      falseDevCount: falseDev.length,
      falseDevRate: Number((falseDev.length / n).toFixed(4)),
      falseNonCount: falseNon.length,
      falseNonRate: Number((falseNon.length / n).toFixed(4)),
      correctConfident: correctConf.length,
      incorrectConfident: incorrectConf.length,
      appropriateAbstention: appropriateAbs.length,
      undesirableAbstention: undesirableAbs.length,
      predicted: {
        DEVELOPMENTAL: predDev.length,
        UNCERTAIN: predUnc.length,
        NON_DEVELOPMENTAL: rows.filter((r) => r.predictedState === 'NON_DEVELOPMENTAL').length,
        INVALID: rows.filter((r) => r.predictedState === 'INVALID').length,
      },
      expected: {
        DEVELOPMENTAL: expectedDev.length,
        UNCERTAIN: expectedUnc.length,
        NON_DEVELOPMENTAL: expectedNon.length,
      },
    },
    byFamily,
    falseDevCases: falseDev.map((r) => ({
      id: r.id,
      text: r.text,
      family: r.family,
      expectedOutcome: r.expectedOutcome,
      predictedState: r.predictedState,
      p_dev: r.p_dev,
    })),
    falseNonCases: falseNon.map((r) => ({
      id: r.id,
      text: r.text,
      family: r.family,
      expectedOutcome: r.expectedOutcome,
      predictedState: r.predictedState,
      p_dev: r.p_dev,
    })),
    undesirableAbstentions: undesirableAbs.map((r) => ({
      id: r.id,
      text: r.text,
      family: r.family,
      goldGateState: r.goldGateState,
      expectedOutcome: r.expectedOutcome,
      p_dev: r.p_dev,
    })),
    appropriateAbstentions: appropriateAbs.map((r) => ({
      id: r.id,
      text: r.text,
      family: r.family,
      p_dev: r.p_dev,
    })),
    incorrectConfident: incorrectConf.map((r) => ({
      id: r.id,
      text: r.text,
      family: r.family,
      goldGateState: r.goldGateState,
      predictedState: r.predictedState,
      p_dev: r.p_dev,
    })),
    rows,
  };

  mkdirSync(join(process.cwd(), 'benchmarks/semantic/results'), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        wrote: OUT_PATH,
        nCases: n,
        metrics: report.metrics,
        falseDev: report.falseDevCases,
        falseNon: report.falseNonCases,
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
