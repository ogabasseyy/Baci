import { type NextRequest, NextResponse } from 'next/server';
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
import {
  finalizeQuizAwardsSchema,
  quizAttemptParamsSchema,
} from '@/schemas/quiz';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ attemptId: string }> }
) {
  const auth = await requireQuizUser(request, { requireFreshSession: true });
  if (auth.response) return auth.response;

  const csrfResponse = await requireQuizCsrf(request);
  if (csrfResponse) return csrfResponse;

  const params = quizAttemptParamsSchema.safeParse(await context.params);
  if (!params.success) {
    return invalidInputResponse(params.error.flatten().fieldErrors);
  }

  const { body, response } = await parseJsonBody(request);
  if (response) return response;

  const parsed = finalizeQuizAwardsSchema.safeParse(body);
  if (!parsed.success) {
    return invalidInputResponse(parsed.error.flatten().fieldErrors);
  }

  try {
    await enforceEventPrizeGuard(auth.supabase, parsed.data.eventId);
  } catch (error) {
    return prizeGuardErrorResponse(error);
  }

  const proofPayload = {
    attempt_id: params.data.attemptId,
    event_id: parsed.data.eventId,
    user_id: auth.user.id,
  };
  const { proof, response: proofResponse } = createRouteProof({
    action: 'finalize_awards',
    payload: proofPayload,
    subjectId: parsed.data.eventId,
    userId: auth.user.id,
  });
  if (proofResponse) return proofResponse;

  const { data, error } = await auth.supabase.rpc('finalize_quiz_awards', {
    p_attempt_id: params.data.attemptId,
    p_event_id: parsed.data.eventId,
    p_server_proof: proof,
    p_user_id: auth.user.id,
  });

  if (error) {
    const clientErrorResponse = quizRpcClientErrorResponse(error);
    if (clientErrorResponse) return clientErrorResponse;

    logger.error({
      attemptId: params.data.attemptId,
      error,
      event: 'finalize_quiz_awards',
      eventId: parsed.data.eventId,
      message: 'finalize_quiz_awards RPC failed',
      userId: auth.user.id,
    });
    return rpcErrorResponse();
  }

  return NextResponse.json({ awards: data });
}
