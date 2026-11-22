import { quizLeaderboardResponseSchema } from '@/schemas/quiz-schemas';
import { requestQuizV2 } from './quiz';
import { resolveQuizEdgeSessionForEvent } from './quiz-edge-session';
import type { FetchQuizLeaderboardInput } from './quiz-leaderboard';
import { QUIZ_REQUEST_TIMEOUT_MS } from './quiz-request';
import { type QuizLeaderboard, QuizServiceError } from './quiz-types';

const EDGE_LIVE_BOARD_GRACE_MS = 60_000;

export async function fetchQuizLiveLeaderboard({
  baseUrl,
  eventId,
  expectedUserId,
}: FetchQuizLeaderboardInput): Promise<QuizLeaderboard> {
  const query = new URLSearchParams({ eventId }).toString();
  const edgeSession = await resolveQuizEdgeSessionForEvent(
    eventId,
    expectedUserId
  );
  const endsAtMs = edgeSession ? Date.parse(edgeSession.endsAt) : Number.NaN;
  if (
    edgeSession &&
    (!Number.isFinite(endsAtMs) ||
      Date.now() < endsAtMs + EDGE_LIVE_BOARD_GRACE_MS)
  ) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), QUIZ_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(
        `${edgeSession.edgeBaseUrl}/api/quiz/leaderboard/live?${query}`,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'X-Baci-Quiz-Contract': '2',
            'X-Baci-Quiz-Ticket': edgeSession.ticket,
          },
          signal: controller.signal,
        }
      );
      const payload = (await response.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      if (!response.ok) {
        throw new QuizServiceError(
          typeof payload?.error === 'string'
            ? payload.error
            : `Edge live leaderboard request failed (${response.status})`,
          typeof payload?.code === 'string' ? payload.code : 'QUIZ_EDGE_ERROR',
          response.status
        );
      }
      const parsed = quizLeaderboardResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new QuizServiceError(
          'Edge live leaderboard returned an invalid response.',
          'QUIZ_INVALID_RESPONSE',
          502
        );
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof QuizServiceError) throw error;
      const isAbort = error instanceof Error && error.name === 'AbortError';
      throw new QuizServiceError(
        isAbort
          ? 'Live leaderboard request timed out.'
          : 'Network request failed.',
        isAbort ? 'QUIZ_REQUEST_TIMEOUT' : 'QUIZ_EDGE_NETWORK_ERROR',
        isAbort ? 504 : 503
      );
    } finally {
      clearTimeout(timer);
    }
  }
  return requestQuizV2(
    `/api/quiz/leaderboard/live?${query}`,
    { method: 'GET' },
    quizLeaderboardResponseSchema,
    { baseUrl, expectedUserId }
  );
}
