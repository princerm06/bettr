import { composeSemanticLogText } from './customComposerSemantic';
import { shouldReevaluateEditedLog } from './composerPersistence';
import {
  calculateDeterministicBasePoints,
  type CategoryKey,
} from './legacyEvaluator';
import {
  applyPriorityReward,
  uniqueCategoryKeys,
  type PriorityMap,
} from './priorityReward';

export type EditCreditSnapshot = {
  activity: string;
  details?: string | null;
  categories: readonly CategoryKey[];
  hasImage: boolean;
  points: number;
};

export function categorySelectionEquals(
  left: readonly CategoryKey[],
  right: readonly CategoryKey[]
) {
  const a = uniqueCategoryKeys(left);
  const b = uniqueCategoryKeys(right);
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((key) => setB.has(key));
}

export function logHasEvidenceImage(log: {
  image?: string | null;
  imagePath?: string | null;
}) {
  return Boolean(log.image || log.imagePath);
}

/**
 * True when the edited claim can change semantic validity, evidence
 * strength (5 vs 7), or category/priority attribution.
 * Date, time, duration, visibility, and insight copy are not credit-bearing.
 */
export function editRequiresRescore(
  previous: EditCreditSnapshot,
  next: Omit<EditCreditSnapshot, 'points'>
): boolean {
  if (
    shouldReevaluateEditedLog({
      existingPoints: previous.points,
      existingSemanticText: composeSemanticLogText(
        previous.activity,
        previous.details || ''
      ),
      nextSemanticText: composeSemanticLogText(next.activity, next.details || ''),
    })
  ) {
    return true;
  }
  if (!categorySelectionEquals(previous.categories, next.categories)) return true;
  if (previous.hasImage !== next.hasImage) return true;
  return false;
}

export function resolveEditedPoints(options: {
  previous: EditCreditSnapshot;
  next: Omit<EditCreditSnapshot, 'points'>;
  priorities: PriorityMap;
}): number {
  if (!editRequiresRescore(options.previous, options.next)) {
    return options.previous.points;
  }
  const basePoints = calculateDeterministicBasePoints(
    options.next.details || '',
    options.next.hasImage
  );
  return applyPriorityReward(basePoints, options.next.categories, options.priorities);
}
