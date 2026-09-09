import {
  CANDIDATE_QUANTIZATION,
  CANDIDATE_THRESHOLDS,
  createZeroShotNliCandidate,
} from './nliZeroShotEngine';

export const CANDIDATE_MODEL_ID = 'Xenova/mobilebert-uncased-mnli';
export { CANDIDATE_QUANTIZATION, CANDIDATE_THRESHOLDS };

const candidate = createZeroShotNliCandidate(CANDIDATE_MODEL_ID);

export const loadMobileBertCandidate = candidate.load;
export const evaluateWithMobileBert = candidate.evaluate;
