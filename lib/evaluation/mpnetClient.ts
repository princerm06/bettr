/**
 * Browser-safe MPNet feature extractor for the frozen Action Evidence axis.
 * Does not use process.cwd() or Node filesystem paths.
 * Mirrors minilmClient.ts loading: lazy singleton, quantized Hub weights.
 */
export const CLIENT_MPNET_MODEL_ID = 'Xenova/all-mpnet-base-v2';
export const CLIENT_MPNET_EMBEDDING_DIM = 768;
export const CLIENT_MPNET_QUANTIZATION = 'int8-onnx';

type FeatureExtractor = (
  text: string,
  options: { pooling: 'mean'; normalize: boolean }
) => Promise<{ data: Float32Array | number[]; dims: number[] }>;

let extractor: FeatureExtractor | null = null;
let loadPromise: Promise<void> | null = null;

export type LoadedClientMpnet = {
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
      env.allowLocalModels = false;
      env.allowRemoteModels = true;
      const loaded = await pipeline('feature-extraction', CLIENT_MPNET_MODEL_ID, {
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

export function isClientMpnetLoaded() {
  return extractor !== null;
}

export async function loadClientMpnet(): Promise<LoadedClientMpnet> {
  await ensureExtractor();
  return {
    modelId: CLIENT_MPNET_MODEL_ID,
    quantized: true,
    quantization: CLIENT_MPNET_QUANTIZATION,
    embeddingDim: CLIENT_MPNET_EMBEDDING_DIM,
  };
}

export async function embedTextMpnet(text: string): Promise<number[]> {
  try {
    await ensureExtractor();
  } catch (err) {
    throw new Error(
      `MPNet failed to load: ${err instanceof Error ? err.message : 'unknown error'}`
    );
  }
  if (!extractor) {
    throw new Error('MPNet failed to load.');
  }
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  const data = Array.from(output.data);
  if (data.length !== CLIENT_MPNET_EMBEDDING_DIM) {
    throw new Error(
      `Expected ${CLIENT_MPNET_EMBEDDING_DIM}-d embedding, got ${data.length}`
    );
  }
  return data;
}
