/**
 * Advisory category suggestions only.
 * Uses frozen MiniLM embeddings + existing keyword signals.
 * Does not use Candidate #3A.2, p_dev, XP, or persistence.
 */
import {
  categories,
  type CategoryKey,
} from './legacyEvaluator';
import { inferMatchingCategories } from './categoryComposerUx';

export const MAX_CATEGORY_SUGGESTIONS = 3;

/**
 * Product heuristic, not a calibrated probability.
 * Inspected on a small non-sealed development fixture set.
 * Semantic-only matches need a higher cosine; keyword hits still need
 * a modest similarity floor so prefix matches like "watched"→fashion
 * do not become suggestions by themselves.
 */
export const CATEGORY_SUGGESTION_MIN_SIMILARITY = 0.3;
export const CATEGORY_SUGGESTION_KEYWORD_MIN_SIMILARITY = 0.2;
export const CATEGORY_SUGGESTION_KEYWORD_BOOST = 0.04;

export const CATEGORY_PROTOTYPES: Record<CategoryKey, string> = {
  appearance:
    'skincare, grooming, hygiene, hair care, personal appearance, self-care routines',
  fashion:
    'clothing, outfits, wardrobe, personal style, shoes, accessories, dressing well',
  academics:
    'studying, homework, assignments, exams, coursework, academic learning',
  career:
    'job applications, resumes, interviews, portfolio work, professional development',
  finance:
    'budgeting, saving, investing, tracking spending, managing money',
  nutrition:
    'cooking, meal prep, nutrition, healthy eating, recipes',
  social:
    'talking with people, making friends, conversations, social plans, relationships',
  physical:
    'lifting, running, sports, workouts, exercise, athletic training',
  mind:
    'reading, journaling, practicing an instrument, coding, craft, focused skill practice',
  spirituality:
    'prayer, worship, scripture, faith practice, spiritual reflection',
};

export type EmbedMany = (texts: string[]) => Promise<number[][]>;

let prototypeEmbeddings: Record<CategoryKey, number[]> | null = null;
let prototypeLoad: Promise<Record<CategoryKey, number[]>> | null = null;

export function resetCategoryPrototypeCacheForTests() {
  prototypeEmbeddings = null;
  prototypeLoad = null;
}

export function chunkSemanticConcepts(text: string): string[] {
  const whole = text.trim().replace(/\s+/g, ' ');
  if (!whole) return [];

  const fragments = whole
    .split(/\s+(?:and|then|also)\s+|[,;]+/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 6 && part.toLowerCase() !== whole.toLowerCase());

  const chunks = [whole];
  for (const fragment of fragments) {
    if (!chunks.some((existing) => existing.toLowerCase() === fragment.toLowerCase())) {
      chunks.push(fragment);
    }
    if (chunks.length >= 5) break;
  }
  return chunks;
}

function cosine(a: number[], b: number[]) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

export async function ensureCategoryPrototypeEmbeddings(embedMany: EmbedMany) {
  if (prototypeEmbeddings) return prototypeEmbeddings;
  if (!prototypeLoad) {
    prototypeLoad = (async () => {
      const keys = categories.map((item) => item.key);
      const vectors = await embedMany(keys.map((key) => CATEGORY_PROTOTYPES[key]));
      const next = Object.fromEntries(keys.map((key, index) => [key, vectors[index]])) as Record<
        CategoryKey,
        number[]
      >;
      prototypeEmbeddings = next;
      return next;
    })().catch((err) => {
      prototypeLoad = null;
      throw err;
    });
  }
  return prototypeLoad;
}

export function keywordCategoryMatches(activity: string, details: string): CategoryKey[] {
  return inferMatchingCategories(activity, details);
}

export type CategorySuggestionScore = {
  key: CategoryKey;
  similarity: number;
  keyword: boolean;
  rankScore: number;
};

export function rankHybridCategorySuggestions(options: {
  scores: CategorySuggestionScore[];
  selected: CategoryKey[];
  minSimilarity?: number;
  keywordMinSimilarity?: number;
  limit?: number;
}): CategoryKey[] {
  const minSimilarity = options.minSimilarity ?? CATEGORY_SUGGESTION_MIN_SIMILARITY;
  const keywordMinSimilarity =
    options.keywordMinSimilarity ?? CATEGORY_SUGGESTION_KEYWORD_MIN_SIMILARITY;
  const limit = options.limit ?? MAX_CATEGORY_SUGGESTIONS;
  const selected = new Set(options.selected);

  return options.scores
    .filter((row) => !selected.has(row.key))
    .filter((row) =>
      row.similarity >= minSimilarity ||
      (row.keyword && row.similarity >= keywordMinSimilarity)
    )
    .sort((a, b) => {
      if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
      return categories.findIndex((item) => item.key === a.key) - categories.findIndex((item) => item.key === b.key);
    })
    .slice(0, limit)
    .map((row) => row.key);
}

export async function scoreCategorySimilarities(
  text: string,
  embedMany: EmbedMany
): Promise<CategorySuggestionScore[]> {
  const compact = text.trim().replace(/\s+/g, ' ');
  if (!compact) return [];

  const prototypes = await ensureCategoryPrototypeEmbeddings(embedMany);
  const chunks = chunkSemanticConcepts(compact);
  const embeddings = await embedMany(chunks);
  const keywords = new Set(keywordCategoryMatches(compact, ''));

  return categories.map((item) => {
    const prototype = prototypes[item.key];
    let similarity = -1;
    for (const embedding of embeddings) {
      similarity = Math.max(similarity, cosine(embedding, prototype));
    }
    const keyword = keywords.has(item.key);
    return {
      key: item.key,
      similarity,
      keyword,
      rankScore: similarity + (keyword ? CATEGORY_SUGGESTION_KEYWORD_BOOST : 0),
    };
  });
}

export async function scoreCategorySuggestions(options: {
  activity: string;
  details: string;
  embedMany: EmbedMany;
}): Promise<CategorySuggestionScore[]> {
  const text = `${options.activity} ${options.details}`.trim().replace(/\s+/g, ' ');
  if (text.length < 8) return [];
  return scoreCategorySimilarities(text, options.embedMany);
}

export async function suggestCategoriesHybrid(options: {
  activity: string;
  details: string;
  selected: CategoryKey[];
  embedMany: EmbedMany;
}): Promise<CategoryKey[]> {
  const scores = await scoreCategorySuggestions(options);
  return rankHybridCategorySuggestions({
    scores,
    selected: options.selected,
  });
}
