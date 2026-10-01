/**
 * Browser/test boundary for the second-pass clarification judge.
 * The OpenAI key never enters this module.
 */
import type { DevelopmentalGateResult } from './developmentalGate';
import {
  clarificationDecisionIsCredit,
  type ClarificationJudgeDecision,
} from './clarificationJudge';
import { CLARIFICATION_UNAVAILABLE_COPY } from './customComposerSemantic';

export type ClarificationJudgeInput = {
  originalLog: string;
  clarification: string;
};

type TestJudge = (input: ClarificationJudgeInput) => Promise<ClarificationJudgeDecision>;

let testJudge: TestJudge | null = null;

/** Test/dev only. No-op in production builds. */
export function setClarificationJudgeForTests(judge: TestJudge | null) {
  if (process.env.NODE_ENV === 'production') return;
  testJudge = judge;
}

export function gateResultForClarificationDecision(
  decision: ClarificationJudgeDecision
): DevelopmentalGateResult {
  if (clarificationDecisionIsCredit(decision)) {
    return { status: 'DEVELOPMENTAL', pDev: null, reason: 'CLARIFICATION_JUDGE' };
  }
  if (decision === 'INSUFFICIENT') {
    return { status: 'UNCERTAIN', pDev: null, reason: 'CLARIFICATION_JUDGE' };
  }
  return { status: 'NON_DEVELOPMENTAL', pDev: null, reason: 'CLARIFICATION_JUDGE' };
}

function unavailable(): DevelopmentalGateResult {
  return {
    status: 'TECHNICAL_FAILURE',
    pDev: null,
    error: CLARIFICATION_UNAVAILABLE_COPY,
  };
}

export async function judgeSubstantiveClarification(
  input: ClarificationJudgeInput
): Promise<DevelopmentalGateResult> {
  if (testJudge) {
    try {
      return gateResultForClarificationDecision(await testJudge(input));
    } catch {
      return unavailable();
    }
  }
  if (typeof window === 'undefined') return unavailable();

  try {
    const { supabase } = await import('../supabase');
    if (!supabase) return unavailable();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return unavailable();
    const response = await fetch('/api/semantic/clarification', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        originalLog: input.originalLog,
        clarification: input.clarification,
      }),
    });
    if (response.status === 503 || response.status === 401 || response.status === 400) {
      return unavailable();
    }
    if (!response.ok) return unavailable();
    const payload = (await response.json()) as { status?: string };
    if (payload.status === 'DEVELOPMENTAL') {
      return gateResultForClarificationDecision('COMPLETED_DEVELOPMENTAL');
    }
    if (payload.status === 'UNCERTAIN') {
      return gateResultForClarificationDecision('INSUFFICIENT');
    }
    if (payload.status === 'NON_DEVELOPMENTAL') {
      return gateResultForClarificationDecision('NOT_COMPLETED');
    }
    return unavailable();
  } catch {
    return unavailable();
  }
}
