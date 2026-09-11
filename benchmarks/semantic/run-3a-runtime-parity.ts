/**
 * Portability check: trusted Node INT8 MiniLM vs browser-safe MiniLM,
 * same 3A.2 probe and NARROW band. Not a model-selection experiment.
 *
 * Child processes isolate @xenova/transformers `env` so Node cacheDir
 * does not leak into the client-loader process.
 */
import { spawnSync } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { DevelopmentalExample } from './datasets/developmental-v1/schema';
import { mapProbabilityToStatus } from '../../lib/evaluation/developmentalProductPolicy';
import { productProbeIdentity } from '../../lib/evaluation/developmentalGate';
import { predictProbability } from '../../lib/evaluation/semantic/logisticRegression';
import probeFile from '../../lib/evaluation/semantic/weights/developmental-3a.2.json';

const DATASET_PATH = join(
  process.cwd(),
  'benchmarks/semantic/datasets/developmental-v1/developmental-v1.jsonl'
);
const OUT_PATH = join(
  process.cwd(),
  'benchmarks/semantic/results/developmental-3a-runtime-parity.json'
);

const MAX_STATE_DISAGREE_RATE = 0.02;
const BOUNDARY_EPS = 0.02;

type ProbeFile = {
  evaluator: string;
  weights: number[];
  bias: number;
};

type ExtractRow = { id: string; embedding: number[]; p: number };

const probe = probeFile as ProbeFile;
const model = { weights: probe.weights, bias: probe.bias };

function cosine(a: number[], b: number[]) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function loadCoreRows() {
  const rows = readFileSync(DATASET_PATH, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as DevelopmentalExample)
    .filter(
      (r) =>
        r.role === 'core_trainable' &&
        r.split === 'train' &&
        (r.label === 'DEVELOPMENTAL' || r.label === 'NON_DEVELOPMENTAL')
    );
  if (rows.length !== 405) throw new Error(`Expected 405 texts, got ${rows.length}`);
  return rows;
}

async function extractRole(role: 'node' | 'client', outPath: string) {
  const rows = loadCoreRows();
  if (probe.evaluator !== 'candidate-developmental-3a.2') {
    throw new Error('Parity must use 3A.2 weights.');
  }
  const out: ExtractRow[] = [];
  if (role === 'node') {
    const { embedText, loadMiniLm } = await import(
      '../../lib/evaluation/semantic/minilmEmbeddings'
    );
    await loadMiniLm();
    for (const row of rows) {
      const embedding = await embedText(row.text);
      out.push({ id: row.id, embedding, p: predictProbability(model, embedding) });
    }
  } else {
    const { embedTextClient, loadClientMiniLm } = await import(
      '../../lib/evaluation/minilmClient'
    );
    await loadClientMiniLm();
    for (const row of rows) {
      const embedding = await embedTextClient(row.text);
      out.push({ id: row.id, embedding, p: predictProbability(model, embedding) });
    }
  }
  writeFileSync(outPath, JSON.stringify(out));
}

function runChild(role: 'node' | 'client'): ExtractRow[] {
  const outPath = join(tmpdir(), `bettr-3a-parity-${role}.json`);
  const result = spawnSync(
    process.execPath,
    [__filename, `--extract-${role}`, `--out=${outPath}`],
    {
      encoding: 'utf8',
      cwd: process.cwd(),
      maxBuffer: 8 * 1024 * 1024,
    }
  );
  if (result.status !== 0) {
    throw new Error(
      `${role} extract failed (${result.status}): ${result.stderr || result.stdout}`
    );
  }
  return JSON.parse(readFileSync(outPath, 'utf8')) as ExtractRow[];
}

