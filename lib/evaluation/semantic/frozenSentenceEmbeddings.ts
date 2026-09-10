import { join } from 'path';

export type SentencePooling = 'mean' | 'cls';

export type FrozenBackboneId = 'minilm' | 'bge' | 'arctic';

export type FrozenBackboneSpec = {
  id: FrozenBackboneId;
  runtimeModelId: string;
  sourceModelId: string;
  license: string;
  pooling: SentencePooling;
  normalize: boolean;
  queryPrefix: null;
  expectedDim: number;
};

export const FROZEN_BACKBONES: FrozenBackboneSpec[] = [
  {
    id: 'minilm',
    runtimeModelId: 'Xenova/all-MiniLM-L6-v2',
    sourceModelId: 'sentence-transformers/all-MiniLM-L6-v2',
    license: 'Apache-2.0',
    pooling: 'mean',
    normalize: true,
    queryPrefix: null,
    expectedDim: 384,
  },
  {
    id: 'bge',
    runtimeModelId: 'Xenova/bge-small-en-v1.5',
    sourceModelId: 'BAAI/bge-small-en-v1.5',
    license: 'MIT',
    pooling: 'cls',
    normalize: true,
    queryPrefix: null,
    expectedDim: 384,
  },
  {
    id: 'arctic',
    runtimeModelId: 'Snowflake/snowflake-arctic-embed-xs',
    sourceModelId: 'Snowflake/snowflake-arctic-embed-xs',
    license: 'Apache-2.0',
    pooling: 'cls',
    normalize: true,
    queryPrefix: null,
    expectedDim: 384,
  },
];

type FeatureExtractor = (
  text: string,
  options: { pooling: SentencePooling; normalize: boolean }
) => Promise<{ data: Float32Array | number[]; dims: number[] }>;

let extractor: FeatureExtractor | null = null;
let loadedSpec: FrozenBackboneSpec | null = null;
let loadedQuantized: boolean | null = null;

export type LoadedFrozenEncoder = {
  spec: FrozenBackboneSpec;
  quantized: boolean;
  quantization: string;
  embeddingDim: number;
};

async function loadPipeline(modelId: string, quantized: boolean) {
  const { env, pipeline } = await import('@xenova/transformers');
  env.allowLocalModels = false;
  env.cacheDir = join(process.cwd(), '.cache/transformers');
  return pipeline('feature-extraction', modelId, { quantized });
}

export async function loadFrozenEncoder(spec: FrozenBackboneSpec): Promise<LoadedFrozenEncoder> {
  let quantized = true;
  try {
    extractor = (await loadPipeline(spec.runtimeModelId, true)) as unknown as FeatureExtractor;
    quantized = true;
  } catch (err) {
    extractor = (await loadPipeline(spec.runtimeModelId, false)) as unknown as FeatureExtractor;
    quantized = false;
  }
  loadedSpec = spec;
  loadedQuantized = quantized;
  return {
    spec,
    quantized,
    quantization: quantized ? 'int8-onnx' : 'fp32-onnx',
    embeddingDim: spec.expectedDim,
  };
}

export async function embedFrozenText(text: string): Promise<number[]> {
  if (!extractor || !loadedSpec) {
    throw new Error('Frozen sentence encoder is not loaded.');
  }
  const output = await extractor(text, {
    pooling: loadedSpec.pooling,
    normalize: loadedSpec.normalize,
  });
  const data = Array.from(output.data);
  if (data.length !== loadedSpec.expectedDim) {
    throw new Error(
      `Expected ${loadedSpec.expectedDim}-d embedding from ${loadedSpec.runtimeModelId}, got ${data.length}`
    );
  }
  return data;
}

export function currentFrozenLoad() {
  return { spec: loadedSpec, quantized: loadedQuantized };
}
