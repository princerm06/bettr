/**
 * High-confidence category mismatch guard for custom logs.
 * Advisory 0.30 suggestion heuristic is separate and frozen.
 * This is not a classifier and does not use Candidate #3A.2.
 */
import type { CategoryKey } from './legacyEvaluator';
import {
  scoreCategorySimilarities,
  type CategorySuggestionScore,
  type EmbedMany,
} from './categorySemanticSuggestions';

/** Selected-side weakness. Not the advisory 0.30 suggestion cutoff. */
export const MISMATCH_SELECTED_MAX = 0.2;
/** Alternative must be clearly stronger than a weak selected category. */
export const MISMATCH_ALTERNATIVE_MIN = 0.24;
export const MISMATCH_MARGIN = 0.08;

export type CategoryMismatchVerdict =
  | { mismatch: false }
  | {
      mismatch: true;
      selectedKey: CategoryKey;
      alternativeKey: CategoryKey;
    };

function bestRow(rows: CategorySuggestionScore[]) {
  return rows.reduce((best, row) =>
    !best || row.similarity > best.similarity ? row : best
  , rows[0]);
}

export function detectObviousCategoryMismatch(
  scores: CategorySuggestionScore[],
  selected: CategoryKey[]
): CategoryMismatchVerdict {
  if (!selected.length || !scores.length) return { mismatch: false };

  const selectedSet = new Set(selected);
  const selectedRows = scores.filter((row) => selectedSet.has(row.key));
  const alternativeRows = scores.filter((row) => !selectedSet.has(row.key));
  if (!selectedRows.length || !alternativeRows.length) return { mismatch: false };

  const bestSelected = bestRow(selectedRows);
  const bestAlternative = bestRow(alternativeRows);
  if (
    bestSelected.similarity >= MISMATCH_SELECTED_MAX ||
    bestAlternative.similarity < MISMATCH_ALTERNATIVE_MIN ||
    bestAlternative.similarity - bestSelected.similarity < MISMATCH_MARGIN
  ) {
    return { mismatch: false };
  }

  return {
    mismatch: true,
    selectedKey: selected[0],
    alternativeKey: bestAlternative.key,
  };
}

export async function evaluateObviousCategoryMismatch(options: {
  text: string;
  selected: CategoryKey[];
  embedMany: EmbedMany;
}): Promise<CategoryMismatchVerdict> {
  const scores = await scoreCategorySimilarities(options.text, options.embedMany);
  return detectObviousCategoryMismatch(scores, options.selected);
}
