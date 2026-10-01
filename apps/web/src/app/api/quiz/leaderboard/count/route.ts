import { type NextRequest, NextResponse } from 'next/server';
import {
  invalidInputResponse,
  quizRpcClientErrorResponse,
  requireQuizUser,
  rpcErrorResponse,
} from '@/app/api/quiz/_shared/route-auth';
import { quizLeaderboardQuerySchema } from '@/schemas/quiz-leaderboard';

export async function GET(request: NextRequest) {
  const auth = await requireQuizUser(request);
  if (auth.response) return auth.response;
  const parsed = quizLeaderboardQuerySchema.safeParse({
    eventId: request.nextUrl.searchParams.get('eventId') ?? undefined,
  });
  if (!parsed.success)
    return invalidInputResponse(parsed.error.flatten().fieldErrors);
  const { data, error } = await auth.supabase.rpc(
    'get_quiz_participant_count_public_v2',
    { p_event_id: parsed.data.eventId }
  );
  if (error) {
    const clientErrorResponse = quizRpcClientErrorResponse(error);
    if (clientErrorResponse) return clientErrorResponse;
    return rpcErrorResponse();
  }
  if (typeof data !== 'number' || !Number.isInteger(data) || data < 0) {
    return rpcErrorResponse();
  }
  return NextResponse.json({ participantCount: data });
}
