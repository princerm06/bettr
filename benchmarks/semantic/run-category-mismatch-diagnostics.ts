/**
 * Non-sealed diagnostics for a high-confidence category mismatch guard.
 * Does not change the frozen 0.30 advisory suggestion heuristic.
 */
import { scoreCategorySimilarities } from '../../lib/evaluation/categorySemanticSuggestions';
import { embedTexts, loadMiniLm } from '../../lib/evaluation/semantic/minilmEmbeddings';
import type { CategoryKey } from '../../lib/evaluation/legacyEvaluator';

const FIXTURES: Array<{
  id: string;
  text: string;
  selected: CategoryKey[];
  kind: 'mismatch' | 'valid' | 'multi' | 'noisy';
}> = [
  { id: '1', text: 'Ran 5k', selected: ['fashion'], kind: 'mismatch' },
  { id: '2', text: 'Studied calculus for my exam', selected: ['fashion'], kind: 'mismatch' },
  { id: '3', text: 'Applied to three internships', selected: ['nutrition'], kind: 'mismatch' },
  { id: '4', text: 'Did my skincare routine', selected: ['academics'], kind: 'mismatch' },
  { id: '5', text: 'Ran 5k', selected: ['physical'], kind: 'valid' },
  { id: '6', text: 'Bought a new suit', selected: ['fashion'], kind: 'valid' },
  { id: '7', text: 'Studied calculus', selected: ['academics'], kind: 'valid' },
  { id: '8', text: 'Applied to internships', selected: ['career'], kind: 'valid' },
  { id: '9', text: 'Meal prepped to save money', selected: ['nutrition', 'finance'], kind: 'multi' },
  { id: '10', text: 'Bought a suit for interviews', selected: ['fashion', 'career'], kind: 'multi' },
  { id: '11', text: 'Journaled about my career goals', selected: ['mind', 'career'], kind: 'multi' },
  { id: '12', text: 'Bought household supplies', selected: ['finance'], kind: 'noisy' },
  { id: '13', text: 'Went shopping at Walmart', selected: ['fashion'], kind: 'noisy' },
  { id: '14', text: 'Read Catcher in the Rye', selected: ['mind'], kind: 'valid' },
  { id: '15', text: 'lowk chopped asf', selected: ['appearance'], kind: 'noisy' },
];

async function main() {
  await loadMiniLm();
  const rows = [];
  for (const fixture of FIXTURES) {
    const scores = await scoreCategorySimilarities(fixture.text, embedTexts);
    const selected = scores.filter((row) => fixture.selected.includes(row.key));
    const alternatives = scores.filter((row) => !fixture.selected.includes(row.key));
    const bestSelected = selected.reduce((best, row) =>
      !best || row.similarity > best.similarity ? row : best
    , selected[0]);
    const bestAlt = alternatives.reduce((best, row) =>
      !best || row.similarity > best.similarity ? row : best
    , alternatives[0]);
    rows.push({
      id: fixture.id,
      kind: fixture.kind,
      text: fixture.text,
      selected: fixture.selected,
      bestSelected: bestSelected
        ? { key: bestSelected.key, similarity: Number(bestSelected.similarity.toFixed(4)), keyword: bestSelected.keyword }
        : null,
      bestAlternative: bestAlt
        ? { key: bestAlt.key, similarity: Number(bestAlt.similarity.toFixed(4)), keyword: bestAlt.keyword }
        : null,
      margin: bestSelected && bestAlt
        ? Number((bestAlt.similarity - bestSelected.similarity).toFixed(4))
        : null,
      selectedScores: selected.map((row) => ({
        key: row.key,
        similarity: Number(row.similarity.toFixed(4)),
        keyword: row.keyword,
      })),
    });
  }
  console.log(JSON.stringify({ rows }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
