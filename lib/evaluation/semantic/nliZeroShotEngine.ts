import { join } from 'path';
import {
  AMBIGUITY_HYPOTHESES,
  BETTR_V1_CATEGORIES,
  CATEGORY_NLI_HYPOTHESES,
  DEVELOPMENTAL_HYPOTHESES,
  NONSENSE_HYPOTHESES,
} from './categories';
import {
  baseCreditFromTier,
  evidenceTierFromText,
  lexicalJunkReason,
} from './deterministicSignals';
import type { BettrV1Category, SemanticEvaluation } from './types';

/**
 * Shared Candidate #1 / #2 decision thresholds.
 * DistilBERT first-pass uses these unchanged.
 */
export const CANDIDATE_THRESHOLDS = {
  categorySupport: 0.4,
  relativeSupportMargin: 0.05,
  selectedSupportMargin: 0.08,
  suggestOverSelected: 0.06,
  developmental: 0.42,
  ordinaryGap: 0.08,
  nonsense: 0.55,
  unclear: 0.55,
  selectedContext: 0.38,
} as const;

export const CANDIDATE_QUANTIZATION = 'int8-onnx';

type ZeroShotOutput = {
  labels: string[];
  scores: number[];
};

type ZeroShotPipeline = (
  text: string,
  labels: string[],
  options: { multi_label: boolean; hypothesis_template: string }
) => Promise<ZeroShotOutput>;

export type LoadedNliCandidate = {
  modelId: string;
  quantized: boolean;
  quantization: string;
};

