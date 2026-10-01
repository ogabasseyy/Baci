import { NextResponse } from 'next/server';
import type { requireQuizUser } from '@/app/api/quiz/_shared/route-helpers';
import { rpcErrorResponse } from '@/app/api/quiz/_shared/route-helpers';
import { QuizVoucherTokenConfigError } from '@/lib/quiz-voucher-token';
import {
  addSignedPrizeClaim,
  normalizePrizeCondition,
  QUIZ_VOUCHER_TTL_MS,
  type RawPrizeClaim,
  voucherTokenConfigResponse,
} from './submit-answer-voucher';

type QuizSupabase = Awaited<ReturnType<typeof requireQuizUser>>['supabase'];

export type SubmittedAttemptScore = {
  correctAnswers: number;
  totalQuestions: number;
};

function getRpcErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

export function isReplayStateError(error: unknown) {
  const code = getRpcErrorCode(error);
  return code === 'QZ004' || code === 'QZ026';
}

function getQuestionRows(row: unknown): unknown[] {
  if (!row || typeof row !== 'object' || !('quiz_attempt_questions' in row)) {
    return [];
  }

  const questions = (row as { quiz_attempt_questions?: unknown })
    .quiz_attempt_questions;
  return Array.isArray(questions) ? questions : [];
}

function getQuestionScore(question: unknown): number {
  if (
    !question ||
    typeof question !== 'object' ||
    !('quiz_attempt_answers' in question)
  ) {
    return 0;
  }

  const answers = (question as { quiz_attempt_answers?: unknown })
    .quiz_attempt_answers;
  const answerRows = Array.isArray(answers)
    ? answers
    : answers
      ? [answers]
      : [];
  return answerRows.reduce<number>((score, answer) => {
    if (!answer || typeof answer !== 'object' || !('score_delta' in answer)) {
      return score;
    }

    const delta = (answer as { score_delta?: unknown }).score_delta;
    return score + (typeof delta === 'number' ? delta : 0);
  }, 0);
}

export function mapSubmittedAttemptScore(
  row: unknown
): SubmittedAttemptScore | null {
  if (!row || typeof row !== 'object' || !('status' in row)) return null;
  if ((row as { status?: unknown }).status !== 'submitted') return null;

  const questions = getQuestionRows(row);
  if (questions.length === 0) return null;

  return {
    correctAnswers: questions.reduce<number>(
      (score, question) => score + getQuestionScore(question),
      0
    ),
    totalQuestions: questions.length,
  };
}

async function getSubmittedAttemptScore(
  supabase: QuizSupabase,
  attemptId: string,
  userId: string
): Promise<{ error: unknown; score: SubmittedAttemptScore | null }> {
  if (!supabase) return { error: null, score: null };

  const { data, error } = await supabase
    .from('quiz_attempts')
    .select(
      'id, status, customers!inner(user_id), quiz_attempt_questions(id, quiz_attempt_answers(score_delta))'
    )
    .eq('id', attemptId)
    .eq('customers.user_id', userId)
    .maybeSingle();

  if (error) return { error, score: null };
  return { error: null, score: mapSubmittedAttemptScore(data) };
}

// FIX B: on a replayed final answer the RPC no longer returns the prizeClaim,
// so recover the persisted, user-scoped product award and re-issue the signed
// voucher. The projection RPC keeps this lookup available for v2/v3 awards
// without relying on the legacy contract-version RLS policy on quiz_awards.
export async function getAttemptPrizeAwardClaim(
  supabase: QuizSupabase,
  attemptId: string,
  userId: string
): Promise<{
  claim: RawPrizeClaim | null;
  claimExpiresAt: string | null;
  createdAt: string | null;
  error: unknown;
}> {
  if (!supabase)
    return { claim: null, claimExpiresAt: null, createdAt: null, error: null };

  const { data, error } = await supabase.rpc(
    'get_quiz_attempt_prize_claim_v2',
    { p_attempt_id: attemptId, p_user_id: userId }
  );

  if (error)
    return { claim: null, claimExpiresAt: null, createdAt: null, error };
  if (!data || typeof data !== 'object') {
    return { claim: null, claimExpiresAt: null, createdAt: null, error: null };
  }

  const record = data as {
    awardId?: unknown;
    claimExpiresAt?: unknown;
    condition?: unknown;
    createdAt?: unknown;
    productId?: unknown;
    variantId?: unknown;
  };
  if (
    typeof record.awardId !== 'string' ||
    typeof record.productId !== 'string'
  ) {
    return { claim: null, claimExpiresAt: null, createdAt: null, error: null };
  }

  return {
    claim: {
      awardId: record.awardId,
      condition: normalizePrizeCondition(record.condition),
      productId: record.productId,
      variantId: typeof record.variantId === 'string' ? record.variantId : null,
    },
    claimExpiresAt:
      typeof record.claimExpiresAt === 'string' ? record.claimExpiresAt : null,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : null,
    error: null,
  };
}

function resolveReplayClaimExpiry(
  claimExpiresAt: string | null,
  createdAt: string | null
): string | null {
  if (claimExpiresAt) {
    return Number.isFinite(Date.parse(claimExpiresAt)) ? claimExpiresAt : null;
  }
  if (!createdAt) return null;
  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMs)) return null;
  return new Date(createdAtMs + QUIZ_VOUCHER_TTL_MS).toISOString();
}

export async function recoverReplayedAttemptResponse(
  supabase: QuizSupabase,
  attemptId: string,
  userId: string
) {
  const recovered = await getSubmittedAttemptScore(supabase, attemptId, userId);
  if (recovered.error) return rpcErrorResponse();
  if (!recovered.score) {
    return NextResponse.json(
      {
        code: 'quiz_attempt_not_answerable',
        error: 'Quiz answer is no longer accepted for this attempt',
      },
      { status: 409 }
    );
  }

  const award = await getAttemptPrizeAwardClaim(supabase, attemptId, userId);
  if (award.error) return rpcErrorResponse();

  const baseResult = {
    attemptId,
    correctAnswers: recovered.score.correctAnswers,
    prizeEligible: award.claim !== null,
    status: 'completed' as const,
    totalQuestions: recovered.score.totalQuestions,
  };

  if (!award.claim) return NextResponse.json(baseResult);

  // Re-issue with the persisted event-specific expiry, not a fresh fixed TTL,
  // so replaying a days-old attempt cannot extend the redemption window. A
  // legacy award predating claim_expires_at uses its original created-at TTL.
  const claimExpiresAt = resolveReplayClaimExpiry(
    award.claimExpiresAt,
    award.createdAt
  );
  if (!claimExpiresAt) return rpcErrorResponse();
  if (Date.parse(claimExpiresAt) <= Date.now()) {
    return NextResponse.json({ ...baseResult, prizeEligible: false });
  }

  try {
    return NextResponse.json(
      addSignedPrizeClaim(
        { ...baseResult, prizeClaim: award.claim },
        userId,
        claimExpiresAt
      )
    );
  } catch (tokenError) {
    if (tokenError instanceof QuizVoucherTokenConfigError) {
      return voucherTokenConfigResponse();
    }
    throw tokenError;
  }
}
