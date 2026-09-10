import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { SEMANTIC_BENCHMARK_V1 } from '../../v1';
import {
  BETTR_V1_DOMAINS,
  DEVELOPMENTAL_LABELS,
  DATASET_ROLES,
  DATASET_SPLITS,
  type DevelopmentalExample,
} from './schema';
import { ALL_FAMILY_PLANS } from './families';
import { VALIDATION_FAMILY_SET } from './split';

function normalizeText(text: string) {
  return text
    .toLowerCase()
    .replace(/['’]/g, "'")
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
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

const path = join(
  process.cwd(),
  'benchmarks/semantic/datasets/developmental-v1/developmental-v1.jsonl'
);
const FIRST_PASS_PATH = join(
  process.cwd(),
  'benchmarks/semantic/datasets/developmental-v1/developmental-v1-3a.1.jsonl'
);
const NEW_TRAIN_FAMILY_IDS = [
  'craft.bike_drivetrain_vs_shop_drop',
  'craft.sink_washer_vs_new_faucet',
  'craft.ram_reseat_vs_buy_laptop',
  'finance.service_packages_vs_paypal_glance',
  'finance.scope_hours_vs_deposit_ping',
  'career.opener_used_vs_star_post',
  'physical.finishing_vs_bleachers_practiced',
  'craft.short_snare_vs_unopened_sticks',
  'academics.lemma_own_words_vs_stack_packet',
  'nutrition.proof_dough_vs_cereal_box',
  'ordinary.detailed_errand_hardneg',
  'wellbeing.named_sensations_vs_floor_scroll',
] as const;
const rows: DevelopmentalExample[] = readFileSync(path, 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as DevelopmentalExample);

const errors: string[] = [];
const ids = new Set<string>();
const texts = new Set<string>();
const norms = new Set<string>();
const v1Norm = new Map(
  SEMANTIC_BENCHMARK_V1.map((c) => [normalizeText(c.text), c.id])
);

const trainFamilies = new Set<string>();
const valFamilies = new Set<string>();

for (const row of rows) {
  if (ids.has(row.id)) errors.push(`duplicate id ${row.id}`);
  ids.add(row.id);
  if (!row.familyId) errors.push(`${row.id} missing familyId`);
  if (!DEVELOPMENTAL_LABELS.includes(row.label)) errors.push(`${row.id} bad label`);
  if (!BETTR_V1_DOMAINS.includes(row.domain)) errors.push(`${row.id} bad domain`);
  if (!DATASET_ROLES.includes(row.role)) errors.push(`${row.id} bad role`);
  if (!row.split || !DATASET_SPLITS.includes(row.split)) errors.push(`${row.id} bad split`);
  if (texts.has(row.text)) errors.push(`duplicate text ${row.id}`);
  texts.add(row.text);
  const norm = normalizeText(row.text);
  if (norms.has(norm)) errors.push(`normalized duplicate ${row.id}: ${row.text}`);
  norms.add(norm);
  const v1 = v1Norm.get(norm);
  if (v1) errors.push(`${row.id} exact v1 overlap with ${v1}`);

  if (row.role === 'core_trainable') {
    const expected = VALIDATION_FAMILY_SET.has(row.familyId) ? 'val' : 'train';
    if (row.split !== expected) errors.push(`${row.id} split mismatch`);
    if (row.label === 'UNCERTAIN') errors.push(`${row.id} UNCERTAIN in core`);
    if (row.split === 'train') trainFamilies.add(row.familyId);
    if (row.split === 'val') valFamilies.add(row.familyId);
  } else if (row.split !== 'aux') {
    errors.push(`${row.id} aux role must be split=aux`);
  }
}

for (const familyId of trainFamilies) {
  if (valFamilies.has(familyId)) errors.push(`family in train and val: ${familyId}`);
}

const inventoryFamilies = new Set(ALL_FAMILY_PLANS.map((f) => f.familyId));
for (const row of rows) {
  if (!inventoryFamilies.has(row.familyId)) errors.push(`unknown family ${row.familyId}`);
}

const core = rows.filter((r) => r.role === 'core_trainable');
const uncertain = rows.filter((r) => r.role === 'uncertain_auxiliary');
const stress = rows.filter((r) => r.role === 'stress_auxiliary');
const train = core.filter((r) => r.split === 'train');
const val = core.filter((r) => r.split === 'val');

function byLabel(list: DevelopmentalExample[]) {
  const out: Record<string, number> = {};
  for (const row of list) out[row.label] = (out[row.label] || 0) + 1;
  return out;
}
function byDomain(list: DevelopmentalExample[]) {
  const out: Record<string, number> = {};
  for (const row of list) out[row.domain] = (out[row.domain] || 0) + 1;
  return out;
}
function lengths(list: DevelopmentalExample[]) {
  const lens = list.map((r) => r.text.length);
  return {
    n: lens.length,
    min: Math.min(...lens),
    max: Math.max(...lens),
    mean: Number(mean(lens).toFixed(1)),
    median: median(lens),
  };
}

const short = rows.filter((r) => r.text.trim().split(/\s+/).length <= 2);
const long = rows.filter((r) => r.text.length >= 110);

function valFingerprint(list: DevelopmentalExample[]) {
  return list
    .filter((r) => r.role === 'core_trainable' && r.split === 'val')
    .map((r) => JSON.stringify({ id: r.id, text: r.text, label: r.label, familyId: r.familyId }))
    .join('\n');
}

function lengthByCoreLabel(list: DevelopmentalExample[]) {
  return {
    DEVELOPMENTAL: lengths(list.filter((r) => r.label === 'DEVELOPMENTAL')),
    NON_DEVELOPMENTAL: lengths(list.filter((r) => r.label === 'NON_DEVELOPMENTAL')),
  };
}

let firstPass: DevelopmentalExample[] | null = null;
if (!existsSync(FIRST_PASS_PATH)) {
  errors.push(`missing 3A.1 freeze file ${FIRST_PASS_PATH}`);
} else {
  firstPass = readFileSync(FIRST_PASS_PATH, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as DevelopmentalExample);
  const oldVal = valFingerprint(firstPass);
  const newVal = valFingerprint(rows);
  if (oldVal !== newVal) {
    errors.push('frozen validation rows are not byte-for-byte unchanged vs 3A.1 jsonl');
  }
  const oldTrainTexts = new Set(
    firstPass.filter((r) => r.split === 'train' && r.role === 'core_trainable').map((r) => r.text)
  );
  const newTrain = train.filter((r) => !oldTrainTexts.has(r.text));
  if (newTrain.some((r) => VALIDATION_FAMILY_SET.has(r.familyId))) {
    errors.push('new train row uses a frozen validation family');
  }
}

const newFamilyExamples: Record<string, string[]> = {};
for (const familyId of NEW_TRAIN_FAMILY_IDS) {
  const famRows = train.filter((r) => r.familyId === familyId);
  if (!famRows.length) errors.push(`missing new train family ${familyId}`);
  newFamilyExamples[familyId] = famRows.map((r) => `${r.label}: ${r.text}`);
}

console.log(
  JSON.stringify(
    {
      ok: errors.length === 0,
      errors,
      totals: {
        all: rows.length,
        core: core.length,
        coreDev: core.filter((r) => r.label === 'DEVELOPMENTAL').length,
        coreNon: core.filter((r) => r.label === 'NON_DEVELOPMENTAL').length,
        train: train.length,
        val: val.length,
        uncertain: uncertain.length,
        stress: stress.length,
        coreFamilies: trainFamilies.size + valFamilies.size,
        trainFamilies: trainFamilies.size,
        valFamilies: valFamilies.size,
        uncertainFamilies: new Set(uncertain.map((r) => r.familyId)).size,
        stressFamilies: new Set(stress.map((r) => r.familyId)).size,
      },
      trainLabels: byLabel(train),
      valLabels: byLabel(val),
      trainDomains: byDomain(train),
      valDomains: byDomain(val),
      lengthByLabel: {
        DEVELOPMENTAL: lengths(rows.filter((r) => r.label === 'DEVELOPMENTAL')),
        NON_DEVELOPMENTAL: lengths(
          rows.filter((r) => r.label === 'NON_DEVELOPMENTAL' && r.role === 'core_trainable')
        ),
        UNCERTAIN: lengths(uncertain),
      },
      unusuallyShort: short.map((r) => `${r.id} ${r.split} ${r.label} ${r.text}`),
      unusuallyLong: long.map((r) => `${r.id} ${r.split} ${r.label} ${r.text}`),
      candidate3a2: firstPass
        ? {
            oldTrain: firstPass.filter((r) => r.split === 'train' && r.role === 'core_trainable').length,
            newTrain: train.length,
            oldCore: firstPass.filter((r) => r.role === 'core_trainable').length,
            newCore: core.length,
            oldTrainLabels: byLabel(
              firstPass.filter((r) => r.split === 'train' && r.role === 'core_trainable')
            ),
            newTrainLabels: byLabel(train),
            oldTrainLength: lengthByCoreLabel(
              firstPass.filter((r) => r.split === 'train' && r.role === 'core_trainable')
            ),
            newTrainLength: lengthByCoreLabel(train),
            frozenValUnchanged: valFingerprint(firstPass) === valFingerprint(rows),
            newFamilyNames: NEW_TRAIN_FAMILY_IDS,
            newFamilyExamples,
          }
        : null,
    },
    null,
    2
  )
);

if (errors.length) process.exitCode = 1;
