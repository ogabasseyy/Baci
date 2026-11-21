import { quizV2ActiveAttemptResponseSchema } from '@/schemas/quiz-schemas';
import { requestQuizV2 } from './quiz';
import { resolveQuizEdgeSessionForEvent } from './quiz-edge-session';
import { recoverQuizEdgeAttempt } from './quiz-edge-transport';
import {
  type QuizActiveAttemptResponse,
  type QuizEventBackendMode,
  QuizServiceError,
  type QuizServiceOptions,
} from './quiz-types';

export interface RecoverQuizAttemptInput extends QuizServiceOptions {
  backendMode?: QuizEventBackendMode;
  deviceFingerprint?: string | null;
  eventId: string;
  expectedUserId: string;
}

export async function recoverActiveQuizAttempt({
  backendMode,
  baseUrl,
  deviceFingerprint,
  eventId,
  expectedUserId,
}: RecoverQuizAttemptInput): Promise<QuizActiveAttemptResponse> {
  const edgeSession = await resolveQuizEdgeSessionForEvent(
    eventId,
    expectedUserId
  );
  if (edgeSession) {
    return recoverQuizEdgeAttempt(edgeSession, eventId);
  }
  if (backendMode === 'edge_rooms') {
    throw new QuizServiceError(
      'Your quiz room session expired. Please check in again.',
      'QUIZ_EDGE_SESSION_MISSING',
      401
    );
  }
  const query = new URLSearchParams({ eventId }).toString();
  return requestQuizV2(
    `/api/quiz/attempts/active?${query}`,
    { method: 'GET' },
    quizV2ActiveAttemptResponseSchema,
    { baseUrl, deviceFingerprint, expectedUserId }
  );
}
