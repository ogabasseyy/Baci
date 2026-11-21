import { QUIZ_FREE_ENTRY_MODE } from '@baci/shared/constants';
import * as Crypto from 'expo-crypto';
import { quizV2AttemptResponseSchema } from '@/schemas/quiz-schemas';
import {
  getQuizAppMetadata,
  requestQuizV2,
  startQuizAttempt,
  submitQuizAnswer,
} from './quiz';
import { getQuizAttestationHeaders } from './quiz-app-attestation';
import {
  checkInQuizEdgeEvent,
  getQuizEdgeSession,
  resolveQuizEdgeSessionForAttempt,
  startQuizEdgeAttempt,
  submitQuizEdgeAnswer,
} from './quiz-edge-transport';
import type {
  QuizV2Attempt,
  StartQuizAttemptV2Input,
  SubmitQuizAnswerV2Input,
} from './quiz-types';
import { QuizServiceError } from './quiz-types';

export type {
  QuizAttempt,
  QuizResult,
  StartQuizAttemptInput,
  SubmitQuizAnswerInput,
} from './quiz-types';
export { startQuizAttempt, submitQuizAnswer };

export function createQuizStartRequestId(): string {
  return Crypto.randomUUID();
}

export async function startQuizAttemptV2(
  input: StartQuizAttemptV2Input
): Promise<QuizV2Attempt> {
  const {
    acceptedRulesVersion,
    backendMode,
    baseUrl,
    deviceFingerprint,
    eventId,
    expectedUserId,
    integrityTier,
    mode,
    startRequestId,
    termsAccepted,
  } = input;
  if (backendMode === 'edge_rooms') {
    const existingSession = getQuizEdgeSession(eventId, expectedUserId);
    const session =
      existingSession ??
      (await checkInQuizEdgeEvent({
        ...input,
        checkInRequestId: startRequestId,
      }));
    return await startQuizEdgeAttempt(session, {
      acceptedRulesVersion,
      eventId,
      integrityTier,
      startRequestId,
      termsAccepted,
    });
  }
  if (mode === 'live' && !deviceFingerprint) {
    throw new QuizServiceError(
      'This app needs a device identity before a live quiz can start.',
      'QUIZ_DEVICE_REQUIRED',
      409
    );
  }
  const { appVersion, platform } = getQuizAppMetadata();
  // Live prizes need proof this is the real app on a real device: a server
  // challenge plus a fresh App Check token minted after it.
  const attestationHeaders =
    mode === 'live'
      ? await getQuizAttestationHeaders(eventId, { baseUrl, expectedUserId })
      : null;
  return await requestQuizV2(
    '/api/quiz/attempts/start',
    {
      headers: attestationHeaders ?? undefined,
      body: JSON.stringify({
        acceptedRulesVersion,
        appVersion,
        entryMode: QUIZ_FREE_ENTRY_MODE,
        eventId,
        expectedUserId,
        integrityTier,
        platform,
        startRequestId,
        termsAccepted,
      }),
      method: 'POST',
    },
    quizV2AttemptResponseSchema,
    { baseUrl, deviceFingerprint, expectedUserId }
  );
}

export async function submitQuizAnswerV2({
  answer,
  attemptId,
  baseUrl,
  clientAnsweredAt,
  expectedUserId,
  questionId,
}: SubmitQuizAnswerV2Input): Promise<QuizV2Attempt> {
  const edgeSession = await resolveQuizEdgeSessionForAttempt(attemptId);
  if (edgeSession) {
    return submitQuizEdgeAnswer(edgeSession, {
      answer,
      attemptId,
      clientAnsweredAt,
      questionId,
    });
  }
  return requestQuizV2(
    `/api/quiz/attempts/${encodeURIComponent(attemptId)}/answers`,
    {
      body: JSON.stringify({
        answer,
        ...(clientAnsweredAt ? { clientAnsweredAt } : {}),
        questionId,
      }),
      method: 'POST',
    },
    quizV2AttemptResponseSchema,
    { baseUrl, expectedUserId }
  );
}
