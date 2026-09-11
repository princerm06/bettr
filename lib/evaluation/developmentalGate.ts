/**
 * Phase 1 developmental gate: frozen MiniLM + frozen 3A.2 logistic + NARROW band.
 * p_dev is internal only — never pass it to XP or UI.
 */
import probeFile from './semantic/weights/developmental-3a.2.json';
import {
  isDeterministicInvalid,
  mapProbabilityToStatus,
  PRODUCT_PROBE_FILE,
  type DevelopmentalGateStatus,
} from './developmentalProductPolicy';
import { embedTextClient, loadClientMiniLm } from './minilmClient';
import { predictProbability, type LogisticModel } from './semantic/logisticRegression';
import { clarificationExplicitlyDeniesAction } from './clarificationDenial';
import { clarificationIsTrivial } from './clarificationTrivial';
import {
  composeClarificationSemanticText,
  composeSemanticLogText,
  isComposerSemanticInputInvalid,
} from './customComposerSemantic';

export type DevelopmentalGateResult = {
  status: DevelopmentalGateStatus;
  /** Internal / tests only. Do not show in UI or feed scoring. */
  pDev: number | null;
  error?: string;
};

type ProbeFile = {
  evaluator: string;
  modelId: string;
  embeddingDim: number;
  l2: number;
  learningRate: number;
  epochs: number;
  trainCount: number;
  weights: number[];
  bias: number;
};

const probe = probeFile as ProbeFile;

function loadFrozenProbe(): LogisticModel {
  if (probe.evaluator !== 'candidate-developmental-3a.2') {
    throw new Error(`Refusing probe ${probe.evaluator}; product uses 3A.2 only.`);
  }
  if (probe.learningRate !== 0.4 || probe.l2 !== 0.01 || probe.epochs !== 400) {
    throw new Error('3A.2 probe hyperparameters do not match the architecture of record.');
  }
  if (probe.weights.length !== 384) {
    throw new Error(`Expected 384-d probe, got ${probe.weights.length}`);
  }
  return { weights: probe.weights, bias: probe.bias };
}

const model = loadFrozenProbe();

export type DevelopmentalActionEvaluator = (
  text: string
) => Promise<DevelopmentalGateResult>;

const DEV_FORCE_TECHNICAL_STORAGE_KEY = 'BETTR_DEV_FORCE_SEMANTIC_EVALUATOR_FAILURE';

let testEvaluator: DevelopmentalActionEvaluator | null = null;

/** Test/dev only. No-op in production builds. */
export function setDevelopmentalActionEvaluatorForTests(
  evaluator: DevelopmentalActionEvaluator | null
) {
  if (process.env.NODE_ENV === 'production') return;
  testEvaluator = evaluator;
}

function shouldForceTechnicalFailureForDev() {
  if (process.env.NODE_ENV === 'production') return false;
  try {
    return (
      typeof sessionStorage !== 'undefined' &&
      sessionStorage.getItem(DEV_FORCE_TECHNICAL_STORAGE_KEY) === '1'
    );
  } catch {
    return false;
  }
}

export function productProbeIdentity() {
  return {
    file: PRODUCT_PROBE_FILE,
    evaluator: probe.evaluator,
    l2: probe.l2,
    learningRate: probe.learningRate,
    epochs: probe.epochs,
    trainCount: probe.trainCount,
  };
}

export async function evaluateDevelopmentalAction(text: string): Promise<DevelopmentalGateResult> {
  if (isDeterministicInvalid(text)) {
    return { status: 'INVALID', pDev: null };
  }

  if (testEvaluator) {
    try {
      return await testEvaluator(text);
    } catch (err) {
      return {
        status: 'TECHNICAL_FAILURE',
        pDev: null,
        error: err instanceof Error ? err.message : 'Semantic evaluator failed.',
      };
    }
  }

  if (shouldForceTechnicalFailureForDev()) {
    return {
      status: 'TECHNICAL_FAILURE',
      pDev: null,
      error: 'Forced semantic evaluator failure (dev test).',
    };
  }

  try {
    await loadClientMiniLm();
    const z = await embedTextClient(text);
    const pDev = predictProbability(model, z);
    return { status: mapProbabilityToStatus(pDev), pDev };
  } catch (err) {
    return {
      status: 'TECHNICAL_FAILURE',
      pDev: null,
      error: err instanceof Error ? err.message : 'Semantic evaluator failed.',
    };
  }
}

/** Same first-pass path as CustomComposer: activity + details, then optional clarification wrap. */
export async function evaluateComposerSubmission(options: {
  activity: string;
  details: string;
  clarificationPass?: boolean;
  clarificationText?: string;
}): Promise<DevelopmentalGateResult> {
  if (!options.clarificationPass && isComposerSemanticInputInvalid(options.activity, options.details)) {
    return { status: 'INVALID', pDev: null };
  }
  if (options.clarificationPass) {
    const clarification = options.clarificationText || '';
    const originalText = composeSemanticLogText(options.activity, options.details);
    if (clarification.trim() && clarificationIsTrivial(clarification, originalText)) {
      return { status: 'UNCERTAIN', pDev: null };
    }
    if (clarification.trim() && isDeterministicInvalid(clarification)) {
      return { status: 'INVALID', pDev: null };
    }
    if (clarificationExplicitlyDeniesAction(clarification)) {
      return { status: 'NON_DEVELOPMENTAL', pDev: null };
    }
  }
  const originalText = composeSemanticLogText(options.activity, options.details);
  const textToEvaluate = options.clarificationPass
    ? composeClarificationSemanticText(originalText, options.clarificationText || '')
    : originalText;
  return evaluateDevelopmentalAction(textToEvaluate);
}

export function mapKnownProbability(pDev: number) {
  return mapProbabilityToStatus(pDev);
}
