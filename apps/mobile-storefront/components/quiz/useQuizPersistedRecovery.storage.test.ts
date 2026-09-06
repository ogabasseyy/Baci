import { renderHook, waitFor } from '@testing-library/react-native';
import { recoverActiveQuizAttempt } from '@/services/quiz-attempt-recovery';
import { submitQuizAnswerV2 } from '@/services/quiz-attempts';
import type { QuizV2Attempt } from '@/services/quiz-types';
import {
  loadQuizRecoveryEnvelope,
  loadQuizRecoveryEnvelopes,
} from '@/stores/quiz-recovery-envelope';
import { useQuizStore } from '@/stores/quiz-store';
import { useQuizPersistedRecovery } from './useQuizPersistedRecovery';

jest.mock('@/lib/get-quiz-device-fingerprint', () => ({
  getQuizDeviceFingerprint: jest.fn(async () => 'a'.repeat(64)),
}));
jest.mock('@/services/quiz-attempt-recovery', () => ({
  recoverActiveQuizAttempt: jest.fn(),
}));
jest.mock('@/services/quiz-attempts', () => ({
  submitQuizAnswerV2: jest.fn(),
}));
jest.mock('@/stores/quiz-recovery-envelope', () => ({
  ...jest.requireActual('@/stores/quiz-recovery-envelope'),
  loadQuizRecoveryEnvelopes: jest.fn(),
  loadQuizRecoveryEnvelope: jest.fn(),
}));

afterEach(() => {
  useQuizStore.getState().reset();
  jest.clearAllMocks();
});

it('resends the scanned locked answer when the storage reread fails without an in-memory request ID', async () => {
  useQuizStore.getState().reset();
  const attempt: QuizV2Attempt = {
    attemptId: 'attempt-1',
    eventId: 'event-1',
    eventEndsAt: '2026-09-06T12:05:00Z',
    serverNow: '2026-09-06T12:00:00Z',
    status: 'in_progress',
    resultsAvailableAt: null,
    question: {
      id: 'question-1',
      index: 1,
      total: 2,
      prompt: 'Pick',
      options: [{ id: 'a', label: 'A' }],
      issuedAt: '2026-09-06T12:00:00Z',
      deadlineAt: '2026-09-06T12:00:10Z',
      timeLimitSeconds: 10,
    },
  };
  jest.mocked(loadQuizRecoveryEnvelopes).mockResolvedValue([
    {
      attemptId: 'attempt-1',
      currentQuestionId: 'question-1',
      eventId: 'event-1',
      generation: 0,
      pendingLockedOptionId: 'a',
      startRequestId: '11111111-1111-4111-8111-111111111111',
      userId: 'user-1',
      version: 1,
    },
  ]);
  jest
    .mocked(loadQuizRecoveryEnvelope)
    .mockRejectedValue(new Error('storage unavailable'));
  jest.mocked(recoverActiveQuizAttempt).mockResolvedValue({
    availability: 'active',
    attempt,
    eventEndsAt: attempt.eventEndsAt,
    serverNow: attempt.serverNow,
  });
  jest.mocked(submitQuizAnswerV2).mockResolvedValue({
    ...attempt,
    status: 'submitted_pending_results',
    question: undefined,
  });
  renderHook(() =>
    useQuizPersistedRecovery({
      enabled: true,
      recoverEvent: useQuizStore.getState().recoverEvent,
      userId: 'user-1',
    })
  );
  await waitFor(() => expect(useQuizStore.getState().status).toBe('result'), {
    timeout: 500,
  });
  expect(useQuizStore.getState().startRequestId).toBe(
    '11111111-1111-4111-8111-111111111111'
  );
  expect(submitQuizAnswerV2).toHaveBeenCalledWith(
    expect.objectContaining({
      answer: 'a',
      attemptId: 'attempt-1',
      questionId: 'question-1',
      expectedUserId: 'user-1',
    })
  );
});
