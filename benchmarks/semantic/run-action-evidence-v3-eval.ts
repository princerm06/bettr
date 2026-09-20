/**
 * Isolated AE v2 vs AE v3 comparison. Does not load v3 into production.
 */
import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  mapActionProbabilityToBand,
  ACTION_EVIDENCE_CONFIDENT_NEGATIVE as TNEG,
  ACTION_EVIDENCE_CONFIDENT_POSITIVE as TPOS,
} from '../../lib/evaluation/actionEvidence';
import { embedTextMpnet, loadClientMpnet } from '../../lib/evaluation/mpnetClient';
import { predictProbability, type LogisticModel } from '../../lib/evaluation/semantic/logisticRegression';
import { PROTECTED_CONTROLS } from './datasets/action-evidence-v1/exam-controls';
import type { ActionEvidenceExample } from './datasets/action-evidence-v1/schema';

type Probe = {
  evaluator: string;
  weights: number[];
  bias: number;
  trainCount: number;
  uncertainBand: { tNeg: number; tPos: number };
};

const GOLD_POS_UNCERTAIN_V2 = [
  'Did the rotator-cuff band circuit my PT wrote down.',
  'Read the lemma and restated it in my own words before the quiz.',
  'Rewrote two bullets on my portfolio case study.',
  'Practiced my opener and used it in a coffee chat.',
  'Completed five discrete-math practice proofs.',
  'Read the assigned passage and wrote a short reflection.',
  'Practiced pairing belts and shoes I already own until two combinations looked intentional.',
  'Updated the project README and linked it on my job profile.',
  'I stood at the bathroom sink and inspected my hairline in the glass.',
  'Ran the Spanish verb cards until I could say the irregulars aloud.',
  'I wrote a one-page recap of the argument and marked what I would change.',
  'I inspected the name badge and pinned it level on the lapel.',
  'Archived the three unread client threads after answering each one.',
];

const EMPTY_COLLISIONS = [
  'Got it done. No specifics.',
  'I looked finished. No adjustment.',
  'Made progress.',
  'The setup looked correct. No assembly.',
  'Insight arrived. I did nothing.',
  'Clarity found me. No practice.',
  'It already worked. I was finished by existing.',
  'I have entered deep focus. No technique.',
];

const GOLD_NEG_POS_BAND_V2 = ['Closed the whole slate.', "Did the work. That's the post."];

const PRODUCT_PROBES = [
  'Completed my CS homework',
  '182 Homework\nCompleted my CS homework',
  'Completed CS 182 homework',
  'Completed five CS 182 homework problems',
  'Finished a 90-minute CS 182 problem set',
  'school stuff',
  'Did school things',
  'worked on stuff',
  'productive day',
  'I learned pointer arithmetic',
  'Got it done. No specifics.',
  'I did nothing.',
  'Clarity found me. No practice.',
  'Insight arrived. I did nothing.',
  'I never practiced.',
];

function loadJsonl(path: string): ActionEvidenceExample[] {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ActionEvidenceExample);
}

function loadProbe(rel: string): Probe {
  return JSON.parse(readFileSync(join(process.cwd(), rel), 'utf8')) as Probe;
}

function score(model: LogisticModel, z: number[]) {
  const pAction = predictProbability(model, z);
  return { pAction, band: mapActionProbabilityToBand(pAction) };
}

function fingerprint(probe: Probe) {
  return createHash('sha256')
    .update(JSON.stringify({ weights: probe.weights, bias: probe.bias }))
    .digest('hex');
}

function bandConf(rows: { label: string; band: string }[]) {
  const binary = rows.filter((r) => r.label === 'ACTION_POSITIVE' || r.label === 'ACTION_NEGATIVE');
  const cell = {
    goldPos_confidentPos: 0,
    goldPos_uncertain: 0,
    goldPos_confidentNeg: 0,
    goldNeg_confidentPos: 0,
    goldNeg_uncertain: 0,
    goldNeg_confidentNeg: 0,
  };
  for (const r of binary) {
    if (r.label === 'ACTION_POSITIVE' && r.band === 'CONFIDENT_ACTION_POSITIVE') cell.goldPos_confidentPos += 1;
    if (r.label === 'ACTION_POSITIVE' && r.band === 'ACTION_UNCERTAIN') cell.goldPos_uncertain += 1;
    if (r.label === 'ACTION_POSITIVE' && r.band === 'CONFIDENT_ACTION_NEGATIVE') cell.goldPos_confidentNeg += 1;
    if (r.label === 'ACTION_NEGATIVE' && r.band === 'CONFIDENT_ACTION_POSITIVE') cell.goldNeg_confidentPos += 1;
    if (r.label === 'ACTION_NEGATIVE' && r.band === 'ACTION_UNCERTAIN') cell.goldNeg_uncertain += 1;
    if (r.label === 'ACTION_NEGATIVE' && r.band === 'CONFIDENT_ACTION_NEGATIVE') cell.goldNeg_confidentNeg += 1;
  }
  return { nBinary: binary.length, ...cell };
}

