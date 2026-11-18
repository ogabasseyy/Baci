import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  createRouteProof,
  enforceEventPrizeGuard,
  invalidInputResponse,
  parseJsonBody,
  prizeGuardErrorResponse,
  quizRpcClientErrorResponse,
  requireQuizCsrf,
  requireQuizUser,
  rpcErrorResponse,
} from '@/app/api/quiz/_shared/route-helpers';
import { logger } from '@/lib/logger';
import { claimQuizGrandPrizeSchema } from '@/schemas/quiz';

export async function POST(request: NextRequest) {
  const auth = await requireQuizUser(request, { requireFreshSession: true });
  if (auth.response) return auth.response;

  const csrfResponse = await requireQuizCsrf(request);
  if (csrfResponse) return csrfResponse;

  const { body, response } = await parseJsonBody(request);
  if (response) return response;

  const parsed = claimQuizGrandPrizeSchema.safeParse(body);
  if (!parsed.success) {
    return invalidInputResponse(parsed.error.flatten().fieldErrors);
  }

  try {
    await enforceEventPrizeGuard(auth.supabase, parsed.data.eventId);
  } catch (error) {
    return prizeGuardErrorResponse(error);
  }

  const proofPayload = {
    event_id: parsed.data.eventId,
    user_id: auth.user.id,
  };
  const { proof, response: proofResponse } = createRouteProof({
    action: 'claim_grand_prize',
    payload: proofPayload,
    subjectId: parsed.data.eventId,
    userId: auth.user.id,
  });
  if (proofResponse) return proofResponse;

  const { data, error } = await auth.supabase.rpc('claim_quiz_grand_prize', {
    p_event_id: parsed.data.eventId,
    p_server_proof: proof,
    p_user_id: auth.user.id,
  });

  if (error) {
    const clientErrorResponse = quizRpcClientErrorResponse(error);
    if (clientErrorResponse) return clientErrorResponse;

    logger.error({
      error,
      event: 'claim_quiz_grand_prize',
      eventId: parsed.data.eventId,
      message: 'claim_quiz_grand_prize RPC failed',
      userId: auth.user.id,
    });
    return rpcErrorResponse();
  }

  return NextResponse.json({ claim: data });
}
