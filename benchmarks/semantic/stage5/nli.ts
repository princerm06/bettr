/**
 * One NLI cross-encoder at a time. Caller must use a fresh process per model.
 */
import { join } from 'path';
import type { NliGold } from './examples';
import type { Probs } from './policy';

type Tokenizer = (
  text: string,
  options: { text_pair: string; padding: boolean; truncation: boolean }
) => unknown;

type NliModel = {
  (inputs: unknown): Promise<{ logits: { data: ArrayLike<number>; dims: number[] } }>;
  dispose: () => Promise<unknown>;
  config: { id2label?: Record<string, string> };
};

let tokenizer: Tokenizer | null = null;
let model: NliModel | null = null;
let labelIndex: Record<NliGold, number> | null = null;

function softmaxMapped(logits: number[]): Probs {
  const chosen = [
    logits[labelIndex!.entails],
    logits[labelIndex!.neutral],
    logits[labelIndex!.contradicts],
  ];
  if (chosen.some((x) => x === undefined || Number.isNaN(x))) {
    throw new Error(`Logits missing a class index. length=${logits.length}`);
  }
  const max = Math.max(...chosen);
  const exps = chosen.map((x) => Math.exp(x - max));
  const z = exps[0] + exps[1] + exps[2];
  return { entails: exps[0] / z, neutral: exps[1] / z, contradicts: exps[2] / z };
}

export async function loadNli(modelId: string): Promise<{ quantized: boolean; coldLoadMs: number; id2label: Record<string, string> }> {
  if (model || tokenizer) {
    throw new Error('Refusing to load a second NLI model in the same process.');
  }
  const { env, AutoTokenizer, AutoModelForSequenceClassification } = await import('@xenova/transformers');
  env.allowLocalModels = false;
  // Cache hits never touch the network. Point remote at a closed port so a cache
  // miss fails instead of downloading a model.
  env.allowRemoteModels = true;
  env.remoteHost = 'http://127.0.0.1:9';
  env.cacheDir = join(process.cwd(), '.cache/transformers');
  const t0 = Date.now();
  tokenizer = (await AutoTokenizer.from_pretrained(modelId, { quantized: true })) as Tokenizer;
  model = (await AutoModelForSequenceClassification.from_pretrained(modelId, {
    quantized: true,
  })) as NliModel;
  const id2label = model.config.id2label ?? {};
  const index: Partial<Record<NliGold, number>> = {};
  for (const [key, label] of Object.entries(id2label)) {
    const name = String(label).toLowerCase();
    if (name === 'entailment') index.entails = Number(key);
    if (name === 'neutral') index.neutral = Number(key);
    if (name === 'contradiction') index.contradicts = Number(key);
  }
  if (index.entails === undefined || index.neutral === undefined || index.contradicts === undefined) {
    throw new Error(`Model ${modelId} is missing a 3-way MNLI label map: ${JSON.stringify(id2label)}`);
  }
  labelIndex = index as Record<NliGold, number>;
  return { quantized: true, coldLoadMs: Date.now() - t0, id2label };
}

export async function scorePair(premise: string, hypothesis: string): Promise<Probs> {
  if (!tokenizer || !model || !labelIndex) throw new Error('NLI model is not loaded.');
  const inputs = tokenizer(premise, {
    text_pair: hypothesis,
    padding: true,
    truncation: true,
  });
  const outputs = await model(inputs);
  const data = Array.from(outputs.logits.data);
  if (data.length < 3) throw new Error(`Expected 3 logits, got ${data.length}`);
  return softmaxMapped(data);
}

export async function unloadNli(): Promise<void> {
  if (model) {
    try {
      await model.dispose();
    } catch {
      /* session may already be released */
    }
  }
  model = null;
  tokenizer = null;
  labelIndex = null;
}
