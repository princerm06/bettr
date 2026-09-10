export type LogisticModel = {
  weights: number[];
  bias: number;
};

function sigmoid(z: number) {
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

export function predictProbability(model: LogisticModel, embedding: number[]) {
  let z = model.bias;
  for (let i = 0; i < model.weights.length; i++) {
    z += model.weights[i] * embedding[i];
  }
  return sigmoid(z);
}

export function trainBinaryLogistic(options: {
  embeddings: number[][];
  labels: number[];
  l2: number;
  learningRate: number;
  epochs: number;
}): LogisticModel {
  const dim = options.embeddings[0]?.length;
  if (!dim) throw new Error('No training embeddings.');
  const n = options.embeddings.length;
  const weights = new Array(dim).fill(0);
  let bias = 0;

  for (let epoch = 0; epoch < options.epochs; epoch++) {
    const gradW = new Array(dim).fill(0);
    let gradB = 0;
    for (let i = 0; i < n; i++) {
      const x = options.embeddings[i];
      const y = options.labels[i];
      const p = predictProbability({ weights, bias }, x);
      const err = p - y;
      for (let j = 0; j < dim; j++) gradW[j] += err * x[j];
      gradB += err;
    }
    for (let j = 0; j < dim; j++) {
      gradW[j] = gradW[j] / n + options.l2 * weights[j];
      weights[j] -= options.learningRate * gradW[j];
    }
    bias -= options.learningRate * (gradB / n);
  }

  return { weights, bias };
}
