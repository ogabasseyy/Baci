import { type NextRequest, NextResponse } from 'next/server';
import { requireQuizV2Contract } from '@/app/api/quiz/_shared/quiz-v2-contract';
import {
  invalidInputResponse,
  parseJsonBody,
  requireQuizCsrf,
  requireQuizUser,
  rpcErrorResponse,
} from '@/app/api/quiz/_shared/route-helpers';
import { issueQuizAttestationChallenge } from '@/lib/quiz/quiz-attestation-challenge';
import { quizAttestationChallengeRequestSchema } from '@/schemas/quiz-schema-attestation';

/**
 * Issues a single-use, 2-minute challenge for a live prize start. Only app
 * (bearer) sessions get one: browser sessions can never start a live prize.
 */
export async function POST(request: NextRequest) {
  const auth = await requireQuizUser(request, { requireFreshSession: true });
  if (auth.response) return auth.response;
  if (auth.authMethod !== 'bearer') {
    return NextResponse.json(
      { code: 'QUIZ_APP_ONLY', error: 'Open the Ogabassey app to play.' },
      { status: 403 }
    );
  }
  const csrfResponse = await requireQuizCsrf(request);
  if (csrfResponse) return csrfResponse;
  const contractResponse = requireQuizV2Contract(request);
  if (contractResponse) return contractResponse;

  const { body, response } = await parseJsonBody(request);
  if (response) return response;
  const parsed = quizAttestationChallengeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return invalidInputResponse(parsed.error.flatten().fieldErrors);
  }

  const challenge = await issueQuizAttestationChallenge(
    auth.supabase,
    parsed.data.eventId
  );
  if (challenge.status === 'limit') {
    return NextResponse.json(
      {
        code: 'QUIZ_ATTESTATION_RATE_LIMITED',
        error: 'Too many attempts. Please wait a moment and try again.',
      },
      { headers: { 'Retry-After': '120' }, status: 429 }
    );
  }
  if (challenge.status !== 'ok') return rpcErrorResponse();
  return NextResponse.json(
    { expiresAt: challenge.expiresAt, nonce: challenge.nonce },
    {
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}
