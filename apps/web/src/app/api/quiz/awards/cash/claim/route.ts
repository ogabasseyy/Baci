import { type NextRequest, NextResponse } from 'next/server';
import {
  createRouteProof,
  enforceCashAwardPrizeGuard,
  invalidInputResponse,
  parseJsonBody,
  prizeGuardErrorResponse,
  quizRpcClientErrorResponse,
  requireQuizCsrf,
  requireQuizUser,
  rpcErrorResponse,
} from '@/app/api/quiz/_shared/route-helpers';
import { logger } from '@/lib/logger';
import { claimQuizCashAwardSchema } from '@/schemas/quiz';

export async function POST(request: NextRequest) {
  const auth = await requireQuizUser(request, { requireFreshSession: true });
  if (auth.response) return auth.response;

  const csrfResponse = await requireQuizCsrf(request);
  if (csrfResponse) return csrfResponse;

  const { body, response } = await parseJsonBody(request);
  if (response) return response;

  const parsed = claimQuizCashAwardSchema.safeParse(body);
  if (!parsed.success) {
    return invalidInputResponse(parsed.error.flatten().fieldErrors);
  }

  try {
    await enforceCashAwardPrizeGuard(auth.supabase, parsed.data.awardId);
  } catch (error) {
    return prizeGuardErrorResponse(error);
  }

  const proofPayload = {
    award_id: parsed.data.awardId,
    user_id: auth.user.id,
  };
  const { proof, response: proofResponse } = createRouteProof({
    action: 'claim_cash_award',
    payload: proofPayload,
    subjectId: parsed.data.awardId,
    userId: auth.user.id,
  });
  if (proofResponse) return proofResponse;

  const { data, error } = await auth.supabase.rpc('claim_quiz_cash_award', {
    p_award_id: parsed.data.awardId,
    p_server_proof: proof,
    p_user_id: auth.user.id,
  });

  if (error) {
    const clientErrorResponse = quizRpcClientErrorResponse(error);
    if (clientErrorResponse) return clientErrorResponse;

    logger.error({
      awardId: parsed.data.awardId,
      error,
      event: 'claim_quiz_cash_award',
      message: 'claim_quiz_cash_award RPC failed',
      userId: auth.user.id,
    });
    return rpcErrorResponse();
  }

  return NextResponse.json({ claim: data });
}
