import { mkdirSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  CANDIDATE_MODEL_ID,
  CANDIDATE_QUANTIZATION,
  CANDIDATE_THRESHOLDS,
  DISTILBERT_LICENSE_NOTES,
  evaluateWithDistilBert,
  loadDistilBertCandidate,
} from '../../lib/evaluation/semantic/candidateDistilBert';
import { scoreAgainstCase, summarizeScores } from './scoreContract';
import { SEMANTIC_BENCHMARK_V1 } from './v1';

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return sorted[index];
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function directorySizeBytes(dir: string): number {
  try {
    let total = 0;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) total += directorySizeBytes(full);
      else total += statSync(full).size;
    }
    return total;
  } catch {
    return 0;
  }
}

async function main() {
  const totalStarted = Date.now();
  const coldStarted = Date.now();
  const loaded = await loadDistilBertCandidate();
  const coldLoadTimeMs = Date.now() - coldStarted;

  const warmStarted = Date.now();
  await loadDistilBertCandidate();
  const warmLoadTimeMs = Date.now() - warmStarted;

  const latencies: number[] = [];
  const scored = [];

  for (const testCase of SEMANTIC_BENCHMARK_V1) {
    const inferenceStarted = Date.now();
    const evaluation = await evaluateWithDistilBert(
      testCase.text,
      testCase.selectedCategories
    );
    const inferenceMs = Date.now() - inferenceStarted;
    latencies.push(inferenceMs);

    scored.push({
      ...scoreAgainstCase(testCase, evaluation, {
        comparable: true,
        taxonomyUnsupported: false,
        unsupportedCategories: [],
      }),
      inferenceMs,
      modelSignals: {
        developmentalScore: evaluation.developmentalScore,
        ordinaryActivityScore: evaluation.ordinaryActivityScore,
        passiveConsumptionScore: evaluation.passiveConsumptionScore,
        ambiguityScore: evaluation.ambiguityScore,
        nonsenseScore: evaluation.nonsenseScore,
        junkReason: evaluation.junkReason,
        categoryScores: evaluation.categoryScores,
      },
    });
  }

  const scores = summarizeScores(scored);
  const failed = scored.filter((item) => item.matches.contract !== true);
  const b09 = scored.find((item) => item.id === 'B09');
  const b58 = scored.find((item) => item.id === 'B58');
  const modelCacheDir = join(
    process.cwd(),
    '.cache/transformers',
    CANDIDATE_MODEL_ID
  );
  const cacheBytes = directorySizeBytes(modelCacheDir);

  const summary = {
    evaluator: 'candidate-distilbert-nli',
    pass: 'first-pass-untouched-thresholds',
    benchmark: 'Bettr Semantic Benchmark v1',
    generatedAt: new Date().toISOString(),
    model: {
      id: loaded.modelId || CANDIDATE_MODEL_ID,
      quantization: CANDIDATE_QUANTIZATION,
      quantized: loaded.quantized,
      cacheBytes,
      approximateSizeMb: Number((cacheBytes / (1024 * 1024)).toFixed(2)),
      license: DISTILBERT_LICENSE_NOTES,
    },
    thresholds: CANDIDATE_THRESHOLDS,
    timing: {
      coldLoadTimeMs,
      warmLoadTimeMs,
      loadTimeMs: coldLoadTimeMs,
      totalRuntimeMs: Date.now() - totalStarted,
      inferenceCount: latencies.length,
      meanInferenceMs: Number(
        (latencies.reduce((sum, value) => sum + value, 0) / latencies.length).toFixed(1)
      ),
      medianInferenceMs: median(latencies),
      p95InferenceMs: percentile(latencies, 95),
    },
    totals: {
      totalCases: scored.length,
      comparable: scored.length,
      taxonomyUnsupported: 0,
    },
    scores: {
      outcomeAccuracy: scores.outcomeAccuracy,
      developmentalValidityAccuracy: scores.developmentalValidityAccuracy,
      categorySuggestionAccuracy: scores.categorySuggestionAccuracy,
      evidenceBaseCreditAccuracy: scores.evidenceBaseCreditAccuracy,
      junkAdversarialImplausibilityAccuracy:
        scores.junkAdversarialImplausibilityAccuracy,
      overallContractScore: scores.overallContractScore,
    },
    regression: {
      B09: {
        text: b09?.text,
        expected: b09?.expected,
        actual: b09?.actual,
        failReasons: b09?.failReasons,
      },
      B58: {
        text: b58?.text,
        expected: b58?.expected,
        actual: b58?.actual,
        failReasons: b58?.failReasons,
      },
    },
    failedCases: failed.map((item) => ({
      id: item.id,
      text: item.text,
      expected: item.expected,
      actual: item.actual,
      failReasons: item.failReasons,
    })),
    cases: scored,
  };

  const outDir = join(process.cwd(), 'benchmarks/semantic/results');
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, 'distilbert-candidate-v1.json');
  writeFileSync(outFile, `${JSON.stringify(summary, null, 2)}\n`);

  const pct = (value: number | null) =>
    value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;

  console.log('Bettr Semantic Benchmark v1 — DistilBERT Candidate #2 (first pass)');
  console.log(`Model: ${loaded.modelId} (${CANDIDATE_QUANTIZATION})`);
  console.log(`Cold load: ${coldLoadTimeMs}ms`);
  console.log(`Warm load: ${warmLoadTimeMs}ms`);
  console.log(`Median inference: ${summary.timing.medianInferenceMs}ms`);
  console.log(`p95 inference: ${summary.timing.p95InferenceMs}ms`);
  console.log(`Approximate model cache: ${summary.model.approximateSizeMb} MB`);
  console.log(`Total cases: ${summary.totals.totalCases}`);
  console.log(`Outcome accuracy: ${pct(scores.outcomeAccuracy.accuracy)}`);
  console.log(
    `Developmental-validity accuracy: ${pct(scores.developmentalValidityAccuracy.accuracy)}`
  );
  console.log(
    `Category/suggestion accuracy: ${pct(scores.categorySuggestionAccuracy.accuracy)}`
  );
  console.log(
    `Evidence/base-credit accuracy: ${pct(scores.evidenceBaseCreditAccuracy.accuracy)}`
  );
  console.log(
    `Junk/adversarial/implausibility outcome accuracy: ${pct(scores.junkAdversarialImplausibilityAccuracy.accuracy)}`
  );
  console.log(
    `Overall contract score: ${pct(scores.overallContractScore.accuracy)}`
  );
  console.log(
    `B09: expected ${b09?.expected.outcome}/${b09?.expected.evidenceTier}/${b09?.expected.baseCredit}; actual ${b09?.actual?.outcome}/${b09?.actual?.evidenceTier}/${b09?.actual?.baseCredit}`
  );
  console.log(
    `B58: expected ${b58?.expected.outcome}/${b58?.expected.evidenceTier}/${b58?.expected.baseCredit}; actual ${b58?.actual?.outcome}/${b58?.actual?.evidenceTier}/${b58?.actual?.baseCredit}`
  );
  console.log(`Failed cases: ${failed.length}`);
  for (const failure of failed) {
    console.log(
      `- ${failure.id}: expected ${failure.expected.outcome}/${failure.expected.evidenceTier}/${failure.expected.baseCredit}; actual ${failure.actual?.outcome}/${failure.actual?.evidenceTier}/${failure.actual?.baseCredit}`
    );
  }
  console.log(`Wrote ${outFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
