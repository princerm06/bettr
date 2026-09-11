/**
 * Runtime/research parity for a small non-sealed fixture set.
 * Compares Node INT8 MiniLM vs browser-safe MiniLM using frozen 3A.2.
 */
import { spawnSync } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { mapProbabilityToStatus } from '../../lib/evaluation/developmentalProductPolicy';
import { isDeterministicInvalid } from '../../lib/evaluation/developmentalProductPolicy';
import { predictProbability } from '../../lib/evaluation/semantic/logisticRegression';
import { RUNTIME_PARITY_FIXTURES } from '../../lib/evaluation/runtimeParityFixtures';
import probeFile from '../../lib/evaluation/semantic/weights/developmental-3a.2.json';

const FROZEN_PATH = join(
  process.cwd(),
  'benchmarks/semantic/results/developmental-3a-runtime-parity-fixtures.json'
);

const MAX_ABS_P = 1e-5;
const MAX_ABS_EMB = 1e-5;

type ProbeFile = { evaluator: string; weights: number[]; bias: number };
type Row = { text: string; p: number | null; status: string; embedding: number[] | null };

const probe = probeFile as ProbeFile;
const model = { weights: probe.weights, bias: probe.bias };

async function extract(role: 'node' | 'client'): Promise<Row[]> {
  const rows: Row[] = [];
  if (role === 'node') {
    const { embedText, loadMiniLm } = await import(
      '../../lib/evaluation/semantic/minilmEmbeddings'
    );
    await loadMiniLm();
    for (const text of RUNTIME_PARITY_FIXTURES) {
      if (isDeterministicInvalid(text)) {
        rows.push({ text, p: null, status: 'INVALID', embedding: null });
        continue;
      }
      const embedding = await embedText(text);
      const p = predictProbability(model, embedding);
      rows.push({ text, p, status: mapProbabilityToStatus(p), embedding });
    }
  } else {
    const { embedTextClient, loadClientMiniLm } = await import(
      '../../lib/evaluation/minilmClient'
    );
    await loadClientMiniLm();
    for (const text of RUNTIME_PARITY_FIXTURES) {
      if (isDeterministicInvalid(text)) {
        rows.push({ text, p: null, status: 'INVALID', embedding: null });
        continue;
      }
      const embedding = await embedTextClient(text);
      const p = predictProbability(model, embedding);
      rows.push({ text, p, status: mapProbabilityToStatus(p), embedding });
    }
  }
  return rows;
}

function runChild(role: 'node' | 'client'): Row[] {
  const outPath = join(tmpdir(), `bettr-fixture-parity-${role}.json`);
  const result = spawnSync(
    process.execPath,
    [__filename, `--extract-${role}`, `--out=${outPath}`],
    { encoding: 'utf8', cwd: process.cwd(), maxBuffer: 8 * 1024 * 1024 }
  );
  if (result.status !== 0) {
    throw new Error(`${role} extract failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(readFileSync(outPath, 'utf8')) as Row[];
}

function argValue(prefix: string) {
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : '';
}

async function compare() {
  if (probe.evaluator !== 'candidate-developmental-3a.2') {
    throw new Error('Parity fixtures must use 3A.2');
  }
  const nodeRows = runChild('node');
  const clientRows = runChild('client');
  const disagreements: Array<{ text: string; node: string; client: string; pNode: number | null; pClient: number | null }> = [];
  let maxAbsP = 0;
  let maxAbsEmb = 0;

  for (let i = 0; i < nodeRows.length; i++) {
    const node = nodeRows[i];
    const client = clientRows[i];
    if (node.status !== client.status) {
      disagreements.push({
        text: node.text,
        node: node.status,
        client: client.status,
        pNode: node.p,
        pClient: client.p,
      });
    }
    if (node.p !== null && client.p !== null) {
      maxAbsP = Math.max(maxAbsP, Math.abs(node.p - client.p));
    }
    if (node.embedding && client.embedding) {
      for (let j = 0; j < node.embedding.length; j++) {
        maxAbsEmb = Math.max(maxAbsEmb, Math.abs(node.embedding[j] - client.embedding[j]));
      }
    }
  }

  const existingFrozen = (() => {
    try {
      return JSON.parse(readFileSync(FROZEN_PATH, 'utf8')) as {
        rows: Array<{ text: string; p: number | null; status: string }>;
      };
    } catch {
      return null;
    }
  })();

  const freezeMismatches: Array<{ text: string; frozen?: string; node: string; pFrozen: number | null; pNode: number | null }> = [];
  if (existingFrozen) {
    for (const node of nodeRows) {
      const frozenRow = existingFrozen.rows.find((row) => row.text === node.text);
      if (!frozenRow || frozenRow.status !== node.status) {
        freezeMismatches.push({
          text: node.text,
          frozen: frozenRow?.status,
          node: node.status,
          pFrozen: frozenRow?.p ?? null,
          pNode: node.p,
        });
      } else if (frozenRow.p !== null && node.p !== null && Math.abs(frozenRow.p - node.p) > MAX_ABS_P) {
        freezeMismatches.push({
          text: node.text,
          frozen: frozenRow.status,
          node: node.status,
          pFrozen: frozenRow.p,
          pNode: node.p,
        });
      }
    }
  } else {
    mkdirSync(join(process.cwd(), 'benchmarks/semantic/results'), { recursive: true });
    writeFileSync(
      FROZEN_PATH,
      JSON.stringify(
        {
          evaluator: 'candidate-developmental-3a.2',
          modelId: 'Xenova/all-MiniLM-L6-v2',
          quantization: 'int8-onnx',
          pooling: 'mean',
          normalize: true,
          embeddingDim: 384,
          thresholds: { nonMax: 0.45, devMin: 0.55 },
          tolerance: { maxAbsP: MAX_ABS_P, maxAbsEmb: MAX_ABS_EMB },
          rows: nodeRows.map((row) => ({
            text: row.text,
            p: row.p,
            status: row.status,
          })),
        },
        null,
        2
      )
    );
  }

  const pass =
    disagreements.length === 0 &&
    freezeMismatches.length === 0 &&
    maxAbsP <= MAX_ABS_P &&
    maxAbsEmb <= MAX_ABS_EMB;

  const report = {
    n: nodeRows.length,
    maxAbsP,
    maxAbsEmb,
    disagreements,
    freezeMismatches,
    nearBoundary: nodeRows.filter(
      (row) =>
        row.p !== null &&
        (Math.abs(row.p - 0.45) <= 0.02 || Math.abs(row.p - 0.55) <= 0.02)
    ).map((row) => ({ text: row.text, p: row.p, status: row.status })),
    pass,
    frozenPath: FROZEN_PATH,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!pass) process.exit(2);
}

async function main() {
  const extractNode = process.argv.includes('--extract-node');
  const extractClient = process.argv.includes('--extract-client');
  const outPath = argValue('--out=');
  if (extractNode) {
    writeFileSync(outPath, JSON.stringify(await extract('node')));
    return;
  }
  if (extractClient) {
    writeFileSync(outPath, JSON.stringify(await extract('client')));
    return;
  }
  await compare();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
