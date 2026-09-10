import { writeFileSync } from 'fs';
import { join } from 'path';
import { SEMANTIC_BENCHMARK_V1 } from '../../v1';
import { CORE_BUNDLES } from './core-examples-part1';
import { CORE_BUNDLES_PART2 } from './core-examples-part2';
import { CORE_BUNDLES_PART3 } from './core-examples-part3';
import { CORE_BUNDLES_PART4 } from './core-examples-part4';
import { AUX_BUNDLES } from './aux-examples';
import { ALL_FAMILY_PLANS } from './families';
import type { DevelopmentalExample } from './schema';
import { VALIDATION_FAMILY_SET } from './split';

function normalizeText(text: string) {
  return text
    .toLowerCase()
    .replace(/['’]/g, "'")
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function splitFor(familyId: string, role: DevelopmentalExample['role']) {
  if (role !== 'core_trainable') return 'aux' as const;
  return VALIDATION_FAMILY_SET.has(familyId) ? ('val' as const) : ('train' as const);
}

const bundles = [
  ...CORE_BUNDLES,
  ...CORE_BUNDLES_PART2,
  ...CORE_BUNDLES_PART3,
  ...CORE_BUNDLES_PART4,
  ...AUX_BUNDLES,
];

const rows: DevelopmentalExample[] = [];
let n = 1;
const seenNorm = new Map<string, string>();

for (const bundle of bundles) {
  for (const text of bundle.texts) {
    const id = `DV-${String(n).padStart(4, '0')}`;
    const norm = normalizeText(text);
    if (seenNorm.has(norm)) {
      throw new Error(`Duplicate text ${id} vs ${seenNorm.get(norm)}: ${text}`);
    }
    seenNorm.set(norm, id);
    rows.push({
      id,
      text,
      label: bundle.label,
      familyId: bundle.familyId,
      contrastGroup: bundle.contrastGroup,
      domain: bundle.domain,
      role: bundle.role,
      split: splitFor(bundle.familyId, bundle.role),
    });
    n += 1;
  }
}

const v1Norm = new Set(SEMANTIC_BENCHMARK_V1.map((c) => normalizeText(c.text)));
const v1Hits = rows.filter((row) => v1Norm.has(normalizeText(row.text)));
if (v1Hits.length) {
  throw new Error(
    `Exact v1 overlap: ${v1Hits.map((row) => `${row.id} ${row.text}`).join('; ')}`
  );
}

const planned = new Map<string, number>();
for (const family of ALL_FAMILY_PLANS) {
  for (const polarity of family.polarities) {
    const key = `${family.familyId}||${polarity.label}`;
    planned.set(key, (planned.get(key) || 0) + polarity.targetCount);
  }
}
const actual = new Map<string, number>();
for (const row of rows) {
  const key = `${row.familyId}||${row.label}`;
  actual.set(key, (actual.get(key) || 0) + 1);
}

const countMismatches: string[] = [];
for (const [key, count] of planned) {
  const got = actual.get(key) || 0;
  if (got !== count) countMismatches.push(`${key}: planned ${count}, got ${got}`);
}
for (const key of actual.keys()) {
  if (!planned.has(key)) countMismatches.push(`unexpected bundle ${key}`);
}

const outPath = join(
  process.cwd(),
  'benchmarks/semantic/datasets/developmental-v1/developmental-v1.jsonl'
);
writeFileSync(outPath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');

console.log(`Wrote ${rows.length} rows to ${outPath}`);
if (countMismatches.length) {
  console.log('Count mismatches vs family inventory:');
  for (const line of countMismatches) console.log(' -', line);
  process.exitCode = 1;
}
