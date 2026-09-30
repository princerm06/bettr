/** Isolated decision policies. Does not import production two-axis mapping for experiments. */

export type AeBand = 'NEG' | 'UNC' | 'POS';
export type DevBand = 'NON' | 'UNC' | 'DEV';
export type PolicyId = 'P0' | 'P1' | 'P2' | 'P3';
export type Outcome = 'CREDIT' | 'ASK' | 'REJECT' | 'INVALID';

export function aeBand(p: number, tNeg: number, tPos: number): AeBand {
  if (p <= tNeg) return 'NEG';
  if (p >= tPos) return 'POS';
  return 'UNC';
}

export function devBand(p: number, tNon: number, tDev: number): DevBand {
  if (p <= tNon) return 'NON';
  if (p >= tDev) return 'DEV';
  return 'UNC';
}

export function decidePolicy(options: {
  policy: PolicyId;
  invalid: boolean;
  structural: boolean;
  pAction: number | null;
  pDev: number | null;
  tAeNeg: number;
  tAePos: number;
  tDevNon: number;
  tDevMin: number;
}): Outcome {
  if (options.invalid) return 'INVALID';
  if (options.structural) return 'ASK';
  if (options.pAction == null) return 'ASK';
  const ae = aeBand(options.pAction, options.tAeNeg, options.tAePos);
  const d =
    options.pDev == null ? null : devBand(options.pDev, options.tDevNon, options.tDevMin);

  if (ae === 'NEG') return 'REJECT';

  const fromDev = (band: DevBand | null): Outcome => {
    if (band === 'NON') return 'REJECT';
    if (band === 'DEV') return 'CREDIT';
    return 'ASK';
  };

  if (ae === 'POS') return fromDev(d);

  if (options.policy === 'P0') return 'ASK';
  if (options.policy === 'P1') return fromDev(d);
  if (options.policy === 'P2') {
    if (d === 'NON') return 'REJECT';
    return 'ASK';
  }
  if (d === 'DEV') return 'CREDIT';
  return 'ASK';
}

export function productionOutcomeToPolicy(status: string): Outcome {
  if (status === 'DEVELOPMENTAL') return 'CREDIT';
  if (status === 'UNCERTAIN') return 'ASK';
  if (status === 'INVALID') return 'INVALID';
  return 'REJECT';
}
