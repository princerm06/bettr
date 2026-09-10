/** Small 1-hidden-layer MLP for Candidate #3B. Frozen MiniLM embeddings in, P(DEV) out. */

export const MLP_INPUT_DIM = 384;

export type MlpActivation = 'relu' | 'gelu';

export type MlpModel = {
  hidden: number;
  activation: MlpActivation;
  dropout: number;
  W1: number[];
  b1: number[];
  W2: number[];
  b2: number;
};

export type MlpTrainConfig = {
  hidden: number;
  activation: MlpActivation;
  l2: number;
  dropout: number;
  learningRate: number;
  epochs: number;
  seed: number;
};

function sigmoid(z: number) {
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number) {
  const u = Math.max(1e-12, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const GELU_C = Math.sqrt(2 / Math.PI);

function activate(z: number, activation: MlpActivation) {
  if (activation === 'relu') return z > 0 ? z : 0;
  const x3 = z * z * z;
  const t = Math.tanh(GELU_C * (z + 0.044715 * x3));
  return 0.5 * z * (1 + t);
}

function activatePrime(z: number, activation: MlpActivation) {
  if (activation === 'relu') return z > 0 ? 1 : 0;
  const x3 = z * z * z;
  const u = GELU_C * (z + 0.044715 * x3);
  const th = Math.tanh(u);
  const sech2 = 1 - th * th;
  const du = GELU_C * (1 + 3 * 0.044715 * z * z);
  return 0.5 * (1 + th) + 0.5 * z * sech2 * du;
}

export function mlpParamCount(hidden: number) {
  return hidden * MLP_INPUT_DIM + hidden + hidden + 1;
}

export function initMlp(config: MlpTrainConfig): MlpModel {
  const rng = mulberry32(config.seed);
  const h = config.hidden;
  const scale1 = Math.sqrt(2 / MLP_INPUT_DIM);
  const W1 = new Array(h * MLP_INPUT_DIM);
  for (let i = 0; i < W1.length; i++) W1[i] = gaussian(rng) * scale1;
  const b1 = new Array(h).fill(0);
  const scale2 = Math.sqrt(2 / h);
  const W2 = new Array(h);
  for (let i = 0; i < h; i++) W2[i] = gaussian(rng) * scale2;
  return {
    hidden: h,
    activation: config.activation,
    dropout: config.dropout,
    W1,
    b1,
    W2,
    b2: 0,
  };
}

function hiddenPre(model: MlpModel, x: number[], pre: number[]) {
  const h = model.hidden;
  for (let i = 0; i < h; i++) {
    let s = model.b1[i];
    const row = i * MLP_INPUT_DIM;
    for (let j = 0; j < MLP_INPUT_DIM; j++) s += model.W1[row + j] * x[j];
    pre[i] = s;
  }
}

export function predictMlpProbability(model: MlpModel, x: number[]) {
  const h = model.hidden;
  const pre = new Array(h);
  hiddenPre(model, x, pre);
  let z = model.b2;
  for (let i = 0; i < h; i++) z += model.W2[i] * activate(pre[i], model.activation);
  return sigmoid(z);
}

export function trainBinaryMlp(
  embeddings: number[][],
  labels: number[],
  config: MlpTrainConfig
): MlpModel {
  const n = embeddings.length;
  const h = config.hidden;
  const dim = MLP_INPUT_DIM;
  const model = initMlp(config);
  const keep = 1 - config.dropout;
  const rng = mulberry32(config.seed + 7919);

  const gW1 = new Array(h * dim);
  const gb1 = new Array(h);
  const gW2 = new Array(h);
  const pre = new Array(h);
  const act = new Array(h);
  const mask = new Array(h);
  const dpre = new Array(h);

  for (let epoch = 0; epoch < config.epochs; epoch++) {
    gW1.fill(0);
    gb1.fill(0);
    gW2.fill(0);
    let gb2 = 0;

    for (let i = 0; i < n; i++) {
      const x = embeddings[i];
      hiddenPre(model, x, pre);
      for (let u = 0; u < h; u++) {
        mask[u] = config.dropout > 0 && rng() >= keep ? 0 : 1;
        const a = activate(pre[u], config.activation);
        act[u] = config.dropout > 0 ? (a * mask[u]) / keep : a;
      }
      let z = model.b2;
      for (let u = 0; u < h; u++) z += model.W2[u] * act[u];
      const p = sigmoid(z);
      const dz = p - labels[i];
      gb2 += dz;
      for (let u = 0; u < h; u++) {
        gW2[u] += dz * act[u];
        let da = dz * model.W2[u];
        if (config.dropout > 0) da *= mask[u] / keep;
        dpre[u] = da * activatePrime(pre[u], config.activation);
        gb1[u] += dpre[u];
        const row = u * dim;
        for (let j = 0; j < dim; j++) gW1[row + j] += dpre[u] * x[j];
      }
    }

    const inv = 1 / n;
    const lr = config.learningRate;
    for (let k = 0; k < model.W1.length; k++) {
      model.W1[k] -= lr * (gW1[k] * inv + config.l2 * model.W1[k]);
    }
    for (let u = 0; u < h; u++) {
      model.b1[u] -= lr * (gb1[u] * inv);
      model.W2[u] -= lr * (gW2[u] * inv + config.l2 * model.W2[u]);
    }
    model.b2 -= lr * (gb2 * inv);
  }

  return model;
}

export function mlpNll(model: MlpModel, embeddings: number[][], labels: number[]) {
  let s = 0;
  for (let i = 0; i < embeddings.length; i++) {
    const p = Math.min(1 - 1e-12, Math.max(1e-12, predictMlpProbability(model, embeddings[i])));
    s += -(labels[i] * Math.log(p) + (1 - labels[i]) * Math.log(1 - p));
  }
  return s / Math.max(1, embeddings.length);
}
