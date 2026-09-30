/**
 * Stage 4 experimental encoder registry. Isolated from production loaders.
 * Does not mutate lib/evaluation/semantic/frozenSentenceEmbeddings.ts.
 */
import { join } from 'path';

export type SentencePooling = 'mean' | 'cls';

export type Stage4EncoderId = 'minilm' | 'mpnet' | 'gte-small' | 'e5-small-v2' | 'minilm-l12';

export type Stage4EncoderSpec = {
  id: Stage4EncoderId;
  runtimeModelId: string;
  sourceModelId: string;
  family: string;
  license: string;
  pooling: SentencePooling;
  normalize: boolean;
  prefix: string | null;
  expectedDim: number;
  approxParamsM: number;
  approxQuantizedOnnxMb: number;
  approxFp32OnnxMb: number;
  transformersJs: boolean;
  notes: string;
  docs: string[];
  whySelected: string;
};

export const STAGE4_ENCODERS: Stage4EncoderSpec[] = [
  {
    id: 'minilm',
    runtimeModelId: 'Xenova/all-MiniLM-L6-v2',
    sourceModelId: 'sentence-transformers/all-MiniLM-L6-v2',
    family: 'MiniLM',
    license: 'Apache-2.0',
    pooling: 'mean',
    normalize: true,
    prefix: null,
    expectedDim: 384,
    approxParamsM: 22.7,
    approxQuantizedOnnxMb: 23,
    approxFp32OnnxMb: 90,
    transformersJs: true,
    notes: 'Production developmental encoder. INT8 ONNX via Xenova.',
    docs: [
      'https://huggingface.co/Xenova/all-MiniLM-L6-v2',
      'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2',
    ],
    whySelected: 'Required production baseline.',
  },
  {
    id: 'mpnet',
    runtimeModelId: 'Xenova/all-mpnet-base-v2',
    sourceModelId: 'sentence-transformers/all-mpnet-base-v2',
    family: 'MPNet',
    license: 'Apache-2.0',
    pooling: 'mean',
    normalize: true,
    prefix: null,
    expectedDim: 768,
    approxParamsM: 109,
    approxQuantizedOnnxMb: 110,
    approxFp32OnnxMb: 420,
    transformersJs: true,
    notes: 'Production Action Evidence encoder. Larger than MiniLM; current two-encoder cost driver.',
    docs: [
      'https://huggingface.co/Xenova/all-mpnet-base-v2',
      'https://huggingface.co/sentence-transformers/all-mpnet-base-v2',
    ],
    whySelected: 'Required production AE baseline and 768-d capacity probe.',
  },
  {
    id: 'gte-small',
    runtimeModelId: 'Xenova/gte-small',
    sourceModelId: 'thenlper/gte-small',
    family: 'GTE',
    license: 'MIT',
    pooling: 'mean',
    normalize: true,
    prefix: null,
    expectedDim: 384,
    approxParamsM: 33,
    approxQuantizedOnnxMb: 33,
    approxFp32OnnxMb: 130,
    transformersJs: true,
    notes: 'Alibaba GTE-small. Mean pool. No required prefix. English, 512 tokens. Comparable size to MiniLM with a more recent contrastive objective.',
    docs: [
      'https://huggingface.co/Xenova/gte-small',
      'https://huggingface.co/thenlper/gte-small',
    ],
    whySelected:
      'Modern sentence embedding, Transformers.js ONNX, MiniLM-like size, no instruction prefix (safer for classification probing).',
  },
  {
    id: 'e5-small-v2',
    runtimeModelId: 'Xenova/e5-small-v2',
    sourceModelId: 'intfloat/e5-small-v2',
    family: 'E5',
    license: 'MIT',
    pooling: 'mean',
    normalize: true,
    prefix: 'query: ',
    expectedDim: 384,
    approxParamsM: 33,
    approxQuantizedOnnxMb: 33,
    approxFp32OnnxMb: 130,
    transformersJs: true,
    notes:
      'E5-small-v2. Model card requires query:/passage: prefixes. For symmetric/classification features the authors specify "query: ". Applied here for all Stage 4 embeds.',
    docs: [
      'https://huggingface.co/Xenova/e5-small-v2',
      'https://huggingface.co/intfloat/e5-small-v2',
    ],
    whySelected:
      'Weakly supervised contrastive embeddings with documented linear-probe usage; tests whether prefix-conditioned E5 separates action state better than MiniLM.',
  },
  {
    id: 'minilm-l12',
    runtimeModelId: 'Xenova/all-MiniLM-L12-v2',
    sourceModelId: 'sentence-transformers/all-MiniLM-L12-v2',
    family: 'MiniLM',
    license: 'Apache-2.0',
    pooling: 'mean',
    normalize: true,
    prefix: null,
    expectedDim: 384,
    approxParamsM: 33.4,
    approxQuantizedOnnxMb: 33,
    approxFp32OnnxMb: 130,
    transformersJs: true,
    notes: 'Deeper MiniLM, same 384-d space. Isolates capacity vs L6 without changing family/objective much.',
    docs: [
      'https://huggingface.co/Xenova/all-MiniLM-L12-v2',
      'https://huggingface.co/sentence-transformers/all-MiniLM-L12-v2',
    ],
    whySelected: 'Controlled capacity step within the production MiniLM family; still browser-plausible.',
  },
];