async function compare() {
  if (probe.evaluator !== 'candidate-developmental-3a.2') {
    throw new Error('Parity must use 3A.2 weights.');
  }

  const rows = loadCoreRows();
  const nodeRows = runChild('node');
  const clientRows = runChild('client');
  if (nodeRows.length !== 405 || clientRows.length !== 405) {
    throw new Error('Extract length mismatch.');
  }

  const clientById = new Map(clientRows.map((r) => [r.id, r]));
  const absP: number[] = [];
  const absEmbMax: number[] = [];
  const cosineGaps: number[] = [];
  const disagreements: Array<{
    id: string;
    text: string;
    pNode: number;
    pClient: number;
    stateNode: string;
    stateClient: string;
    near045: boolean;
    near055: boolean;
  }> = [];

  for (const node of nodeRows) {
    const client = clientById.get(node.id);
    if (!client) throw new Error(`Missing client row ${node.id}`);
    const row = rows.find((r) => r.id === node.id);
    if (!row) throw new Error(`Missing dataset row ${node.id}`);

    absP.push(Math.abs(node.p - client.p));
    let maxAbsEmb = 0;
    for (let i = 0; i < node.embedding.length; i++) {
      maxAbsEmb = Math.max(maxAbsEmb, Math.abs(node.embedding[i] - client.embedding[i]));
    }
    absEmbMax.push(maxAbsEmb);
    cosineGaps.push(1 - cosine(node.embedding, client.embedding));

    const stateNode = mapProbabilityToStatus(node.p);
    const stateClient = mapProbabilityToStatus(client.p);
    if (stateNode !== stateClient) {
      disagreements.push({
        id: node.id,
        text: row.text,
        pNode: node.p,
        pClient: client.p,
        stateNode,
        stateClient,
        near045:
          Math.abs(node.p - 0.45) <= BOUNDARY_EPS || Math.abs(client.p - 0.45) <= BOUNDARY_EPS,
        near055:
          Math.abs(node.p - 0.55) <= BOUNDARY_EPS || Math.abs(client.p - 0.55) <= BOUNDARY_EPS,
      });
    }
  }

  const disagreeRate = disagreements.length / rows.length;
  const pass = disagreeRate <= MAX_STATE_DISAGREE_RATE;
  const near045 = disagreements.filter((d) => d.near045);
  const near055 = disagreements.filter((d) => d.near055);
  const interior = disagreements.filter((d) => !d.near045 && !d.near055);

  const report = {
    evaluator: 'developmental-3a-runtime-parity',
    n: rows.length,
    probe: productProbeIdentity(),
    trustedPath: 'lib/evaluation/semantic/minilmEmbeddings.ts (Node cacheDir)',
    clientPath: 'lib/evaluation/minilmClient.ts (no process.cwd)',
    isolation: 'separate child processes so transformers env is not shared',
    meanAbsP: Number((absP.reduce((a, b) => a + b, 0) / absP.length).toFixed(8)),
    medianAbsP: Number(median(absP).toFixed(8)),
    maxAbsP: Number(Math.max(...absP).toFixed(8)),
    meanMaxAbsEmbedding: Number((absEmbMax.reduce((a, b) => a + b, 0) / absEmbMax.length).toFixed(8)),
    maxAbsEmbedding: Number(Math.max(...absEmbMax).toFixed(8)),
    meanEmbeddingCosineGap: Number((cosineGaps.reduce((a, b) => a + b, 0) / cosineGaps.length).toFixed(8)),
    maxEmbeddingCosineGap: Number(Math.max(...cosineGaps).toFixed(8)),
    stateDisagreements: disagreements.length,
    stateDisagreeRate: Number(disagreeRate.toFixed(6)),
    disagreementsNear045: near045.length,
    disagreementsNear055: near055.length,
    interiorDisagreements: interior.length,
    disagreements,
    portability: {
      rule: 'STOP if state disagreement rate > 2%',
      pass,
      decision: pass ? 'PASS' : 'STOP',
    },
  };

  mkdirSync(join(process.cwd(), 'benchmarks/semantic/results'), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!pass) process.exit(2);
}

function argValue(prefix: string) {
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : '';
}

async function main() {
  const extractNode = process.argv.includes('--extract-node');
  const extractClient = process.argv.includes('--extract-client');
  const outPath = argValue('--out=');
  if (extractNode && extractClient) {
    throw new Error('Choose one extract role.');
  }
  if (extractNode) {
    if (!outPath) throw new Error('Missing --out');
    await extractRole('node', outPath);
    return;
  }
  if (extractClient) {
    if (!outPath) throw new Error('Missing --out');
    await extractRole('client', outPath);
    return;
  }
  await compare();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
