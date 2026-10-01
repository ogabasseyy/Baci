import { type NextRequest, NextResponse } from 'next/server';
import { attachQuizQuestionDeadline } from '@/app/api/quiz/_shared/quiz-question-deadline';
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
import { createQuizAwardRpcClient } from '@/lib/quiz/quiz-award-rpc-client';
import { QuizVoucherTokenConfigError } from '@/lib/quiz-voucher-token';
import {
  quizAttemptParamsSchema,
  submitQuizAnswerSchema,
} from '@/schemas/quiz';
import {
  isReplayStateError,
  recoverReplayedAttemptResponse,
} from './submit-answer-helpers';
import {
  addSignedPrizeClaim,
  voucherTokenConfigResponse,
} from './submit-answer-voucher';

export async function postLegacyQuizAnswer(
  request: NextRequest,
  context: { params: Promise<{ attemptId: string }> }
) {
  const auth = await requireQuizUser(request);
  if (auth.response) return auth.response;

  const csrfResponse = await requireQuizCsrf(request);
  if (csrfResponse) return csrfResponse;

  const params = quizAttemptParamsSchema.safeParse(await context.params);
  if (!params.success) {
    return invalidInputResponse(params.error.flatten().fieldErrors);
  }

  const { body, response } = await parseJsonBody(request);
  if (response) return response;

  const parsed = submitQuizAnswerSchema.safeParse(body);
  if (!parsed.success) {
    return invalidInputResponse(parsed.error.flatten().fieldErrors);
  }

  const { proof, response: proofResponse } = createRouteProof({
    action: 'submit_quiz_answer',
    payload: {
      answer: parsed.data.answer,
      attempt_id: params.data.attemptId,
      question_id: parsed.data.questionId,
      user_id: auth.user.id,
    },
    subjectId: `${params.data.attemptId}:${parsed.data.questionId}`,
    userId: auth.user.id,
  });
  if (proofResponse) return proofResponse;

  const quizRpcClient = createQuizAwardRpcClient({
    fallbackClient: auth.supabase,
    userId: auth.user.id,
  });
  const { data, error } = await quizRpcClient.rpc('submit_quiz_answer', {
    p_answer: parsed.data.answer,
    p_attempt_id: params.data.attemptId,
    p_client_answered_at: parsed.data.clientAnsweredAt,
    p_integrity_tier: parsed.data.integrityTier,
    p_question_id: parsed.data.questionId,
    p_route_proof: proof,
    p_user_id: auth.user.id,
  });

  if (error) {
    if (isReplayStateError(error)) {
      return recoverReplayedAttemptResponse(
        auth.supabase,
        params.data.attemptId,
        auth.user.id
      );
    }

    const clientErrorResponse = quizRpcClientErrorResponse(error);
    if (clientErrorResponse) return clientErrorResponse;

    logger.error({
      attemptId: params.data.attemptId,
      error,
      event: 'submit_quiz_answer',
      message: 'submit_quiz_answer RPC failed',
      questionId: parsed.data.questionId,
      userId: auth.user.id,
    });
    return rpcErrorResponse();
  }

  try {
    const signedResult = addSignedPrizeClaim(data, auth.user.id);
    const deadlineResult = await attachQuizQuestionDeadline(
      auth.supabase,
      signedResult,
      'slot_id'
    );
    if (deadlineResult.response) return deadlineResult.response;

    return NextResponse.json(deadlineResult.data);
  } catch (error) {
    if (error instanceof QuizVoucherTokenConfigError) {
      return voucherTokenConfigResponse();
    }
    throw error;
  }
}
