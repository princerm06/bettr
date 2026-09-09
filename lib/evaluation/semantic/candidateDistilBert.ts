import {
  CANDIDATE_QUANTIZATION,
  CANDIDATE_THRESHOLDS,
  createZeroShotNliCandidate,
} from './nliZeroShotEngine';

export const CANDIDATE_MODEL_ID = 'Xenova/distilbert-base-uncased-mnli';
export { CANDIDATE_QUANTIZATION, CANDIDATE_THRESHOLDS };

export const DISTILBERT_LICENSE_NOTES = {
  repository: 'Xenova/distilbert-base-uncased-mnli',
  upstreamFineTune: 'typeform/distilbert-base-uncased-mnli',
  upstreamFineTuneLicense: 'Unknown (Hugging Face model card)',
  parentBaseModel: 'distilbert/distilbert-base-uncased',
  parentBaseLicense: 'Apache-2.0',
  note: 'Experimental only. Fine-tune license is listed as unknown; DistilBERT base is Apache-2.0. Not treated as production-approved.',
} as const;

const candidate = createZeroShotNliCandidate(CANDIDATE_MODEL_ID);

export const loadDistilBertCandidate = candidate.load;
export const evaluateWithDistilBert = candidate.evaluate;
