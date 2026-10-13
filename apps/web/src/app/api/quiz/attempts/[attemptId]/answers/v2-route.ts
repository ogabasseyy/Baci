import { type NextRequest, NextResponse } from 'next/server';
import { enrichQuizV2AttemptWithSubmissionTime } from '@/app/api/quiz/_shared/quiz-v2-attempt-submission';
import {
  requireQuizV2Contract,
  requireQuizV2Runtime,
} from '@/app/api/quiz/_shared/quiz-v2-contract';
import { parseQuizV2Attempt } from '@/app/api/quiz/_shared/quiz-v2-projection';
import {
  createRouteProof,
  invalidInputResponse,
  parseJsonBody,
  quizRpcClientErrorResponse,
  requireQuizCsrf,
  requireQuizUser,
  rpcErrorResponse,
} from '@/app/api/quiz/_shared/route-helpers';
import { logger } from '@/lib/logger';
import {
  quizAttemptParamsSchema,
  submitQuizAnswerV2Schema,
} from '@/schemas/quiz';

const ANSWER_ACTION = 'submit_quiz_answer_v2';

export async function postQuizAnswerV2(
  request: NextRequest,
  context: { params: Promise<{ attemptId: string }> }
) {
  const auth = await requireQuizUser(request);
  if (auth.response) return auth.response;
  const csrfResponse = await requireQuizCsrf(request);
  if (csrfResponse) return csrfResponse;
  const contractResponse = requireQuizV2Contract(request);
  if (contractResponse) return contractResponse;

  const parsedParams = quizAttemptParamsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return invalidInputResponse(parsedParams.error.flatten().fieldErrors);
  }
  const { body, response } = await parseJsonBody(request);
  if (response) return response;
  const parsed = submitQuizAnswerV2Schema.safeParse(body);
  if (!parsed.success) {
    return invalidInputResponse(parsed.error.flatten().fieldErrors);
  }

  const runtimeResponse = await requireQuizV2Runtime(auth.supabase);
  if (runtimeResponse) return runtimeResponse;
  const subjectId = `${parsedParams.data.attemptId}:${parsed.data.questionId}`;
  const payload = {
    answer: parsed.data.answer,
    attempt_id: parsedParams.data.attemptId,
    client_answered_at: parsed.data.clientAnsweredAt ?? null,
    question_id: parsed.data.questionId,
    user_id: auth.user.id,
  };
  const proof = createRouteProof({
    action: ANSWER_ACTION,
    payload,
    subjectId,
    userId: auth.user.id,
  });
  if (proof.response) return proof.response;

  const { data, error } = await auth.supabase.rpc('submit_quiz_answer_v2', {
    p_answer: parsed.data.answer,
    p_attempt_id: parsedParams.data.attemptId,
    p_client_answered_at: parsed.data.clientAnsweredAt,
    p_question_id: parsed.data.questionId,
    p_route_proof: proof.proof,
    p_user_id: auth.user.id,
  });
  if (error) {
    const clientResponse = quizRpcClientErrorResponse(error);
    if (clientResponse) return clientResponse;
    logger.error({
      attemptId: parsedParams.data.attemptId,
      event: 'submit_quiz_answer_v2_failed',
      message: 'submit_quiz_answer_v2 RPC failed',
      userId: auth.user.id,
    });
    return rpcErrorResponse();
  }

  const enriched = await enrichQuizV2AttemptWithSubmissionTime(
    auth.supabase,
    data
  );
  if (enriched.error) {
    logger.error({
      attemptId: parsedParams.data.attemptId,
      event: 'submit_quiz_answer_v2_submission_time_failed',
      message: 'Could not read the authoritative quiz submission time',
      userId: auth.user.id,
    });
    return rpcErrorResponse();
  }
  const projection = parseQuizV2Attempt(enriched.attempt);
  if (!projection.success) {
    logger.error({
      attemptId: parsedParams.data.attemptId,
      event: 'submit_quiz_answer_v2_invalid_projection',
      issues: projection.error.issues,
      message: 'submit_quiz_answer_v2 returned an invalid projection',
      userId: auth.user.id,
    });
    return rpcErrorResponse();
  }
  return NextResponse.json(projection.data);
}