async function main() {
  const v2Probe = loadProbe('lib/evaluation/semantic/weights/action-evidence-mpnet.json');
  const v3Probe = loadProbe('lib/evaluation/semantic/weights/action-evidence-mpnet-v3.json');
  if (v2Probe.evaluator !== 'candidate-action-evidence-mpnet') {
    throw new Error('Production v2 probe identity changed.');
  }
  if (v3Probe.evaluator !== 'candidate-action-evidence-mpnet-v3') {
    throw new Error('v3 probe identity mismatch.');
  }
  if (
    v2Probe.uncertainBand.tNeg !== TNEG ||
    v2Probe.uncertainBand.tPos !== TPOS ||
    v3Probe.uncertainBand.tNeg !== TNEG ||
    v3Probe.uncertainBand.tPos !== TPOS
  ) {
    throw new Error('Band thresholds must stay frozen at 0.4407 / 0.6165.');
  }

  const v2Model: LogisticModel = { weights: v2Probe.weights, bias: v2Probe.bias };
  const v3Model: LogisticModel = { weights: v3Probe.weights, bias: v3Probe.bias };

  const corpus = loadJsonl(
    join(process.cwd(), 'benchmarks/semantic/datasets/action-evidence-v3/action-evidence-v3.jsonl')
  );
  const v2Rows = corpus.filter((r) => !String(r.id).startsWith('AE3-'));

  await loadClientMpnet();
  const cache = new Map<string, number[]>();
  async function vec(text: string) {
    const hit = cache.get(text);
    if (hit) return hit;
    const z = await embedTextMpnet(text);
    cache.set(text, z);
    return z;
  }

  async function pair(text: string) {
    const z = await vec(text);
    return { v2: score(v2Model, z), v3: score(v3Model, z) };
  }

  type Scored = ActionEvidenceExample & { pAction: number; band: ReturnType<typeof mapActionProbabilityToBand> };
  const scoredV2: Scored[] = [];
  const scoredV3: Scored[] = [];
  for (const row of v2Rows) {
    const p = await pair(row.text);
    scoredV2.push({ ...row, ...p.v2 });
    scoredV3.push({ ...row, ...p.v3 });
  }

  function splitRows(scored: typeof scoredV2, split: string) {
    return scored.filter((r) => r.split === split).map((r) => ({ label: r.label, band: r.band }));
  }

  const goldPosUncertain = [];
  for (const text of GOLD_POS_UNCERTAIN_V2) {
    const row = v2Rows.find((r) => r.text === text);
    const p = await pair(text);
    goldPosUncertain.push({
      id: row?.id,
      text,
      gold: row?.label,
      intent: row?.developmentalIntent,
      split: row?.split,
      v2: { pAction: +p.v2.pAction.toFixed(6), band: p.v2.band },
      v3: { pAction: +p.v3.pAction.toFixed(6), band: p.v3.band },
      recovered: p.v2.band === 'ACTION_UNCERTAIN' && p.v3.band === 'CONFIDENT_ACTION_POSITIVE',
    });
  }

  const emptyCollisions = [];
  for (const text of EMPTY_COLLISIONS) {
    const row = v2Rows.find((r) => r.text === text);
    const p = await pair(text);
    emptyCollisions.push({
      id: row?.id,
      text,
      gold: row?.label,
      intent: row?.developmentalIntent,
      v2: { pAction: +p.v2.pAction.toFixed(6), band: p.v2.band },
      v3: { pAction: +p.v3.pAction.toFixed(6), band: p.v3.band },
      becamePositive: p.v3.band === 'CONFIDENT_ACTION_POSITIVE',
      movedTowardNegative: p.v3.pAction < p.v2.pAction,
    });
  }

  const existingFp = [];
  for (const text of GOLD_NEG_POS_BAND_V2) {
    const row = v2Rows.find((r) => r.text === text);
    const p = await pair(text);
    existingFp.push({
      id: row?.id,
      text,
      gold: row?.label,
      v2: { pAction: +p.v2.pAction.toFixed(6), band: p.v2.band },
      v3: { pAction: +p.v3.pAction.toFixed(6), band: p.v3.band },
      corrected: p.v2.band === 'CONFIDENT_ACTION_POSITIVE' && p.v3.band !== 'CONFIDENT_ACTION_POSITIVE',
    });
  }

  const protectedRows = [];
  for (const c of PROTECTED_CONTROLS) {
    const p = await pair(c.text);
    protectedRows.push({
      id: c.id,
      expected: c.expected,
      v2: { pAction: +p.v2.pAction.toFixed(6), band: p.v2.band },
      v3: { pAction: +p.v3.pAction.toFixed(6), band: p.v3.band },
      v2Match:
        (c.expected === 'ACTION_POSITIVE' && p.v2.band !== 'CONFIDENT_ACTION_NEGATIVE') ||
        (c.expected === 'ACTION_NEGATIVE' && p.v2.band !== 'CONFIDENT_ACTION_POSITIVE'),
      v3Match:
        (c.expected === 'ACTION_POSITIVE' && p.v3.band !== 'CONFIDENT_ACTION_NEGATIVE') ||
        (c.expected === 'ACTION_NEGATIVE' && p.v3.band !== 'CONFIDENT_ACTION_POSITIVE'),
      v3ConfidentWrong:
        (c.expected === 'ACTION_NEGATIVE' && p.v3.band === 'CONFIDENT_ACTION_POSITIVE') ||
        (c.expected === 'ACTION_POSITIVE' && p.v3.band === 'CONFIDENT_ACTION_NEGATIVE'),
    });
  }

  const probes = [];
  for (const text of PRODUCT_PROBES) {
    const p = await pair(text);
    probes.push({
      text,
      v2: { pAction: +p.v2.pAction.toFixed(6), band: p.v2.band },
      v3: { pAction: +p.v3.pAction.toFixed(6), band: p.v3.band },
    });
  }

  const v2Pos = new Set(
    scoredV2.filter((r) => r.label === 'ACTION_NEGATIVE' && r.band === 'CONFIDENT_ACTION_POSITIVE').map((r) => r.id)
  );
  const v3Pos = new Set(
    scoredV3.filter((r) => r.label === 'ACTION_NEGATIVE' && r.band === 'CONFIDENT_ACTION_POSITIVE').map((r) => r.id)
  );
  const v2Neg = new Set(
    scoredV2.filter((r) => r.label === 'ACTION_POSITIVE' && r.band === 'CONFIDENT_ACTION_NEGATIVE').map((r) => r.id)
  );
  const v3Neg = new Set(
    scoredV3.filter((r) => r.label === 'ACTION_POSITIVE' && r.band === 'CONFIDENT_ACTION_NEGATIVE').map((r) => r.id)
  );

  const newFp = scoredV3.filter(
    (r) => r.label === 'ACTION_NEGATIVE' && r.band === 'CONFIDENT_ACTION_POSITIVE' && !v2Pos.has(r.id)
  );
  const newFn = scoredV3.filter(
    (r) => r.label === 'ACTION_POSITIVE' && r.band === 'CONFIDENT_ACTION_NEGATIVE' && !v2Neg.has(r.id)
  );
  const recoveredPos = goldPosUncertain.filter((r) => r.recovered).length;

  const report = {
    identity: {
      v2Evaluator: v2Probe.evaluator,
      v3Evaluator: v3Probe.evaluator,
      v2Fingerprint: fingerprint(v2Probe),
      v3Fingerprint: fingerprint(v3Probe),
      v2TrainCount: v2Probe.trainCount,
      v3TrainCount: v3Probe.trainCount,
      tNeg: TNEG,
      tPos: TPOS,
      productionUnchanged: fingerprint(v2Probe) === '72c03aa4638160895cd0bc7d6bf06b1b2914f226208aad82a3ccfe01ccbe657a',
    },
    train: {
      v2: bandConf(splitRows(scoredV2, 'train')),
      v3: bandConf(splitRows(scoredV3, 'train')),
    },
    val: {
      v2: bandConf(splitRows(scoredV2, 'val')),
      v3: bandConf(splitRows(scoredV3, 'val')),
    },
    exam: {
      v2: bandConf(splitRows(scoredV2, 'exam')),
      v3: bandConf(splitRows(scoredV3, 'exam')),
    },
    recoveredGoldPosUncertain: `${recoveredPos}/13`,
    existingGoldNegConfidentPosCorrected: existingFp.filter((r) => r.corrected).length,
    newFalsePositiveConfidentActions: newFp.map((r) => ({ id: r.id, text: r.text, pAction: +r.pAction.toFixed(6) })),
    newFalseNegativeConfidentNonActions: newFn.map((r) => ({ id: r.id, text: r.text, pAction: +r.pAction.toFixed(6) })),
    goldPosUncertain,
    emptyCollisions,
    existingGoldNegConfidentPos: existingFp,
    protectedControls: protectedRows,
    productProbes: probes,
  };

  const outPath = join(process.cwd(), 'benchmarks/semantic/results/action-evidence-v3-eval.json');
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  console.log(`wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
