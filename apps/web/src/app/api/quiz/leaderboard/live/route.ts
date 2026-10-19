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

const LIVE_PARTICIPANT_COUNT_TIMEOUT_MS = 150;

type ParticipantCountResponse = {
  data: unknown;
  error: unknown;
};

/**
 * Participant count is useful context, but it must never hold up standings.
 * The count RPC is intentionally optional and bounded so a slow database
 * aggregate cannot make the live leaderboard appear unavailable.
 */
async function fetchParticipantCountWithTimeout(
  fetchCount: () => Promise<ParticipantCountResponse>
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = Promise.resolve()
    .then(fetchCount)
    .catch(() => ({ data: null, error: null }));
  pending.catch(() => undefined);

  const timeout = new Promise<ParticipantCountResponse>((resolve) => {
    timer = setTimeout(
      () => resolve({ data: null, error: null }),
      LIVE_PARTICIPANT_COUNT_TIMEOUT_MS
    );
    if (typeof timer === 'object' && typeof timer.unref === 'function') {
      timer.unref();
    }
  });

  try {
    return await Promise.race([pending, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireQuizUser(request);
  if (auth.response) return auth.response;
  const parsed = quizLeaderboardQuerySchema.safeParse({
    eventId: request.nextUrl.searchParams.get('eventId') ?? undefined,
  });
  if (!parsed.success)
    return invalidInputResponse(parsed.error.flatten().fieldErrors);
  // Keep the count in the same authenticated request as live standings. A
  // separate client poll would double the request rate for every player, but
  // the bounded helper ensures an optional aggregate cannot delay standings.
  const participantCountResponsePromise = fetchParticipantCountWithTimeout(() =>
    auth.supabase.rpc('get_quiz_participant_count_public_v2', {
      p_event_id: parsed.data.eventId,
    })
  );
  const leaderboardResponse = await auth.supabase.rpc(
    'get_quiz_live_leaderboard_public_v2',
    {
      p_event_id: parsed.data.eventId,
    }
  );
  const { data, error } = leaderboardResponse;
  if (error) {
    const clientErrorResponse = quizRpcClientErrorResponse(error);
    if (clientErrorResponse) return clientErrorResponse;
    logger.error({
      error,
      event: 'get_quiz_live_leaderboard',
      eventId: parsed.data.eventId,
      userId: auth.user.id,
      message: 'get_quiz_live_leaderboard RPC failed',
    });
    return rpcErrorResponse();
  }
  const projection = quizLeaderboardProjectionSchema.safeParse(data);
  if (!projection.success) return rpcErrorResponse();
  const participantCountResponse = await participantCountResponsePromise;
  const participantCount =
    typeof participantCountResponse.data === 'number' &&
    Number.isInteger(participantCountResponse.data) &&
    participantCountResponse.data >= 0
      ? participantCountResponse.data
      : null;
  return NextResponse.json({
    currentPlayer: projection.data.current_player
      ? (mapQuizLeaderboardRows([projection.data.current_player])[0] ?? null)
      : null,
    entries: mapQuizLeaderboardRows(projection.data.entries),
    participantCount,
    status: 'live',
  });
}
