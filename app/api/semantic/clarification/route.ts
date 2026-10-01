import { NextRequest, NextResponse } from 'next/server';
import { calendarUserFromBearer } from '../../../../lib/calendar/serverAuth';
import {
  CLARIFICATION_JUDGE_MAX_CHARS,
  requestLunaClarification,
} from '../../../../lib/evaluation/clarificationJudge';
import { gateResultForClarificationDecision } from '../../../../lib/evaluation/clarificationJudgeClient';

export const runtime = 'nodejs';

/**
 * Second-pass clarification only.
 * Does not score first-pass logs and does not award XP.
 */
export async function POST(request: NextRequest) {
  const user = await calendarUserFromBearer(request.headers.get('authorization'));
  if (!user) {
    return NextResponse.json({ unavailable: true }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ unavailable: true }, { status: 400 });
  }
  const originalLog =
    body && typeof body === 'object' && typeof (body as { originalLog?: unknown }).originalLog === 'string'
      ? (body as { originalLog: string }).originalLog.trim()
      : '';
  const clarification =
    body && typeof body === 'object' && typeof (body as { clarification?: unknown }).clarification === 'string'
      ? (body as { clarification: string }).clarification.trim()
      : '';
  if (
    !originalLog ||
    !clarification ||
    originalLog.length > CLARIFICATION_JUDGE_MAX_CHARS ||
    clarification.length > CLARIFICATION_JUDGE_MAX_CHARS
  ) {
    return NextResponse.json({ unavailable: true }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY || '';
  const judged = await requestLunaClarification(
    { originalLog, clarification },
    { apiKey }
  );
  if (judged.kind === 'unavailable') {
    return NextResponse.json({ unavailable: true }, { status: 503 });
  }

  const gate = gateResultForClarificationDecision(judged.parsed.decision);
  return NextResponse.json({ status: gate.status });
}