export const STAGE4_NOT_SELECTED = [
  {
    id: 'bge-small-en-v1.5',
    runtimeModelId: 'Xenova/bge-small-en-v1.5',
    reason:
      'Already probed in Candidate 4A and Stage 2 encoder pairs. Did not beat MiniLM on developmental CV; CLS pooling; retrieval instruction optional on v1.5. Kept as documented negative control, not a new bake-off row.',
    docs: ['https://huggingface.co/BAAI/bge-small-en-v1.5', 'https://huggingface.co/Xenova/bge-small-en-v1.5'],
  },
  {
    id: 'nomic-embed-text-v1',
    runtimeModelId: 'Xenova/nomic-embed-text-v1',
    reason:
      '768-d, ~137M, 8192 context, required search_query:/search_document: prefixes, heavier first-load than Bettr log texts need. Informative as a long-context retrieval model, not a realistic first web-product replacement.',
    docs: [
      'https://huggingface.co/nomic-ai/nomic-embed-text-v1',
      'https://huggingface.co/Xenova/nomic-embed-text-v1',
    ],
  },
  {
    id: 'snowflake-arctic-embed-xs',
    reason: 'Already in frozenSentenceEmbeddings 4A bake-off; did not beat MiniLM. Not re-run as a “new” family.',
    docs: ['https://huggingface.co/Snowflake/snowflake-arctic-embed-xs'],
  },
];

type FeatureExtractor = (
  text: string,
  options: { pooling: SentencePooling; normalize: boolean }
) => Promise<{ data: Float32Array | number[]; dims: number[] }>;

let extractor: FeatureExtractor | null = null;
let loaded: Stage4EncoderSpec | null = null;
let quantized = true;

export async function loadStage4Encoder(spec: Stage4EncoderSpec) {
  const { env, pipeline } = await import('@xenova/transformers');
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.cacheDir = join(process.cwd(), '.cache/transformers');
  extractor = null;
  loaded = null;
  const t0 = Date.now();
  let usedQuantized = true;
  try {
    extractor = (await pipeline('feature-extraction', spec.runtimeModelId, {
      quantized: true,
    })) as unknown as FeatureExtractor;
    usedQuantized = true;
  } catch {
    extractor = (await pipeline('feature-extraction', spec.runtimeModelId, {
      quantized: false,
    })) as unknown as FeatureExtractor;
    usedQuantized = false;
  }
  loaded = spec;
  quantized = usedQuantized;
  return {
    spec,
    quantized: usedQuantized,
    quantization: usedQuantized ? 'int8-onnx' : 'fp32-onnx',
    coldLoadMs: Date.now() - t0,
  };
}

export function unloadStage4Encoder() {
  extractor = null;
  loaded = null;
}

export function currentStage4Encoder() {
  return { spec: loaded, quantized };
}

export function formatForEncoder(spec: Stage4EncoderSpec, text: string) {
  return spec.prefix ? `${spec.prefix}${text}` : text;
}

export async function embedStage4(text: string): Promise<number[]> {
  if (!extractor || !loaded) throw new Error('Stage 4 encoder is not loaded.');
  const output = await extractor(formatForEncoder(loaded, text), {
    pooling: loaded.pooling,
    normalize: loaded.normalize,
  });
  const data = Array.from(output.data);
  if (data.length !== loaded.expectedDim) {
    throw new Error(`Expected ${loaded.expectedDim}-d from ${loaded.runtimeModelId}, got ${data.length}`);
  }
  return data;
}
