import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { z } from 'zod';
import { resolveApiBaseUrl } from '@/lib/api-url';
import { getQuizAuthHeaders } from '@/services/quiz-auth-headers';
import {
  getOptionalString,
  getQuizErrorCode,
  getQuizErrorMessage,
  readQuizJson,
} from '@/services/quiz-service-utils';
import type { QuizServiceOptions } from '@/services/quiz-types';
import { QuizServiceError } from '@/services/quiz-types';

export const QUIZ_REQUEST_TIMEOUT_MS = 15_000;
export const QUIZ_CONTRACT_HEADER = 'X-Baci-Quiz-Contract';
export const QUIZ_CONTRACT_VERSION = '2';
/** Opt-in so the events list includes `attemptsUsed`; older servers ignore it. */
export const QUIZ_ATTEMPTS_USED_HEADER = 'X-Baci-Quiz-Attempts-Used';

export function getQuizApiBaseUrl(configuredUrl?: string): string {
  const extra = getExpoExtraConfig(Constants.expoConfig?.extra);
  return resolveApiBaseUrl(configuredUrl ?? extra?.apiBaseUrl ?? extra?.apiUrl);
}

export function getQuizAppMetadata(): {
  appVersion: string;
  platform: 'android' | 'ios' | 'web';
} {
  const platform =
    Platform.OS === 'android' || Platform.OS === 'ios' ? Platform.OS : 'web';
  return {
    appVersion: Constants.expoConfig?.version?.trim() || 'unknown',
    platform,
  };
}

function getExpoExtraConfig(value: unknown):
  | {
      apiBaseUrl?: string;
      apiUrl?: string;
    }
  | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const extra = value as Record<string, unknown>;
  const apiBaseUrl = getOptionalString(extra.apiBaseUrl);
  const apiUrl = getOptionalString(extra.apiUrl);
  return { apiBaseUrl, apiUrl };
}

type QuizRequestSignal = {
  cleanup: () => void;
  isTimedOut: () => boolean;
  signal: AbortSignal;
};

function createQuizRequestSignal(
  callerSignal?: AbortSignal | null
): QuizRequestSignal {
  const controller = new AbortController();
  let timedOut = false;
  const abortForCaller = () => controller.abort();

  if (callerSignal?.aborted) abortForCaller();
  else callerSignal?.addEventListener('abort', abortForCaller, { once: true });

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, QUIZ_REQUEST_TIMEOUT_MS);

  return {
    cleanup: () => {
      clearTimeout(timeoutId);
      callerSignal?.removeEventListener('abort', abortForCaller);
    },
    isTimedOut: () => timedOut,
    signal: controller.signal,
  };
}

export async function requestQuiz<T>(
  path: string,
  init: RequestInit,
  responseSchema: z.ZodType<T>,
  baseUrl?: string,
  expectedUserId?: string
): Promise<T> {
  const { headers: authHeaders, userId } = await getQuizAuthHeaders();
  // Bind the request to the shopper the caller intended: if the account signed
  // out or switched while the auth headers resolved, the token now belongs to a
  // different user, so refuse rather than spend their attempt.
  if (expectedUserId !== undefined && userId !== expectedUserId) {
    throw new QuizServiceError(
      'Your session changed. Please try again.',
      'quiz_session_changed',
      409
    );
  }
  const requestHeaders = new Headers({
    Accept: 'application/json',
    'Content-Type': 'application/json',
  });
  new Headers(init.headers).forEach((value, key) => {
    requestHeaders.set(key, value);
  });
  // Authentication is authoritative and must be applied last with the
  // case-insensitive Headers API. A caller-supplied `authorization` spelling
  // must never coexist with or override the verified bearer token.
  new Headers(authHeaders).forEach((value, key) => {
    requestHeaders.set(key, value);
  });
  const requestSignal = createQuizRequestSignal(init.signal);
  let response: Response;
  try {
    response = await fetch(`${getQuizApiBaseUrl(baseUrl)}${path}`, {
      ...init,
      headers: requestHeaders,
      signal: requestSignal.signal,
    });
  } catch (error) {
    if (requestSignal.isTimedOut()) {
      throw new QuizServiceError(
        'Quiz request timed out. Please try again.',
        'QUIZ_REQUEST_TIMEOUT',
        504
      );
    }
    throw error;
  } finally {
    requestSignal.cleanup();
  }
  const payload = await readQuizJson(response);

  if (!response.ok) {
    throw new QuizServiceError(
      getQuizErrorMessage(payload),
      getQuizErrorCode(payload),
      response.status
    );
  }

  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new QuizServiceError(
      'Invalid quiz response',
      'QUIZ_INVALID_RESPONSE',
      502
    );
  }

  return parsed.data;
}

export function requestQuizV2<T>(
  path: string,
  init: RequestInit,
  responseSchema: z.ZodType<T>,
  options: QuizServiceOptions & {
    expectedUserId?: string;
    deviceFingerprint?: string | null;
  } = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set(QUIZ_CONTRACT_HEADER, QUIZ_CONTRACT_VERSION);
  if (options.deviceFingerprint) {
    headers.set('X-Baci-Quiz-Device-Fingerprint', options.deviceFingerprint);
  }
  return requestQuiz(
    path,
    {
      ...init,
      headers,
    },
    responseSchema,
    options.baseUrl,
    options.expectedUserId
  );
}
