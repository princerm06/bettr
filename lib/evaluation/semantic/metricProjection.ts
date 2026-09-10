/** Linear 384→64 projection + family-hard cosine-margin triplets for Candidate #5A. */

export const PROJ_IN = 384;
export const PROJ_OUT = 64;

export type Projection = {
  W: number[]; // 64 * 384 row-major
  b: number[];
};

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

export function initProjection(seed: number): Projection {
  const rng = mulberry32(seed);
  const scale = 1 / Math.sqrt(PROJ_IN);
  const W = new Array(PROJ_OUT * PROJ_IN);
  for (let i = 0; i < W.length; i++) W[i] = gaussian(rng) * scale;
  return { W, b: new Array(PROJ_OUT).fill(0) };
}

function matVec(W: number[], b: number[], x: number[]) {
  const h = new Array(PROJ_OUT);
  for (let i = 0; i < PROJ_OUT; i++) {
    let s = b[i];
    const row = i * PROJ_IN;
    for (let j = 0; j < PROJ_IN; j++) s += W[row + j] * x[j];
    h[i] = s;
  }
  return h;
}

function l2Normalize(h: number[]) {
  let n2 = 0;
  for (const v of h) n2 += v * v;
  const n = Math.sqrt(n2) + 1e-12;
  return { z: h.map((v) => v / n), invNorm: 1 / n };
}

function backpropL2(z: number[], invNorm: number, gz: number[]) {
  let dot = 0;
  for (let i = 0; i < z.length; i++) dot += z[i] * gz[i];
  return z.map((zi, i) => (gz[i] - zi * dot) * invNorm);
}

export function project(model: Projection, x: number[]) {
  return l2Normalize(matVec(model.W, model.b, x)).z;
}

export function cosine(a: number[], b: number[]) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export type Triplet = { a: number; p: number; n: number };

export function trainProjection(options: {
  embeddings: number[][];
  triplets: Triplet[];
  epochs: number;
  batchSize: number;
  learningRate: number;
  l2: number;
  margin: number;
  seed: number;
}): Projection {
  const model = initProjection(options.seed);
  const rng = mulberry32(options.seed + 17);
  const dim = PROJ_OUT;
  const inDim = PROJ_IN;
  const m = options.margin;

  for (let epoch = 0; epoch < options.epochs; epoch++) {
    const order = options.triplets.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    for (let start = 0; start < order.length; start += options.batchSize) {
      const batch = order.slice(start, start + options.batchSize);
      const gW = new Array(model.W.length).fill(0);
      const gb = new Array(dim).fill(0);
      let used = 0;

      for (const ti of batch) {
        const t = options.triplets[ti];
        const xa = options.embeddings[t.a];
        const xp = options.embeddings[t.p];
        const xn = options.embeddings[t.n];
        const ha = matVec(model.W, model.b, xa);
        const hp = matVec(model.W, model.b, xp);
        const hn = matVec(model.W, model.b, xn);
        const na = l2Normalize(ha);
        const np = l2Normalize(hp);
        const nn = l2Normalize(hn);
        const loss = na.z.reduce((s, v, i) => s + v * nn.z[i], 0) - na.z.reduce((s, v, i) => s + v * np.z[i], 0) + m;
        if (loss <= 0) continue;
        used += 1;

        const gza = nn.z.map((v, i) => v - np.z[i]);
        const gzp = na.z.map((v) => -v);
        const gzn = na.z.slice();

        const gha = backpropL2(na.z, na.invNorm, gza);
        const ghp = backpropL2(np.z, np.invNorm, gzp);
        const ghn = backpropL2(nn.z, nn.invNorm, gzn);

        const acc = (gh: number[], x: number[]) => {
          for (let i = 0; i < dim; i++) {
            gb[i] += gh[i];
            const row = i * inDim;
            for (let j = 0; j < inDim; j++) gW[row + j] += gh[i] * x[j];
          }
        };
        acc(gha, xa);
        acc(ghp, xp);
        acc(ghn, xn);
      }

      const denom = Math.max(1, used);
      for (let k = 0; k < model.W.length; k++) {
        model.W[k] -= options.learningRate * (gW[k] / denom + options.l2 * model.W[k]);
      }
      for (let i = 0; i < dim; i++) model.b[i] -= options.learningRate * (gb[i] / denom);
    }
  }
  return model;
}
