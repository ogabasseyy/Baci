import { jest } from '@jest/globals';
import type {
  QuizActiveAttemptResponse,
  QuizV2Attempt,
} from '@/services/quiz-types';
import {
  initialQuizV2State,
  type QuizRecoveryEnvelope,
  type QuizV2StoreState,
  type V2StartContext,
} from './quiz-recovery-envelope';

export const mockPersist =
  jest.fn<
    (attempt: QuizV2Attempt, lockedOptionId: string | null) => Promise<void>
  >();
export const mockLoadRecoveryEnvelope =
  jest.fn<
    (userId: string, eventId: string) => Promise<QuizRecoveryEnvelope | null>
  >();
export const mockSaveQuizStartRequest =
  jest.fn<
    (
      context: V2StartContext,
      generation: number,
      startRequestId: string
    ) => Promise<void>
  >();
export const mockClearRecoveredQuizAttempt = jest.fn(async () => undefined);

jest.mock('./quiz-recovery-envelope', () => {
  const actual = jest.requireActual<typeof import('./quiz-recovery-envelope')>(
    './quiz-recovery-envelope'
  );
  return {
    ...actual,
    loadQuizRecoveryEnvelope: (
      ...args: Parameters<typeof actual.loadQuizRecoveryEnvelope>
    ) => mockLoadRecoveryEnvelope(...args),
  };
});
jest.mock('./quiz-v2-recovery-storage', () => {
  const actual = jest.requireActual<
    typeof import('./quiz-v2-recovery-storage')
  >('./quiz-v2-recovery-storage');
  return {
    ...actual,
    clearRecoveredQuizAttempt: mockClearRecoveredQuizAttempt,
    clearTerminalRecovery: jest.fn(async () => undefined),
    createQuizAttemptPersistence: jest.fn(() => mockPersist),
    saveQuizStartRequest: (
      context: V2StartContext,
      generation: number,
      startRequestId: string
    ) => mockSaveQuizStartRequest(context, generation, startRequestId),
  };
});

export const activeAttempt: QuizV2Attempt = {
  attemptId: 'attempt-1',
  eventEndsAt: '2026-08-04T12:05:00.000Z',
  eventId: 'event-1',
  question: {
    deadlineAt: '2026-08-04T12:00:10.000Z',
    id: 'question-1',
    index: 1,
    issuedAt: '2026-08-04T12:00:00.000Z',
    options: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ],
    prompt: 'Pick one',
    timeLimitSeconds: 10,
    total: 2,
  },
  resultsAvailableAt: null,
  serverNow: '2026-08-04T12:00:00.000Z',
  status: 'in_progress',
};
const requiredActiveQuestion = activeAttempt.question;
if (!requiredActiveQuestion)
  throw new Error('The active-attempt fixture needs a question');
export const activeQuestion = requiredActiveQuestion;
export const cancelledAttempt: QuizV2Attempt = {
  ...activeAttempt,
  status: 'event_cancelled',
};

export function createHarness() {
  const { createQuizV2StoreActions } =
    require('./quiz-v2-store-actions') as typeof import('./quiz-v2-store-actions');
  let generation = 0;
  let state = {
    ...initialQuizV2State,
    attemptIntegrityTier: 'strong' as const,
    error: null,
    recoveryUserId: 'user-1',
    selectedEventId: activeAttempt.eventId,
    startRequestId: '11111111-1111-4111-8111-111111111111',
    status: 'question' as const,
    v2Attempt: activeAttempt,
  } as QuizV2StoreState;
  const set = (patch: Partial<QuizV2StoreState>) => {
    state = { ...state, ...patch };
  };
  const actions = createQuizV2StoreActions({
    get: () => state,
    getGeneration: () => generation,
    getMessage: (error) =>
      error instanceof Error ? error.message : String(error),
    set,
  });
  return {
    actions,
    getState: () => state,
    set,
    setGeneration: (nextGeneration: number) => {
      generation = nextGeneration;
    },
  };
}

export function response(
  overrides: Partial<QuizActiveAttemptResponse>
): QuizActiveAttemptResponse {
  return {
    availability: 'active',
    attempt: activeAttempt,
    eventEndsAt: activeAttempt.eventEndsAt,
    serverNow: activeAttempt.serverNow,
    ...overrides,
  };
}

export function resetQuizV2StoreActionMocks() {
  mockPersist.mockReset();
  mockLoadRecoveryEnvelope.mockReset();
  mockSaveQuizStartRequest.mockReset();
  mockClearRecoveredQuizAttempt.mockReset();
  mockPersist.mockResolvedValue(undefined);
  mockLoadRecoveryEnvelope.mockResolvedValue(null);
  mockSaveQuizStartRequest.mockResolvedValue(undefined);
  mockClearRecoveredQuizAttempt.mockResolvedValue(undefined);
}
