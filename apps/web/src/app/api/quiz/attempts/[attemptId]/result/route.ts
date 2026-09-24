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
import { createQuizVoucherToken } from '@/lib/quiz-voucher-token';
import { quizAttemptParamsSchema } from '@/schemas/quiz';
import { quizPrizeClaimProjectionSchema } from '@/schemas/quiz-prize-claim';

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
  let prizeClaim:
    | {
        awardId: string;
        cartPath: string;
        condition: 'new' | 'used' | 'open_box' | 'refurbished' | null;
        productId: string;
        variantId: string | null;
        voucherToken: string;
      }
    | undefined;
  if (raw.data.availability === 'final' && claimMetadata) {
    try {
      const token = createQuizResultClaimToken({
        awardId: claimMetadata.awardId,
        expiresAt: claimMetadata.expiresAt,
        userId: auth.user.id,
      });
      if (token) claim = { expiresAt: claimMetadata.expiresAt, token };

      const { data: rawPrizeClaim, error: prizeClaimError } =
        await auth.supabase.rpc('get_quiz_prize_claim_v2', {
          p_attempt_id: parsedParams.data.attemptId,
        });
      if (prizeClaimError) {
        logger.error({
          attemptId: parsedParams.data.attemptId,
          error: prizeClaimError,
          event: 'quiz_prize_claim_projection_failed',
          message: 'Quiz prize claim projection failed',
          userId: auth.user.id,
        });
        return rpcErrorResponse();
      } else {
        const parsedPrizeClaim =
          quizPrizeClaimProjectionSchema.safeParse(rawPrizeClaim);
        if (
          parsedPrizeClaim.success &&
          parsedPrizeClaim.data &&
          parsedPrizeClaim.data.awardId === claimMetadata.awardId &&
          parsedPrizeClaim.data.expiresAt === claimMetadata.expiresAt
        ) {
          const voucherToken = createQuizVoucherToken({
            payload: {
              awardId: parsedPrizeClaim.data.awardId,
              condition: parsedPrizeClaim.data.condition,
              expiresAt: parsedPrizeClaim.data.expiresAt,
              productId: parsedPrizeClaim.data.productId,
              userId: auth.user.id,
              variantId: parsedPrizeClaim.data.variantId,
            },
          });
          const cartQuery = new URLSearchParams({
            item_id: parsedPrizeClaim.data.productId,
            quiz_award_id: parsedPrizeClaim.data.awardId,
            quiz_voucher_token: voucherToken,
          });
          if (parsedPrizeClaim.data.variantId) {
            cartQuery.set('variant_id', parsedPrizeClaim.data.variantId);
          }
          if (parsedPrizeClaim.data.condition) {
            cartQuery.set('condition', parsedPrizeClaim.data.condition);
          }
          prizeClaim = {
            awardId: parsedPrizeClaim.data.awardId,
            cartPath: `/ogabassey/cart?${cartQuery.toString()}`,
            condition: parsedPrizeClaim.data.condition,
            productId: parsedPrizeClaim.data.productId,
            variantId: parsedPrizeClaim.data.variantId,
            voucherToken,
          };
        } else if (!parsedPrizeClaim.success) {
          logger.error({
            attemptId: parsedParams.data.attemptId,
            event: 'quiz_prize_claim_projection_invalid',
            issues: parsedPrizeClaim.error.issues,
            message: 'Quiz prize claim projection was invalid',
            userId: auth.user.id,
          });
          return rpcErrorResponse();
        }
      }
    } catch {
      logger.error({
        attemptId: parsedParams.data.attemptId,
        event: 'quiz_result_claim_signing_failed',
        message: 'Quiz result claim signing failed',
        userId: auth.user.id,
      });
      return rpcErrorResponse();
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
