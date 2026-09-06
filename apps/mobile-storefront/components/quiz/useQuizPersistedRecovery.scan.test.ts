import { jest } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react-native';
import type { QuizV2StoreActions } from '@/stores/quiz-recovery-envelope';
import { loadQuizRecoveryEnvelopes } from '@/stores/quiz-recovery-envelope';
import { useQuizPersistedRecovery } from './useQuizPersistedRecovery';

type RecoverEvent = QuizV2StoreActions['recoverEvent'];

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
  loadQuizRecoveryEnvelopes: jest.fn(),
}));

afterEach(() => jest.clearAllMocks());

it('discards stale envelopes until a later retained attempt is recovered', async () => {
  jest.mocked(loadQuizRecoveryEnvelopes).mockResolvedValue([
    {
      attemptId: null,
      currentQuestionId: null,
      eventId: 'stale-event',
      generation: 5,
      pendingLockedOptionId: null,
      startRequestId: '11111111-1111-4111-8111-111111111111',
      userId: 'user-1',
      version: 1,
    },
    {
      attemptId: 'attempt-2',
      currentQuestionId: null,
      eventId: 'retained-event',
      generation: 4,
      pendingLockedOptionId: null,
      startRequestId: '22222222-2222-4222-8222-222222222222',
      userId: 'user-1',
      version: 1,
    },
  ]);
  const recoverEvent = jest.fn<RecoverEvent>();
  recoverEvent.mockImplementation(async (_userId, eventId) =>
    eventId === 'stale-event' ? 'not_found' : 'recovered'
  );

  renderHook(() =>
    useQuizPersistedRecovery({
      enabled: true,
      recoverEvent,
      userId: 'user-1',
    })
  );

  await waitFor(() => expect(recoverEvent).toHaveBeenCalledTimes(2));
  expect(recoverEvent).toHaveBeenNthCalledWith(
    2,
    'user-1',
    'retained-event',
    expect.any(Function),
    expect.any(Function),
    expect.objectContaining({ userId: 'user-1' })
  );
});

it('allows one automatic retry after a transient recovery failure', async () => {
  jest.mocked(loadQuizRecoveryEnvelopes).mockResolvedValue([
    {
      attemptId: 'attempt-1',
      currentQuestionId: null,
      eventId: 'event-1',
      generation: 1,
      pendingLockedOptionId: null,
      startRequestId: '11111111-1111-4111-8111-111111111111',
      userId: 'user-1',
      version: 1,
    },
  ]);
  const recoverEvent = jest
    .fn<RecoverEvent>()
    .mockResolvedValueOnce('retry')
    .mockResolvedValueOnce('recovered');

  renderHook(() =>
    useQuizPersistedRecovery({
      enabled: true,
      recoverEvent,
      userId: 'user-1',
    })
  );

  await waitFor(() => expect(recoverEvent).toHaveBeenCalledTimes(2));
});

it('continues to a retained terminal attempt after another event fails', async () => {
  jest.mocked(loadQuizRecoveryEnvelopes).mockResolvedValue([
    {
      attemptId: 'attempt-active',
      currentQuestionId: 'question-1',
      eventId: 'event-active',
      generation: 2,
      pendingLockedOptionId: null,
      startRequestId: '11111111-1111-4111-8111-111111111111',
      userId: 'user-1',
      version: 1,
    },
    {
      attemptId: 'attempt-terminal',
      currentQuestionId: null,
      eventId: 'event-terminal',
      generation: 1,
      pendingLockedOptionId: null,
      startRequestId: '22222222-2222-4222-8222-222222222222',
      userId: 'user-1',
      version: 1,
    },
  ]);
  const recoverEvent = jest
    .fn<RecoverEvent>()
    .mockResolvedValueOnce('retry')
    .mockResolvedValueOnce('recovered_terminal');

  renderHook(() =>
    useQuizPersistedRecovery({
      enabled: true,
      recoverEvent,
      userId: 'user-1',
    })
  );

  await waitFor(() => expect(recoverEvent).toHaveBeenCalledTimes(2));
  expect(recoverEvent).toHaveBeenNthCalledWith(
    2,
    'user-1',
    'event-terminal',
    expect.any(Function),
    expect.any(Function),
    expect.objectContaining({ userId: 'user-1' })
  );
});
