import { type NextRequest, NextResponse } from 'next/server';
import {
  invalidInputResponse,
  parseJsonBody,
  requireQuizCsrf,
  requireQuizUser,
} from '@/app/api/quiz/_shared/route-helpers';
import { logger } from '@/lib/logger';
import { claimQuizTestInviteSchema } from '@/schemas/quiz';

const INVITE_UNAVAILABLE = {
  code: 'QUIZ_TEST_INVITE_UNAVAILABLE',
  error: 'This quiz invitation is invalid or no longer available.',
} as const;

export async function POST(request: NextRequest) {
  const auth = await requireQuizUser(request, { requireFreshSession: true });
  if (auth.response) return auth.response;

  const csrfResponse = await requireQuizCsrf(request);
  if (csrfResponse) return csrfResponse;

  const { body, response } = await parseJsonBody(request);
  if (response) return response;

  const parsed = claimQuizTestInviteSchema.safeParse(body);
  if (!parsed.success) {
    return invalidInputResponse(parsed.error.flatten().fieldErrors);
  }

  const { data: eventId, error } = await auth.supabase.rpc(
    'redeem_quiz_test_invite_v2',
    { p_token: parsed.data.token }
  );

  if (error || typeof eventId !== 'string') {
    logger.warn({
      code:
        error &&
        typeof error === 'object' &&
        'code' in error &&
        typeof error.code === 'string'
          ? error.code.slice(0, 16)
          : 'unknown',
      event: 'quiz_test_invite_claim_failed',
      message: 'Quiz test invite claim was unavailable',
      userId: auth.user.id,
    });
    return NextResponse.json(INVITE_UNAVAILABLE, { status: 409 });
  }

  return NextResponse.json({ eventId }, { status: 200 });
}
