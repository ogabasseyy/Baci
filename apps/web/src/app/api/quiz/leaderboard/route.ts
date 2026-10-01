import { type NextRequest, NextResponse } from 'next/server';
import {
  invalidInputResponse,
  quizRpcClientErrorResponse,
  requireQuizUser,
  rpcErrorResponse,
} from '@/app/api/quiz/_shared/route-auth';
import { logger } from '@/lib/logger';
import { mapQuizLeaderboardRows } from '@/lib/quiz/map-quiz-leaderboard-rows';
import {
  quizLeaderboardProjectionSchema,
  quizLeaderboardQuerySchema,
} from '@/schemas/quiz-leaderboard';

export async function GET(request: NextRequest) {
  // Auth first. get_quiz_leaderboard_public is granted to `authenticated` and
  // refuses anyone who is not a customer of the event's merchant (QZ031) — this
  // is not a public board.
  const auth = await requireQuizUser(request);
  if (auth.response) return auth.response;

  const parsed = quizLeaderboardQuerySchema.safeParse({
    eventId: request.nextUrl.searchParams.get('eventId') ?? undefined,
  });
  if (!parsed.success) {
    return invalidInputResponse(parsed.error.flatten().fieldErrors);
  }

  let { data, error } = await auth.supabase.rpc(
    'get_quiz_leaderboard_public_v2',
    {
      p_event_id: parsed.data.eventId,
    }
  );

  if (error) {
    const clientErrorResponse = quizRpcClientErrorResponse(error);
    if (clientErrorResponse) return clientErrorResponse;

    logger.error({
      error,
      event: 'get_quiz_leaderboard',
      eventId: parsed.data.eventId,
      message: 'get_quiz_leaderboard RPC failed',
      userId: auth.user.id,
    });
    return rpcErrorResponse();
  }

  // Keep this endpoint as the compatibility path for existing storefronts.
  // Published events use the immutable final projection; active events use
  // the bounded live projection instead of waiting for finalization.
  if (
    data &&
    typeof data === 'object' &&
    data !== null &&
    'status' in data &&
    data.status === 'live_hidden'
  ) {
    const live = await auth.supabase.rpc(
      'get_quiz_live_leaderboard_public_v2',
      {
        p_event_id: parsed.data.eventId,
      }
    );
    if (live.error) {
      const clientErrorResponse = quizRpcClientErrorResponse(live.error);
      if (clientErrorResponse) return clientErrorResponse;
      logger.error({
        error: live.error,
        event: 'get_quiz_live_leaderboard',
        eventId: parsed.data.eventId,
        message: 'get_quiz_live_leaderboard RPC failed',
        userId: auth.user.id,
      });
      return rpcErrorResponse();
    }
    data = live.data;
  }

  const projection = quizLeaderboardProjectionSchema.safeParse(data);
  if (!projection.success) {
    logger.error({
      error: projection.error.flatten(),
      event: 'get_quiz_leaderboard',
      eventId: parsed.data.eventId,
      message: 'get_quiz_leaderboard returned an unexpected shape',
      userId: auth.user.id,
    });
    return rpcErrorResponse();
  }

  const currentPlayer = projection.data.current_player
    ? (mapQuizLeaderboardRows([projection.data.current_player])[0] ?? null)
    : null;

  const participantCount = await auth.supabase.rpc(
    'get_quiz_participant_count_public_v2',
    { p_event_id: parsed.data.eventId }
  );
  if (participantCount.error) {
    logger.warn({
      error: participantCount.error,
      event: 'get_quiz_participant_count',
      eventId: parsed.data.eventId,
      message:
        'participant count unavailable; returning leaderboard without it',
      userId: auth.user.id,
    });
  }

  return NextResponse.json({
    currentPlayer,
    entries: mapQuizLeaderboardRows(projection.data.entries),
    participantCount:
      typeof participantCount.data === 'number' &&
      Number.isInteger(participantCount.data) &&
      participantCount.data >= 0
        ? participantCount.data
        : null,
    status: projection.data.status,
  });
}
