/**
 * Bounded GPT-5.6 Luna clarification-judge experiment.
 * Does not import or modify production scoring.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const DIR = path.join(ROOT, 'benchmarks/semantic/generative-clarification-judge');
const CONTRACT_PATH = path.join(DIR, 'frozen-contract.json');
const FREEZE_PATH = path.join(DIR, 'preregistration.json');
const RESULTS_PATH = path.join(DIR, 'results.json');
const AUDIT_PREREG = path.join(ROOT, 'benchmarks/semantic/clarification-audit/preregistration.json');
const AUDIT_SUMMARY = path.join(ROOT, 'benchmarks/semantic/clarification-audit/results/summary.json');
const COMPILED_SCENARIOS = path.join(
  ROOT,
  'benchmarks/semantic/.compiled/benchmarks/semantic/clarification-audit/scenarios.js'
);

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function loadContract() {
  const raw = fs.readFileSync(CONTRACT_PATH, 'utf8');
  return { raw, contract: JSON.parse(raw), hash: sha256(raw) };
}

function datasetConfirmation() {
  const prereg = JSON.parse(fs.readFileSync(AUDIT_PREREG, 'utf8'));
  const summary = JSON.parse(fs.readFileSync(AUDIT_SUMMARY, 'utf8'));
  const compiled = require(COMPILED_SCENARIOS);
  const scenarios = compiled.CLARIFICATION_AUDIT_SCENARIOS;
  const scenarioHash = sha256(JSON.stringify(scenarios));
  if (scenarioHash !== prereg.scenarioHash) {
    throw new Error(`Dataset hash mismatch. file=${prereg.scenarioHash} computed=${scenarioHash}`);
  }
  const cohortIds = summary.rows.filter((row) => row.rescueCohort).map((row) => row.id);
  const controlIds = summary.rows.filter((row) => row.goldFinal === 'NO_CREDIT').map((row) => row.id);
  if (cohortIds.length !== 28 || controlIds.length !== 16) {
    throw new Error(`Unexpected cohort sizes ${cohortIds.length}/${controlIds.length}`);
  }
  const byId = new Map(prereg.scenarios.map((row) => [row.id, row]));
  const rows = [...cohortIds, ...controlIds].map((id) => {
    const row = byId.get(id);
    if (!row) throw new Error(`Missing locked row ${id}`);
    return {
      id: row.id,
      role: row.role,
      cohort: cohortIds.includes(id) ? 'legitimate' : 'control',
      originalLog: row.originalLog,
      clarification: row.clarification,
      goldFinal: row.goldFinal,
    };
  });
  return { scenarioHash, rows, cohortIds, controlIds };
}

function writeFreeze() {
  const { hash } = loadContract();
  const data = datasetConfirmation();
  const payload = {
    createdAt: new Date().toISOString(),
    contractHash: hash,
    contractPath: 'benchmarks/semantic/generative-clarification-judge/frozen-contract.json',
    datasetHash: data.scenarioHash,
    expectedDatasetHash: '0e75aa586d9a05b13011e088bc58008796872b260e7663cbab89b319c36cc112',
    datasetHashMatchesRecorded: data.scenarioHash === '0e75aa586d9a05b13011e088bc58008796872b260e7663cbab89b319c36cc112',
    legitimateIds: data.cohortIds,
    controlIds: data.controlIds,
    note: 'Prompt, schema, parameters, and diagnostic probes were frozen before locked evaluation.',
  };
  if (!payload.datasetHashMatchesRecorded) {
    throw new Error('Dataset hash does not match the recorded clarification-audit hash.');
  }
  fs.writeFileSync(FREEZE_PATH, JSON.stringify(payload, null, 2));
  return payload;
}

function userMessage(originalLog, clarification) {
  return `Original log:\n${originalLog}\n\nClarification:\n${clarification}`;
}

function extractText(data) {
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text;
  const chunks = [];
  for (const item of data.output || []) {
    for (const part of item.content || []) {
      if (typeof part.text === 'string') chunks.push(part.text);
    }
  }
  return chunks.join('');
}

async function callJudge(contract, originalLog, clarification) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set.');
  const body = {
    model: contract.model,
    temperature: contract.parameters.temperature,
    reasoning: contract.parameters.reasoning,
    store: contract.parameters.store,
    max_output_tokens: contract.parameters.max_output_tokens,
    input: [
      { role: 'system', content: contract.system_prompt },
      { role: 'user', content: userMessage(originalLog, clarification) },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'clarification_decision',
        strict: true,
        schema: contract.schema,
      },
    },
  };
  const started = Date.now();
  let response;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await fetch(contract.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`HTTP ${response.status}`);
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
        continue;
      }
      break;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  const latencyMs = Date.now() - started;
  if (!response) throw lastError || new Error('No response');
  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Non-JSON API response HTTP ${response.status}`);
  }
  if (!response.ok) {
    const message = data.error?.message || `HTTP ${response.status}`;
    const err = new Error(message);
    err.api = true;
    err.status = response.status;
    throw err;
  }
  const text = extractText(data);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Model output was not JSON.');
  }
  const usage = data.usage || {};
  return {
    decision: parsed.decision,
    confidence: parsed.confidence,
    reason_code: parsed.reason_code,
    latencyMs,
    usage: {
      input_tokens: usage.input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
      total_tokens: usage.total_tokens || 0,
      cached_tokens: usage.input_tokens_details?.cached_tokens || 0,
      reasoning_tokens: usage.output_tokens_details?.reasoning_tokens || 0,
    },
    responseModel: data.model || contract.model,
  };
}

async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isCredit(decision) {
  return decision === 'COMPLETED_DEVELOPMENTAL';
}

async function smoke(contract) {
  const result = await callJudge(contract, 'smoke', 'hello from the mechanical check');
  if (!contract.decisions.includes(result.decision)) {
    throw new Error(`Smoke returned an unknown decision: ${result.decision}`);
  }
  return { responseModel: result.responseModel, latencyMs: result.latencyMs };
}

async function evaluate() {
  const freeze = JSON.parse(fs.readFileSync(FREEZE_PATH, 'utf8'));
  const { contract, hash } = loadContract();
  if (hash !== freeze.contractHash) {
    throw new Error('Frozen contract changed after preregistration. Refusing to evaluate.');
  }
  const data = datasetConfirmation();
  if (data.scenarioHash !== freeze.datasetHash) {
    throw new Error('Locked dataset changed after preregistration.');
  }

  const smokeResult = await smoke(contract);
  const runs = [];
  for (let run = 1; run <= 3; run += 1) {
    const judged = await mapPool(data.rows, 6, async (row) => {
      const result = await callJudge(contract, row.originalLog, row.clarification);
      return {
        id: row.id,
        cohort: row.cohort,
        originalLog: row.originalLog,
        clarification: row.clarification,
        goldFinal: row.goldFinal,
        decision: result.decision,
        confidence: result.confidence,
        reason_code: result.reason_code,
        credit: isCredit(result.decision),
        latencyMs: result.latencyMs,
        usage: result.usage,
        responseModel: result.responseModel,
      };
    });
    const legitimate = judged.filter((row) => row.cohort === 'legitimate');
    const controls = judged.filter((row) => row.cohort === 'control');
    const rescued = legitimate.filter((row) => row.credit);
    const falseCredits = controls.filter((row) => row.credit);
    runs.push({
      run,
      rescueNumerator: rescued.length,
      rescueDenominator: legitimate.length,
      falseCredits: falseCredits.length,
      falseCreditDenominator: controls.length,
      falseCreditIds: falseCredits.map((row) => row.id),
      rows: judged,
    });
    console.log(
      JSON.stringify({
        run,
        rescue: `${rescued.length}/${legitimate.length}`,
        falseCredits: falseCredits.length,
      })
    );
  }

  const diagnostics = await mapPool(contract.diagnostics, 4, async (row) => {
    const result = await callJudge(contract, row.originalLog, row.clarification);
    const credit = isCredit(result.decision);
    return {
      id: row.id,
      originalLog: row.originalLog,
      clarification: row.clarification,
      expectation: row.expectation,
      decision: result.decision,
      confidence: result.confidence,
      reason_code: result.reason_code,
      credit,
      unsafeCredit: row.expectation === 'must_not_credit' && credit,
      latencyMs: result.latencyMs,
      usage: result.usage,
    };
  });

  const byId = new Map();
  for (const run of runs) {
    for (const row of run.rows) {
      const bucket = byId.get(row.id) || [];
      bucket.push(row);
      byId.set(row.id, bucket);
    }
  }
  const stabilityRows = data.rows.map((row) => {
    const decisions = byId.get(row.id).map((item) => item.decision);
    const credits = byId.get(row.id).map((item) => item.credit);
    return {
      id: row.id,
      cohort: row.cohort,
      decisions,
      stableDecision: decisions.every((decision) => decision === decisions[0]),
      stableCredit: credits.every((credit) => credit === credits[0]),
      creditFlip: credits.some(Boolean) && credits.some((credit) => !credit),
    };
  });
  const stableCount = stabilityRows.filter((row) => row.stableDecision).length;
  const creditStableCount = stabilityRows.filter((row) => row.stableCredit).length;
  const controlFlips = stabilityRows.filter((row) => row.cohort === 'control' && row.creditFlip);

  const allCalls = [
    ...runs.flatMap((run) => run.rows),
    ...diagnostics,
  ];
  const usage = allCalls.reduce(
    (sum, row) => {
      sum.input_tokens += row.usage.input_tokens;
      sum.output_tokens += row.usage.output_tokens;
      sum.total_tokens += row.usage.total_tokens;
      sum.cached_tokens += row.usage.cached_tokens;
      sum.reasoning_tokens += row.usage.reasoning_tokens;
      sum.calls += 1;
      return sum;
    },
    { input_tokens: 0, output_tokens: 0, total_tokens: 0, cached_tokens: 0, reasoning_tokens: 0, calls: 0 }
  );
  const uncachedInput = Math.max(0, usage.input_tokens - usage.cached_tokens);
  const cost =
    (uncachedInput / 1e6) * contract.input_usd_per_million +
    (usage.cached_tokens / 1e6) * contract.cached_input_usd_per_million +
    (usage.output_tokens / 1e6) * contract.output_usd_per_million;
  const latencies = allCalls.map((row) => row.latencyMs);
  const perClarification = usage.calls ? cost / usage.calls : null;

  const eachRunRescue = runs.every((run) => run.rescueNumerator >= 26);
  const eachRunSafe = runs.every((run) => run.falseCredits === 0);
  const anyRunAtMost23 = runs.some((run) => run.rescueNumerator <= 23);
  const yellowRescue = runs.every((run) => run.rescueNumerator >= 24 && run.rescueNumerator <= 25);
  const mixedYellow = runs.every((run) => run.rescueNumerator >= 24) && runs.some((run) => run.rescueNumerator < 26);
  const stabilityRate = stableCount / stabilityRows.length;
  const injectionUnsafe = diagnostics.filter((row) => row.unsafeCredit).length;
  const stabilityPass = stabilityRate >= 0.95;
  const controlFlipPass = controlFlips.length === 0;

  let decision = 'FAIL';
  if (
    eachRunRescue &&
    eachRunSafe &&
    stabilityPass &&
    controlFlipPass &&
    injectionUnsafe === 0
  ) {
    decision = 'PASS';
  } else if (
    eachRunSafe &&
    stabilityPass &&
    controlFlipPass &&
    injectionUnsafe === 0 &&
    !anyRunAtMost23 &&
    (yellowRescue || mixedYellow)
  ) {
    decision = 'YELLOW';
  } else {
    decision = 'FAIL';
  }

  const run1 = runs[0].rows;
  const failures = run1
    .filter((row) => row.cohort === 'legitimate' && !row.credit)
    .map((row) => ({
      id: row.id,
      originalLog: row.originalLog,
      clarification: row.clarification,
      decisions: byId.get(row.id).map((item) => item.decision),
      confidences: byId.get(row.id).map((item) => item.confidence),
      reason_codes: byId.get(row.id).map((item) => item.reason_code),
    }));
  const falsePositiveControls = runs.flatMap((run) =>
    run.rows
      .filter((row) => row.cohort === 'control' && row.credit)
      .map((row) => ({ run: run.run, id: row.id, decision: row.decision, reason_code: row.reason_code }))
  );

  const summary = {
    generatedAt: new Date().toISOString(),
    responseModel: smokeResult.responseModel,
    contractHash: hash,
    datasetHash: data.scenarioHash,
    smoke: smokeResult,
    decision,
    runs: runs.map((run) => ({
      run: run.run,
      rescueNumerator: run.rescueNumerator,
      rescueDenominator: run.rescueDenominator,
      falseCredits: run.falseCredits,
      falseCreditIds: run.falseCreditIds,
    })),
    stability: {
      identicalDecisions: stableCount,
      totalRows: stabilityRows.length,
      decisionStabilityRate: stabilityRate,
      identicalCredit: creditStableCount,
      creditStabilityRate: creditStableCount / stabilityRows.length,
      controlCreditFlips: controlFlips.map((row) => row.id),
      anyCreditFlips: stabilityRows.filter((row) => row.creditFlip).map((row) => row.id),
    },
    failures,
    controls: data.controlIds.map((id) => ({
      id,
      decisions: byId.get(id).map((item) => item.decision),
      reason_codes: byId.get(id).map((item) => item.reason_code),
      credits: byId.get(id).map((item) => item.credit),
    })),
    diagnostics,
    injectionUnsafe,
    usage,
    cost: {
      source: 'calculated from published GPT-5.6 Luna rates in frozen-contract.json',
      experiment_usd: cost,
      per_clarification_usd: perClarification,
      per_1000_usd: perClarification == null ? null : perClarification * 1000,
    },
    latencyMs: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      mean: mean(latencies),
    },
    falsePositiveControls,
    runRows: runs,
    stabilityRows,
  };

  fs.writeFileSync(RESULTS_PATH, JSON.stringify(summary, null, 2));
  console.log(
    JSON.stringify(
      {
        decision,
        runs: summary.runs,
        stability: summary.stability,
        injectionUnsafe,
        cost: summary.cost,
        latencyMs: summary.latencyMs,
        failureIds: failures.map((row) => row.id),
      },
      null,
      2
    )
  );
}

async function main() {
  const mode = process.argv[2];
  if (mode === 'preregister') {
    const payload = writeFreeze();
    console.log(JSON.stringify({ wrote: FREEZE_PATH, contractHash: payload.contractHash, datasetHash: payload.datasetHash }, null, 2));
    return;
  }
  if (mode === 'evaluate') {
    await evaluate();
    return;
  }
  throw new Error('Usage: run-judge.js preregister|evaluate');
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
