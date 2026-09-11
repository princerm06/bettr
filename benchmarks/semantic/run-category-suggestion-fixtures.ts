/**
 * Non-sealed development fixtures for advisory category suggestions.
 * Not Semantic Benchmark v1. Does not score Candidate #3A.2.
 */
import assert from 'assert';
import {
  CATEGORY_SUGGESTION_KEYWORD_MIN_SIMILARITY,
  CATEGORY_SUGGESTION_MIN_SIMILARITY,
  chunkSemanticConcepts,
  ensureCategoryPrototypeEmbeddings,
  keywordCategoryMatches,
  MAX_CATEGORY_SUGGESTIONS,
  rankHybridCategorySuggestions,
  scoreCategorySuggestions,
  suggestCategoriesHybrid,
} from '../../lib/evaluation/categorySemanticSuggestions';
import { embedTexts, loadMiniLm } from '../../lib/evaluation/semantic/minilmEmbeddings';
import { CATEGORY_SUGGESTION_FIXTURES } from './categorySuggestionFixtures';
import type { CategoryKey } from '../../lib/evaluation/legacyEvaluator';

const ROBUSTNESS_FOCUS: CategoryKey[] = ['appearance', 'fashion', 'nutrition'];

function cosine(a: number[], b: number[]) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

async function robustnessBreakdown(text: string) {
  const chunks = chunkSemanticConcepts(text);
  const prototypes = await ensureCategoryPrototypeEmbeddings(embedTexts);
  const vectors = await embedTexts(chunks);
  const keywords = keywordCategoryMatches(text, '');
  const keywordSet = new Set(keywords);

  return {
    chunks,
    keywordHits: keywords.filter((key) => ROBUSTNESS_FOCUS.includes(key)),
    categories: ROBUSTNESS_FOCUS.map((key) => {
      const perChunk = chunks.map((chunk, index) => ({
        chunk,
        similarity: Number(cosine(vectors[index], prototypes[key]).toFixed(4)),
      }));
      return {
        key,
        keyword: keywordSet.has(key),
        bestSimilarity: Number(Math.max(...perChunk.map((row) => row.similarity)).toFixed(4)),
        perChunk,
      };
    }),
  };
}

async function main() {
  await loadMiniLm();

  const walmartChunks = chunkSemanticConcepts(
    'Went to Walmart and bought skincare and a new suit'
  );
  assert.ok(walmartChunks[0] === 'Went to Walmart and bought skincare and a new suit');
  assert.ok(walmartChunks.some((chunk) => /skincare/i.test(chunk)));
  assert.ok(walmartChunks.some((chunk) => /suit/i.test(chunk)));

  const rows = [];
  const failures: string[] = [];

  for (const fixture of CATEGORY_SUGGESTION_FIXTURES) {
    const scores = await scoreCategorySuggestions({
      activity: fixture.text,
      details: '',
      embedMany: embedTexts,
    });
    const suggested = rankHybridCategorySuggestions({
      scores,
      selected: fixture.selected || [],
    });
    const viaHelper = await suggestCategoriesHybrid({
      activity: fixture.text,
      details: '',
      selected: fixture.selected || [],
      embedMany: embedTexts,
    });
    assert.deepEqual(viaHelper, suggested);
    assert.ok(suggested.length <= MAX_CATEGORY_SUGGESTIONS);
    assert.equal(new Set(suggested).size, suggested.length);

    for (const key of fixture.mustInclude || []) {
      if (!suggested.includes(key)) {
        failures.push(`${fixture.id}: missing ${key} in [${suggested.join(', ')}]`);
      }
    }
    for (const key of fixture.mustExclude || []) {
      if (suggested.includes(key)) {
        failures.push(`${fixture.id}: unexpected ${key} in [${suggested.join(', ')}]`);
      }
    }

    rows.push({
      id: fixture.id,
      text: fixture.text,
      selected: fixture.selected || [],
      suggested,
      topScores: [...scores]
        .sort((a, b) => b.rankScore - a.rankScore)
        .slice(0, 5)
        .map((row) => ({
          key: row.key,
          similarity: Number(row.similarity.toFixed(4)),
          keyword: row.keyword,
          rankScore: Number(row.rankScore.toFixed(4)),
        })),
    });
  }

  const walmart = rows.find((row) => row.id === 'M1');
  const robustnessIds = ['R-A', 'R-B', 'R-C', 'R-D', 'R-E', 'R-F', 'R-G', 'R-H', 'R-I'];
  const robustness = [];
  for (const id of robustnessIds) {
    const fixture = CATEGORY_SUGGESTION_FIXTURES.find((item) => item.id === id);
    const summary = rows.find((row) => row.id === id);
    if (!fixture || !summary) continue;
    robustness.push({
      id,
      text: fixture.text,
      suggested: summary.suggested,
      breakdown: await robustnessBreakdown(fixture.text),
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: failures.length === 0,
        heuristic: {
          minSimilarity: CATEGORY_SUGGESTION_MIN_SIMILARITY,
          keywordMinSimilarity: CATEGORY_SUGGESTION_KEYWORD_MIN_SIMILARITY,
          note: 'Product UX heuristic, not a calibrated probability.',
        },
        walmart: {
          text: walmart?.text,
          chunks: walmartChunks,
          suggested: walmart?.suggested,
          topScores: walmart?.topScores,
        },
        robustness,
        failures,
        rows,
      },
      null,
      2
    )
  );

  if (failures.length) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
