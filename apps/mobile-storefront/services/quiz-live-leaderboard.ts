import { quizLeaderboardResponseSchema } from '@/schemas/quiz-schemas';
import { requestQuizV2 } from './quiz';
import type { FetchQuizLeaderboardInput } from './quiz-leaderboard';
import type { QuizLeaderboard } from './quiz-types';

export function fetchQuizLiveLeaderboard({
  baseUrl,
  eventId,
  expectedUserId,
}: FetchQuizLeaderboardInput): Promise<QuizLeaderboard> {
  const query = new URLSearchParams({ eventId }).toString();
  return requestQuizV2(
    `/api/quiz/leaderboard/live?${query}`,
    { method: 'GET' },
    quizLeaderboardResponseSchema,
    { baseUrl, expectedUserId }
  );
}
