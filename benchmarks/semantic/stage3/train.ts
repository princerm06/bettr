import { trainBinaryLogistic, predictProbability, type LogisticModel } from '../../../lib/evaluation/semantic/logisticRegression';

export function trainHead(options: {
  embeddings: number[][];
  labels: number[];
  l2: number;
  learningRate: number;
  epochs: number;
}): LogisticModel {
  return trainBinaryLogistic(options);
}

export function predict(model: LogisticModel, z: number[]) {
  return predictProbability(model, z);
}
