import { QUIZ_FREE_ENTRY_MODE } from '@baci/shared/constants';
import Constants from 'expo-constants';
import { CONFIG } from '@/lib/config';
import {
  quizAttemptSchema,
  quizEventsResponseSchema,
  quizResultSchema,
} from '@/schemas/quiz-schemas';
import { requestQuiz, requestQuizV2 } from '@/services/quiz-request';
import { getOptionalString } from '@/services/quiz-service-utils';
import type {
  QuizAttempt,
  QuizEvent,
  QuizResult,
  QuizServiceOptions,
  StartQuizAttemptInput,
  SubmitQuizAnswerInput,
} from '@/services/quiz-types';
import { QuizServiceError } from '@/services/quiz-types';

export {
  getQuizApiBaseUrl,
  getQuizAppMetadata,
  QUIZ_CONTRACT_HEADER,
  QUIZ_CONTRACT_VERSION,
  QUIZ_REQUEST_TIMEOUT_MS,
  requestQuizV2,
} from '@/services/quiz-request';
export * from '@/services/quiz-types';

const QUIZ_EVENTS_PAGE_LIMIT = 50;

function getExpoExtraConfig(value: unknown):
  | {
      merchantId?: string;
      merchantSlug?: string;
    }
  | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const extra = value as Record<string, unknown>;
  const merchantId = getOptionalString(extra.merchantId);
  const merchantSlug = getOptionalString(extra.merchantSlug);
  return { merchantId, merchantSlug };
}

function getQuizEventsPath(
  pagination: { limit?: number; offset?: number } = {}
): string {
  const extra = getExpoExtraConfig(Constants.expoConfig?.extra);
  const params = new URLSearchParams();
  const merchantId = extra?.merchantId ?? getOptionalString(CONFIG.MERCHANT_ID);
  const merchantSlug =
    extra?.merchantSlug ?? getOptionalString(CONFIG.MERCHANT_SLUG);

  if (!merchantId && !merchantSlug) {
    throw new QuizServiceError(
      'Quiz merchant context is not configured',
      'QUIZ_CONFIGURATION_REQUIRED',
      500
    );
  }

  if (merchantId) {
    params.set('merchantId', merchantId);
  } else if (merchantSlug) {
    params.set('merchantSlug', merchantSlug);
  }
  if (pagination.limit !== undefined) {
    params.set('limit', String(pagination.limit));
  }
  if (pagination.offset !== undefined) {
    params.set('offset', String(pagination.offset));
  }

  const query = params.toString();
  return `/api/quiz/events?${query}`;
}

export async function fetchQuizEvents(
  options: QuizServiceOptions = {}
): Promise<QuizEvent[]> {
  const events: QuizEvent[] = [];
  let offset = 0;

  for (;;) {
    const payload = await requestQuizV2(
      getQuizEventsPath({ limit: QUIZ_EVENTS_PAGE_LIMIT, offset }),
      { method: 'GET' },
      quizEventsResponseSchema,
      options
    );
    const receivedAtMs = Date.now();
    events.push(
      ...payload.events.map((event) => ({
        ...event,
        serverNow: payload.serverNow,
        serverNowReceivedAtMs: receivedAtMs,
      }))
    );

    if (
      !payload.pagination?.hasMore ||
      payload.pagination.nextOffset === null
    ) {
      return events;
    }
    if (payload.pagination.nextOffset <= offset) {
      throw new QuizServiceError(
        'Invalid quiz pagination response',
        'QUIZ_INVALID_RESPONSE',
        502
      );
    }
    offset = payload.pagination.nextOffset;
  }
}

export function startQuizAttempt({
  baseUrl,
  deviceFingerprint,
  eventId,
  expectedUserId,
  integrityTier,
}: StartQuizAttemptInput): Promise<QuizAttempt> {
  return requestQuiz<QuizAttempt>(
    '/api/quiz/attempts/start',
    {
      method: 'POST',
      body: JSON.stringify({
        entryMode: QUIZ_FREE_ENTRY_MODE,
        eventId,
        integrityTier,
        ...(deviceFingerprint ? { deviceFingerprint } : {}),
      }),
    },
    quizAttemptSchema,
    baseUrl,
    expectedUserId
  );
}

export function submitQuizAnswer({
  answer,
  baseUrl,
  clientAnsweredAt,
  integrityTier,
  attemptId,
  questionId,
}: SubmitQuizAnswerInput): Promise<QuizResult> {
  return requestQuiz<QuizResult>(
    `/api/quiz/attempts/${encodeURIComponent(attemptId)}/answers`,
    {
      method: 'POST',
      body: JSON.stringify({
        answer,
        integrityTier,
        questionId,
        // Sent only when captured so non-timed callers keep the minimal payload.
        ...(clientAnsweredAt ? { clientAnsweredAt } : {}),
      }),
    },
    quizResultSchema,
    baseUrl
  );
}
