import { z } from 'zod';
import { quizV2AttemptResponseSchema } from '@/schemas/quiz-schemas';
import { getQuizAttestationHeaders } from './quiz-app-attestation';
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

export const quizEdgeCheckInResponseSchema = z.object({
  admissionId: z.string().uuid(),
  eventId: z.string().uuid(),
  merchantId: z.string().uuid(),
  roomId: z.string().min(1),
  roomIndex: z.number().int().nonnegative(),
  leaderboardUsername: z.string().min(1),
  maxAttempts: z.number().int().positive(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  rulesVersion: z.string().min(1),
  reused: z.boolean(),
  backendMode: z.literal('edge_rooms'),
  edgeBaseUrl: z.string().url(),
  ticket: z.string().startsWith('bqt1.'),
});

export type QuizEdgeCheckInSession = z.infer<
  typeof quizEdgeCheckInResponseSchema
> & {
  expectedUserId?: string;
};

const activeEdgeSessions = new Map<string, QuizEdgeCheckInSession>();

function sessionKey(eventId: string, expectedUserId?: string): string {
  return `${eventId}:${expectedUserId ?? 'anon'}`;
}

export function getQuizEdgeSession(
  eventId: string,
  expectedUserId?: string
): QuizEdgeCheckInSession | undefined {
  return activeEdgeSessions.get(sessionKey(eventId, expectedUserId));
}

export function clearQuizEdgeSession(
  eventId: string,
  expectedUserId?: string
): void {
  activeEdgeSessions.delete(sessionKey(eventId, expectedUserId));
}

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
  activeEdgeSessions.set(
    sessionKey(input.eventId, input.expectedUserId),
    session
  );
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
      if (error instanceof QuizServiceError && error.status < 500) {
        throw error;
      }
      lastError = timedOut
        ? new QuizServiceError(
            'Quiz request timed out. Please try again.',
            'QUIZ_REQUEST_TIMEOUT',
            504
          )
        : error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

export function startQuizEdgeAttempt(
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
  return fetchEdgeJson(
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
}

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
      questionId: input.questionId,
    },
    quizV2AttemptResponseSchema,
    2
  );
}
