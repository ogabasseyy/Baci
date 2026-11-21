import { quizV2ActiveAttemptResponseSchema } from '@/schemas/quiz-schemas';
import { requestQuizV2 } from './quiz';
import {
  clearQuizEdgeSession,
  resolveQuizEdgeSessionForEvent,
} from './quiz-edge-session';
import { recoverQuizEdgeAttempt } from './quiz-edge-transport';
import {
  type QuizActiveAttemptResponse,
  type QuizEventBackendMode,
  QuizServiceError,
  type QuizServiceOptions,
} from './quiz-types';

const EDGE_TICKET_POST_END_GRACE_MS = 60_000;

export interface RecoverQuizAttemptInput extends QuizServiceOptions {
  backendMode?: QuizEventBackendMode;
  deviceFingerprint?: string | null;
  eventId: string;
  expectedUserId: string;
}

export async function recoverActiveQuizAttempt({
  backendMode: _backendMode,
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
    const endsAtMs = Date.parse(edgeSession.endsAt);
    const ticketExpiredAfterEvent =
      Number.isFinite(endsAtMs) &&
      Date.now() >= endsAtMs + EDGE_TICKET_POST_END_GRACE_MS;
    if (ticketExpiredAfterEvent) {
      clearQuizEdgeSession(eventId, expectedUserId);
    } else {
      try {
        return await recoverQuizEdgeAttempt(edgeSession, eventId);
      } catch (error) {
        const isExpiredTicketError =
          error instanceof QuizServiceError &&
          (error.status === 401 || error.status === 403) &&
          Number.isFinite(endsAtMs) &&
          Date.now() >= endsAtMs;
        if (!isExpiredTicketError) {
          throw error;
        }
        clearQuizEdgeSession(eventId, expectedUserId);
      }
    }
  }
  const query = new URLSearchParams({ eventId }).toString();
  return requestQuizV2(
    `/api/quiz/attempts/active?${query}`,
    { method: 'GET' },
    quizV2ActiveAttemptResponseSchema,
    { baseUrl, deviceFingerprint, expectedUserId }
  );
}
