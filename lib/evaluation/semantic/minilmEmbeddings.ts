/**
 * Node MiniLM feature extractor for benchmarks and the trusted 3A.2 runtime.
 * Production browser loader: lib/evaluation/minilmClient.ts (no process.cwd).
 */
import { join } from 'path';

export const MINILM_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
export const MINILM_EMBEDDING_DIM = 384;
export const MINILM_QUANTIZATION = 'int8-onnx';

type FeatureExtractor = (
  text: string,
  options: { pooling: 'mean'; normalize: boolean }
) => Promise<{ data: Float32Array | number[]; dims: number[] }>;

let extractor: FeatureExtractor | null = null;

export type LoadedMiniLm = {
  modelId: string;
  quantized: boolean;
  quantization: string;
  embeddingDim: number;
};

export async function loadMiniLm(): Promise<LoadedMiniLm> {
  const { env, pipeline } = await import('@xenova/transformers');
  env.allowLocalModels = false;
  env.cacheDir = join(process.cwd(), '.cache/transformers');
  const loaded = await pipeline('feature-extraction', MINILM_MODEL_ID, {
    quantized: true,
  });
  extractor = loaded as unknown as FeatureExtractor;
  return {
    modelId: MINILM_MODEL_ID,
    quantized: true,
    quantization: MINILM_QUANTIZATION,
    embeddingDim: MINILM_EMBEDDING_DIM,
  };
}

export async function embedText(text: string): Promise<number[]> {
  if (!extractor) {
    throw new Error('MiniLM is not loaded.');
  }
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  const data = Array.from(output.data);
  if (data.length !== MINILM_EMBEDDING_DIM) {
    throw new Error(
      `Expected ${MINILM_EMBEDDING_DIM}-d embedding, got ${data.length}`
    );
  }
  return data;
}
