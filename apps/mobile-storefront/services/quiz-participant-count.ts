import { quizParticipantCountResponseSchema } from '@/schemas/quiz-schemas';
import { requestQuizV2 } from './quiz';
import type { FetchQuizLeaderboardInput } from './quiz-leaderboard';

export function fetchQuizParticipantCount({
  baseUrl,
  eventId,
  expectedUserId,
}: FetchQuizLeaderboardInput): Promise<number> {
  const query = new URLSearchParams({ eventId }).toString();
  return requestQuizV2(
    `/api/quiz/leaderboard/count?${query}`,
    { method: 'GET' },
    quizParticipantCountResponseSchema,
    { baseUrl, expectedUserId }
  ).then((result) => result.participantCount);
}
