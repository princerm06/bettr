/**
 * Browser-safe MiniLM feature extractor for Phase 1 client inference.
 * Does not use process.cwd() or Node filesystem paths.
 * Benchmark Node loader: lib/evaluation/semantic/minilmEmbeddings.ts
 */

export const CLIENT_MINILM_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
export const CLIENT_MINILM_EMBEDDING_DIM = 384;
export const CLIENT_MINILM_QUANTIZATION = 'int8-onnx';

type FeatureExtractor = (
  text: string,
  options: { pooling: 'mean'; normalize: boolean }
) => Promise<{ data: Float32Array | number[]; dims: number[] }>;

let extractor: FeatureExtractor | null = null;
let loadPromise: Promise<void> | null = null;

export type LoadedClientMiniLm = {
  modelId: string;
  quantized: boolean;
  quantization: string;
  embeddingDim: number;
};

async function ensureExtractor() {
  if (extractor) return;
  if (!loadPromise) {
    loadPromise = (async () => {
      const { env, pipeline } = await import('@xenova/transformers');
      // Browser default localModelPath is `/models/`. This repo has no
      // public/models assets; probing that path 404s. The frozen INT8
      // files are the Hub copies of Xenova/all-MiniLM-L6-v2 (same as Node).
      env.allowLocalModels = false;
      env.allowRemoteModels = true;
      const loaded = await pipeline('feature-extraction', CLIENT_MINILM_MODEL_ID, {
        quantized: true,
      });
      extractor = loaded as unknown as FeatureExtractor;
    })().catch((err) => {
      loadPromise = null;
      extractor = null;
      throw err;
    });
  }
  await loadPromise;
}

export function isClientMiniLmLoaded() {
  return extractor !== null;
}

export async function loadClientMiniLm(): Promise<LoadedClientMiniLm> {
  await ensureExtractor();
  return {
    modelId: CLIENT_MINILM_MODEL_ID,
    quantized: true,
    quantization: CLIENT_MINILM_QUANTIZATION,
    embeddingDim: CLIENT_MINILM_EMBEDDING_DIM,
  };
}

export async function embedTextClient(text: string): Promise<number[]> {
  try {
    await ensureExtractor();
  } catch (err) {
    throw new Error(
      `MiniLM failed to load: ${err instanceof Error ? err.message : 'unknown error'}`
    );
  }
  if (!extractor) {
    throw new Error('MiniLM failed to load.');
  }
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  const data = Array.from(output.data);
  if (data.length !== CLIENT_MINILM_EMBEDDING_DIM) {
    throw new Error(
      `Expected ${CLIENT_MINILM_EMBEDDING_DIM}-d embedding, got ${data.length}`
    );
  }
  return data;
}
