import { quizLeaderboardResponseSchema } from '@/schemas/quiz-schemas';
import { requestQuizV2 } from './quiz';
import type { QuizLeaderboard, QuizServiceOptions } from './quiz-types';

export interface FetchQuizLeaderboardInput extends QuizServiceOptions {
  eventId: string;
  expectedUserId: string;
}

export function fetchQuizLeaderboard({
  baseUrl,
  eventId,
  expectedUserId,
}: FetchQuizLeaderboardInput): Promise<QuizLeaderboard> {
  const query = new URLSearchParams({ eventId }).toString();
  return requestQuizV2(
    `/api/quiz/leaderboard?${query}`,
    { method: 'GET' },
    quizLeaderboardResponseSchema,
    { baseUrl, expectedUserId }
  );
}
