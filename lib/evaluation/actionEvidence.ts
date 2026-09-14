/**
 * Action Evidence axis plus the existing narrow structural first-pass.
 *
 * Structural checks remain underspecification safeguards, not a
 * semantic classifier. Complements are not interpreted. Category
 * regexes, digits, slang lists, and trusted-activity whitelists
 * are out of scope.
 *
 * The MPNet probe is independent of Candidate 3A.2. Production
 * policy uses frozen confident bands only; the recorded binary
 * threshold is not used for product states.
 */
import probeFile from './semantic/weights/action-evidence-mpnet.json';
import { tokenizeAction } from './deterministicInvalid';
import { embedTextMpnet, loadClientMpnet } from './mpnetClient';
import { predictProbability, type LogisticModel } from './semantic/logisticRegression';

const CLOSED_CLASS = new Set([
  'a',
  'about',
  'am',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'been',
  'being',
  'but',
  'by',
  'did',
  'do',
  'does',
  'doing',
  'done',
  'for',
  'from',
  'had',
  'has',
  'have',
  'how',
  'i',
  'im',
  'in',
  'is',
  'it',
  'its',
  'me',
  'my',
  'of',
  'on',
  'or',
  'some',
  'that',
  'the',
  'this',
  'to',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'with',
  'you',
]);

/**
 * Incomplete process verbs: the process is named, but an object/content
 * complement is required before first-pass credit. Intransitive complete
 * practices (meditated, ran, lifted) are intentionally absent.
 */
const INCOMPLETE_PROCESS = new Set([
  'learn',
  'learned',
  'learning',
  'practice',
  'practiced',
  'practicing',
  'studied',
  'study',
  'studying',
]);

function contentTokens(text: string) {
  return tokenizeAction(text).filter((token) => !CLOSED_CLASS.has(token));
}

/**
 * True when every remaining token is an incomplete process verb.
 * "I learned" / "Studied" → true.
 * "I learned pointer arithmetic" → false; MPNet + 3A.2 decide.
 */
export function isProcessWithoutComplement(text: string) {
  const tokens = contentTokens(text);
  if (!tokens.length) return false;
  return tokens.every((token) => INCOMPLETE_PROCESS.has(token));
}

/**
 * One content-token titles are underspecified only when details add no
 * new open-class tokens (empty, closed-class only, or a title echo).
 *
 * Any additional open-class token stands this safeguard down. That is
 * structural presence, not a reading of the complement. A slang
 * paragraph cannot be held here without also intercepting one-token
 * titles that already have independent detail.
 */
export function needsSingletonActivityClarification(activity: string, details: string) {
  const activityTokens = contentTokens(activity);
  if (activityTokens.length !== 1) return false;
  if (INCOMPLETE_PROCESS.has(activityTokens[0])) return false;
  const title = activityTokens[0];
  const addedContent = contentTokens(details).filter((token) => token !== title);
  return addedContent.length === 0;
}

/** Existing UNCERTAIN / clarification path. First pass only. */
export function needsFirstPassClarification(activity: string, details: string) {
  const composed = [activity, details].filter((part) => String(part).trim()).join('\n');
  return isProcessWithoutComplement(composed) || needsSingletonActivityClarification(activity, details);
}

export const ACTION_EVIDENCE_MODEL_ID = 'Xenova/all-mpnet-base-v2';
export const ACTION_EVIDENCE_EMBEDDING_DIM = 768;
export const ACTION_EVIDENCE_BINARY_THRESHOLD = 0.52;
export const ACTION_EVIDENCE_CONFIDENT_NEGATIVE = 0.4407;
export const ACTION_EVIDENCE_CONFIDENT_POSITIVE = 0.6165;

export type ActionEvidenceBand =
  | 'CONFIDENT_ACTION_NEGATIVE'
  | 'ACTION_UNCERTAIN'
  | 'CONFIDENT_ACTION_POSITIVE';

export type ActionEvidenceResult = {
  pAction: number;
  band: ActionEvidenceBand;
};

type ActionProbeFile = {
  evaluator: string;
  modelId: string;
  embeddingDim: number;
  l2: number;
  learningRate: number;
  epochs: number;
  trainCount: number;
  weights: number[];
  bias: number;
  binaryThreshold: number;
  uncertainBand: { tNeg: number; tPos: number };
  pendingFreeze?: boolean;
};

const actionProbe = probeFile as ActionProbeFile;

let actionModel: LogisticModel | null = null;

function loadFrozenActionProbe(): LogisticModel {
  if (actionModel) return actionModel;
  if (actionProbe.pendingFreeze) {
    throw new Error(
      'Frozen MPNet Action Evidence weights are not installed. Run benchmarks/semantic/freeze-action-evidence-mpnet-weights.ts'
    );
  }
  if (actionProbe.evaluator !== 'candidate-action-evidence-mpnet') {
    throw new Error(`Refusing action probe ${actionProbe.evaluator}; product uses frozen MPNet only.`);
  }
  if (actionProbe.modelId !== ACTION_EVIDENCE_MODEL_ID) {
    throw new Error(`Expected ${ACTION_EVIDENCE_MODEL_ID}, got ${actionProbe.modelId}`);
  }
  if (actionProbe.learningRate !== 0.4 || actionProbe.l2 !== 0.01 || actionProbe.epochs !== 400) {
    throw new Error('MPNet action probe hyperparameters do not match the architecture of record.');
  }
  if (actionProbe.weights.length !== ACTION_EVIDENCE_EMBEDDING_DIM) {
    throw new Error(`Expected ${ACTION_EVIDENCE_EMBEDDING_DIM}-d action probe, got ${actionProbe.weights.length}`);
  }
  if (
    actionProbe.binaryThreshold !== ACTION_EVIDENCE_BINARY_THRESHOLD ||
    actionProbe.uncertainBand.tNeg !== ACTION_EVIDENCE_CONFIDENT_NEGATIVE ||
    actionProbe.uncertainBand.tPos !== ACTION_EVIDENCE_CONFIDENT_POSITIVE
  ) {
    throw new Error('Frozen Action Evidence thresholds do not match the architecture of record.');
  }
  actionModel = { weights: actionProbe.weights, bias: actionProbe.bias };
  return actionModel;
}

/** Production bands. Binary 0.52 is recorded, not used here. */
export function mapActionProbabilityToBand(pAction: number): ActionEvidenceBand {
  if (pAction <= ACTION_EVIDENCE_CONFIDENT_NEGATIVE) return 'CONFIDENT_ACTION_NEGATIVE';
  if (pAction >= ACTION_EVIDENCE_CONFIDENT_POSITIVE) return 'CONFIDENT_ACTION_POSITIVE';
  return 'ACTION_UNCERTAIN';
}

export async function evaluateActionEvidence(text: string): Promise<ActionEvidenceResult> {
  await loadClientMpnet();
  const z = await embedTextMpnet(text);
  const pAction = predictProbability(loadFrozenActionProbe(), z);
  return { pAction, band: mapActionProbabilityToBand(pAction) };
}
