import { predictProbability, type LogisticModel } from './logisticRegression';
import { embedText, loadMiniLm, MINILM_MODEL_ID } from './minilmEmbeddings';

export const BINARY_THRESHOLD = 0.5;

export type DevelopmentalWeightsFile = {
  evaluator:
    | 'candidate-developmental-3a'
    | 'candidate-developmental-3a.2'
    | 'candidate-developmental-3a.3';
  modelId: string;
  embeddingDim: number;
  quantization: string;
  binaryThreshold: number;
  seed: number;
  l2: number;
  learningRate: number;
  epochs: number;
  trainCount: number;
  weights: number[];
  bias: number;
};

let model: LogisticModel | null = null;

export function loadDevelopmentalWeights(file: DevelopmentalWeightsFile) {
  if (file.modelId !== MINILM_MODEL_ID) {
    throw new Error(`Unexpected embedding model ${file.modelId}`);
  }
  model = { weights: file.weights, bias: file.bias };
}

export async function predictDevelopmental(text: string) {
  if (!model) throw new Error('Developmental classifier weights are not loaded.');
  await loadMiniLm();
  const embedding = await embedText(text);
  const pDevelopmental = predictProbability(model, embedding);
  return {
    pDevelopmental,
    predicted:
      pDevelopmental >= BINARY_THRESHOLD ? 'DEVELOPMENTAL' : 'NON_DEVELOPMENTAL',
  };
}
