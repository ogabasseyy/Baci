import { type NextRequest, NextResponse } from 'next/server';
import {
  requireQuizV2Contract,
  requireQuizV2Runtime,
} from '@/app/api/quiz/_shared/quiz-v2-contract';
import {
  parseQuizV2PublicResult,
  parseQuizV2RawResult,
} from '@/app/api/quiz/_shared/quiz-v2-projection';
import {
  invalidInputResponse,
  requireQuizUser,
  rpcErrorResponse,
} from '@/app/api/quiz/_shared/route-auth';
import { logger } from '@/lib/logger';
import { createQuizResultClaimToken } from '@/lib/quiz/quiz-result-claim';
import { QuizVoucherTokenConfigError } from '@/lib/quiz-voucher-token';
import { quizAttemptParamsSchema } from '@/schemas/quiz';
import { getAttemptPrizeAwardClaim } from '../answers/submit-answer-helpers';
import {
  addSignedPrizeClaim,
  voucherTokenConfigResponse,
} from '../answers/submit-answer-voucher';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ attemptId: string }> }
) {
  const auth = await requireQuizUser(request);
  if (auth.response) return auth.response;
  const contractResponse = requireQuizV2Contract(request);
  if (contractResponse) return contractResponse;

  const parsedParams = quizAttemptParamsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return invalidInputResponse(parsedParams.error.flatten().fieldErrors);
  }
  const runtimeResponse = await requireQuizV2Runtime(auth.supabase);
  if (runtimeResponse) return runtimeResponse;

  const { data, error } = await auth.supabase.rpc(
    'get_quiz_attempt_result_v2',
    { p_attempt_id: parsedParams.data.attemptId }
  );
  if (error) return rpcErrorResponse();
  const raw = parseQuizV2RawResult(data);
  if (!raw.success) return rpcErrorResponse();

  const { claimMetadata, ...publicResult } = raw.data;
  let claim: { expiresAt: string; token: string } | undefined;
  let prizeClaim: unknown;
  if (raw.data.availability === 'final' && claimMetadata) {
    try {
      const token = createQuizResultClaimToken({
        awardId: claimMetadata.awardId,
        expiresAt: claimMetadata.expiresAt,
        userId: auth.user.id,
      });
      if (token) claim = { expiresAt: claimMetadata.expiresAt, token };
    } catch {
      logger.error({
        attemptId: parsedParams.data.attemptId,
        event: 'quiz_result_claim_signing_failed',
        message: 'Quiz result claim signing failed',
        userId: auth.user.id,
      });
      return rpcErrorResponse();
    }

    const award = await getAttemptPrizeAwardClaim(
      auth.supabase,
      parsedParams.data.attemptId,
      auth.user.id
    );
    if (award.error || !award.claim) {
      logger.error({
        attemptId: parsedParams.data.attemptId,
        event: 'quiz_result_prize_claim_lookup_failed',
        message: 'Quiz result prize claim lookup failed',
        userId: auth.user.id,
      });
      return rpcErrorResponse();
    }
    if (award.claim.awardId !== claimMetadata.awardId) {
      logger.error({
        attemptId: parsedParams.data.attemptId,
        event: 'quiz_result_prize_claim_mismatch',
        message: 'Quiz result prize claim did not match the persisted award',
        userId: auth.user.id,
      });
      return rpcErrorResponse();
    }
    try {
      const signedPrize = addSignedPrizeClaim(
        { prizeClaim: award.claim },
        auth.user.id,
        claimMetadata.expiresAt
      );
      if (
        !signedPrize ||
        typeof signedPrize !== 'object' ||
        !('prizeClaim' in signedPrize)
      ) {
        return rpcErrorResponse();
      }
      prizeClaim = signedPrize.prizeClaim;
    } catch (error) {
      if (error instanceof QuizVoucherTokenConfigError) {
        return voucherTokenConfigResponse();
      }
      throw error;
    }
  }

  const projection = parseQuizV2PublicResult({
    ...publicResult,
    ...(claim ? { claim } : {}),
    ...(prizeClaim ? { prizeClaim } : {}),
  });
  if (!projection.success) {
    logger.error({
      attemptId: parsedParams.data.attemptId,
      event: 'quiz_result_v2_invalid_projection',
      issues: projection.error.issues,
      message: 'get_quiz_attempt_result_v2 returned an invalid projection',
      userId: auth.user.id,
    });
    return rpcErrorResponse();
  }
  return NextResponse.json(projection.data);
}
