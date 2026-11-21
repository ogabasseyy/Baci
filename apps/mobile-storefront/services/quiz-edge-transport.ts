import type { z } from 'zod';
import { quizV2AttemptResponseSchema } from '@/schemas/quiz-schemas';
import { getQuizAttestationHeaders } from './quiz-app-attestation';
import {
  clearQuizEdgeSession,
  getQuizEdgeSession,
  getQuizEdgeSessionForAttempt,
  type QuizEdgeCheckInSession,
  quizEdgeCheckInResponseSchema,
  resolveQuizEdgeSessionForAttempt,
  saveQuizEdgeAttemptSession,
  saveQuizEdgeSession,
} from './quiz-edge-session';
import {
  getQuizAppMetadata,
  QUIZ_CONTRACT_HEADER,
  QUIZ_CONTRACT_VERSION,
  QUIZ_REQUEST_TIMEOUT_MS,
  requestQuizV2,
} from './quiz-request';
import {
  getQuizErrorCode,
  getQuizErrorMessage,
  readQuizJson,
} from './quiz-service-utils';
import type {
  QuizV2Attempt,
  StartQuizAttemptV2Input,
  SubmitQuizAnswerV2Input,
} from './quiz-types';
import { QuizServiceError } from './quiz-types';

export const QUIZ_TICKET_HEADER = 'X-Baci-Quiz-Ticket';

export {
  clearQuizEdgeSession,
  getQuizEdgeSession,
  getQuizEdgeSessionForAttempt,
  type QuizEdgeCheckInSession,
  quizEdgeCheckInResponseSchema,
  resolveQuizEdgeSessionForAttempt,
};

export async function checkInQuizEdgeEvent(
  input: StartQuizAttemptV2Input & { checkInRequestId: string }
): Promise<QuizEdgeCheckInSession> {
  if (input.mode === 'live' && !input.deviceFingerprint) {
    throw new QuizServiceError(
      'This app needs a device identity before a live quiz can start.',
      'QUIZ_DEVICE_REQUIRED',
      409
    );
  }
  const { appVersion, platform } = getQuizAppMetadata();
  const attestationHeaders =
    input.mode === 'live'
      ? await getQuizAttestationHeaders(input.eventId, {
          baseUrl: input.baseUrl,
          expectedUserId: input.expectedUserId,
        })
      : null;

  const admitted = await requestQuizV2(
    `/api/quiz/events/${encodeURIComponent(input.eventId)}/check-in`,
    {
      method: 'POST',
      headers: attestationHeaders ?? undefined,
      body: JSON.stringify({
        acceptedRulesVersion: input.acceptedRulesVersion,
        appVersion,
        checkInRequestId: input.checkInRequestId,
        expectedUserId: input.expectedUserId,
        integrityTier: input.integrityTier,
        platform,
        termsAccepted: input.termsAccepted,
      }),
    },
    quizEdgeCheckInResponseSchema,
    {
      baseUrl: input.baseUrl,
      deviceFingerprint: input.deviceFingerprint,
      expectedUserId: input.expectedUserId,
    }
  );

  const session: QuizEdgeCheckInSession = {
    ...admitted,
    edgeBaseUrl: admitted.edgeBaseUrl.replace(/\/$/, ''),
    expectedUserId: input.expectedUserId,
  };
  saveQuizEdgeSession(input.eventId, session);
  return session;
}

async function fetchEdgeJson<T>(
  session: QuizEdgeCheckInSession,
  path: string,
  body: Record<string, unknown>,
  schema: z.ZodType<T>,
  maxAttempts: number
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, QUIZ_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${session.edgeBaseUrl}${path}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          [QUIZ_CONTRACT_HEADER]: QUIZ_CONTRACT_VERSION,
          [QUIZ_TICKET_HEADER]: session.ticket,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const payload = await readQuizJson(response);
      if (!response.ok) {
        const err = new QuizServiceError(
          getQuizErrorMessage(payload),
          getQuizErrorCode(payload),
          response.status
        );
        if (response.status >= 400 && response.status < 500) {
          throw err;
        }
        lastError = err;
        continue;
      }
      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        throw new QuizServiceError(
          'Invalid quiz edge response',
          'QUIZ_INVALID_RESPONSE',
          502
        );
      }
      return parsed.data;
    } catch (error) {
      if (
        error instanceof QuizServiceError &&
        (error.status < 500 || error.code === 'QUIZ_INVALID_RESPONSE')
      ) {
        throw error;
      }
      lastError = timedOut
        ? new QuizServiceError(
            'Quiz request timed out. Please try again.',
            'QUIZ_REQUEST_TIMEOUT',
            504
          )
        : error instanceof QuizServiceError
          ? error
          : new QuizServiceError(
              'Network request failed. Please try again.',
              'QUIZ_EDGE_NETWORK_ERROR',
              503
            );
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

export async function startQuizEdgeAttempt(
  session: QuizEdgeCheckInSession,
  input: Pick<
    StartQuizAttemptV2Input,
    | 'acceptedRulesVersion'
    | 'eventId'
    | 'integrityTier'
    | 'startRequestId'
    | 'termsAccepted'
  >
): Promise<QuizV2Attempt> {
  const { appVersion, platform } = getQuizAppMetadata();
  const started = await fetchEdgeJson(
    session,
    `/api/quiz/events/${encodeURIComponent(input.eventId)}/start`,
    {
      acceptedRulesVersion: input.acceptedRulesVersion,
      appVersion,
      integrityTier: input.integrityTier,
      platform,
      startRequestId: input.startRequestId,
      termsAccepted: input.termsAccepted,
    },
    quizV2AttemptResponseSchema,
    2
  );
  await saveQuizEdgeAttemptSession(started.attemptId, session);
  return started;
}

/**
 * Submits an answer to the edge room with 1 automatic retry on transient
 * network/5xx errors. Safe to retry because `QuizRoomEngine.submitAnswer`
 * enforces `PRIMARY KEY (attempt_id, position)` and returns the already-recorded
 * state idempotently on duplicate `(attemptId, questionId)` submissions.
 */
export function submitQuizEdgeAnswer(
  session: QuizEdgeCheckInSession,
  input: Pick<
    SubmitQuizAnswerV2Input,
    'answer' | 'attemptId' | 'clientAnsweredAt' | 'questionId'
  >
): Promise<QuizV2Attempt> {
  return fetchEdgeJson(
    session,
    `/api/quiz/attempts/${encodeURIComponent(input.attemptId)}/answers`,
    {
      answer: input.answer,
      ...(input.clientAnsweredAt
        ? { clientAnsweredAt: input.clientAnsweredAt }
        : {}),
      idempotencyKey: `${input.attemptId}:${input.questionId}`,
      questionId: input.questionId,
    },
    quizV2AttemptResponseSchema,
    2
  );
}
