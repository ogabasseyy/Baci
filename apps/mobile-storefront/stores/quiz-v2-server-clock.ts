import type { QuizActiveAttemptResponse } from '@/services/quiz-types';

export function isQuizOpenAtServerTime(
  response: QuizActiveAttemptResponse
): boolean {
  if (!response.serverNow || !response.eventEndsAt) return false;
  return Date.parse(response.serverNow) < Date.parse(response.eventEndsAt);
}