export function createZeroShotNliCandidate(modelId: string) {
  let classifier: ZeroShotPipeline | null = null;
  let loadedModelId = modelId;

  async function load(): Promise<LoadedNliCandidate> {
    const { env, pipeline } = await import('@xenova/transformers');
    env.allowLocalModels = false;
    env.cacheDir = join(process.cwd(), '.cache/transformers');

    const loaded = await pipeline('zero-shot-classification', modelId, {
      quantized: true,
    });
    classifier = loaded as unknown as ZeroShotPipeline;
    loadedModelId = modelId;
    return {
      modelId: loadedModelId,
      quantized: true,
      quantization: CANDIDATE_QUANTIZATION,
    };
  }

  function requireClassifier() {
    if (!classifier) {
      throw new Error(`NLI candidate ${modelId} is not loaded.`);
    }
    return classifier;
  }

  async function scoreHypotheses(
    premise: string,
    hypotheses: string[]
  ): Promise<Record<string, number>> {
    const output = await requireClassifier()(premise, hypotheses, {
      multi_label: true,
      hypothesis_template: '{}',
    });
    const scores: Record<string, number> = {};
    output.labels.forEach((label, index) => {
      scores[label] = output.scores[index];
    });
    return scores;
  }

  function emptyCategoryScores(): Record<BettrV1Category, number> {
    const scores = {} as Record<BettrV1Category, number>;
    for (const category of BETTR_V1_CATEGORIES) scores[category] = 0;
    return scores;
  }

  async function evaluate(
    text: string,
    selectedCategories: BettrV1Category[]
  ): Promise<SemanticEvaluation> {
    const junkReason = lexicalJunkReason(text);
    const categoryScores = emptyCategoryScores();

    if (junkReason) {
      return {
        outcome: 'NO_CREDIT',
        developmental: false,
        supportedCategories: [],
        suggestedCategories: [],
        categoryScores,
        ambiguityScore: 1,
        developmentalScore: 0,
        ordinaryActivityScore: 0,
        passiveConsumptionScore: 0,
        nonsenseScore: 0,
        evidenceTier: 'NONE',
        baseCredit: 0,
        junkReason,
      };
    }

    const premise = `Logged activity (selected: ${selectedCategories.join(', ')}): ${text}`;

    const signalLabels = [
      DEVELOPMENTAL_HYPOTHESES.developmental,
      DEVELOPMENTAL_HYPOTHESES.ordinary,
      DEVELOPMENTAL_HYPOTHESES.passive,
      AMBIGUITY_HYPOTHESES.clear,
      AMBIGUITY_HYPOTHESES.unclear,
      NONSENSE_HYPOTHESES.plausible,
      NONSENSE_HYPOTHESES.nonsense,
    ];
    const categoryLabels = BETTR_V1_CATEGORIES.map(
      (category) => CATEGORY_NLI_HYPOTHESES[category]
    );

    const [signalScores, categoryHypothesisScores] = await Promise.all([
      scoreHypotheses(premise, signalLabels),
      scoreHypotheses(premise, categoryLabels),
    ]);

    const developmentalScore =
      signalScores[DEVELOPMENTAL_HYPOTHESES.developmental] ?? 0;
    const ordinaryActivityScore =
      signalScores[DEVELOPMENTAL_HYPOTHESES.ordinary] ?? 0;
    const passiveConsumptionScore =
      signalScores[DEVELOPMENTAL_HYPOTHESES.passive] ?? 0;
    const clearScore = signalScores[AMBIGUITY_HYPOTHESES.clear] ?? 0;
    const unclearScore = signalScores[AMBIGUITY_HYPOTHESES.unclear] ?? 0;
    const plausibleScore =
      signalScores[NONSENSE_HYPOTHESES.plausible] ?? 0;
    const nonsenseScore = signalScores[NONSENSE_HYPOTHESES.nonsense] ?? 0;
    const nonsenseRelative =
      nonsenseScore / Math.max(1e-6, nonsenseScore + plausibleScore);

    for (const category of BETTR_V1_CATEGORIES) {
      categoryScores[category] =
        categoryHypothesisScores[CATEGORY_NLI_HYPOTHESES[category]] ?? 0;
    }

    const maxCategoryScore = Math.max(
      0,
      ...BETTR_V1_CATEGORIES.map((category) => categoryScores[category])
    );
    const selectedMax = Math.max(
      0,
      ...selectedCategories.map((category) => categoryScores[category])
    );

    const selectedSupported = selectedCategories.filter(
      (category) =>
        categoryScores[category] >=
        maxCategoryScore - CANDIDATE_THRESHOLDS.selectedSupportMargin
    );
    const extraSupported = BETTR_V1_CATEGORIES.filter(
      (category) =>
        !selectedCategories.includes(category) &&
        categoryScores[category] >=
          maxCategoryScore - CANDIDATE_THRESHOLDS.relativeSupportMargin &&
        categoryScores[category] >=
          selectedMax + CANDIDATE_THRESHOLDS.suggestOverSelected
    );

    const selectedContext =
      selectedMax >= CANDIDATE_THRESHOLDS.selectedContext;

    const ordinaryDominates =
      ordinaryActivityScore >=
        developmentalScore + CANDIDATE_THRESHOLDS.ordinaryGap &&
      ordinaryActivityScore >= CANDIDATE_THRESHOLDS.developmental;
    const passiveDominates =
      passiveConsumptionScore >=
        developmentalScore + CANDIDATE_THRESHOLDS.ordinaryGap &&
      selectedMax < CANDIDATE_THRESHOLDS.categorySupport;

    let developmental =
      developmentalScore >= CANDIDATE_THRESHOLDS.developmental ||
      (selectedContext &&
        !ordinaryDominates &&
        !passiveDominates &&
        developmentalScore >= ordinaryActivityScore);

    if (ordinaryDominates && selectedMax < CANDIDATE_THRESHOLDS.categorySupport) {
      developmental = false;
    }

    const ambiguous =
      unclearScore >= CANDIDATE_THRESHOLDS.unclear &&
      unclearScore > clearScore &&
      selectedMax < CANDIDATE_THRESHOLDS.categorySupport;

    let outcome: SemanticEvaluation['outcome'] = 'NO_CREDIT';

    if (
      nonsenseRelative >= CANDIDATE_THRESHOLDS.nonsense &&
      nonsenseScore > plausibleScore
    ) {
      outcome = 'NO_CREDIT';
      developmental = false;
    } else if (!developmental) {
      outcome = ambiguous ? 'NEEDS_CLARIFICATION' : 'NO_CREDIT';
    } else if (selectedSupported.length === selectedCategories.length) {
      outcome = extraSupported.length ? 'VALID_WITH_SUGGESTION' : 'VALID';
    } else if (extraSupported.length || selectedSupported.length) {
      outcome = 'VALID_WITH_SUGGESTION';
    } else if (ambiguous || selectedMax < CANDIDATE_THRESHOLDS.selectedContext) {
      outcome = 'NEEDS_CLARIFICATION';
      developmental = false;
    } else {
      outcome = 'NEEDS_CLARIFICATION';
      developmental = false;
    }

    const semanticallyValid =
      outcome === 'VALID' || outcome === 'VALID_WITH_SUGGESTION';
    const evidenceTier = evidenceTierFromText(text, semanticallyValid);
    const baseCredit = semanticallyValid ? baseCreditFromTier(evidenceTier) : 0;

    return {
      outcome,
      developmental: semanticallyValid,
      supportedCategories: semanticallyValid
        ? selectedSupported.length
          ? [...selectedSupported, ...extraSupported]
          : extraSupported
        : [],
      suggestedCategories: semanticallyValid ? extraSupported : [],
      categoryScores,
      ambiguityScore: unclearScore,
      developmentalScore,
      ordinaryActivityScore,
      passiveConsumptionScore,
      nonsenseScore,
      evidenceTier,
      baseCredit,
      junkReason: null,
    };
  }

  return {
    modelId,
    quantization: CANDIDATE_QUANTIZATION,
    thresholds: CANDIDATE_THRESHOLDS,
    load,
    evaluate,
  };
}
