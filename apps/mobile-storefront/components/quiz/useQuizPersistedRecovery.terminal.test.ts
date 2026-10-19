import { jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { QuizV2StoreActions } from '@/stores/quiz-recovery-envelope';
import { loadQuizRecoveryEnvelopes } from '@/stores/quiz-recovery-envelope';
import { useQuizPersistedRecovery } from './useQuizPersistedRecovery';

type RecoverEvent = QuizV2StoreActions['recoverEvent'];

jest.mock('@/lib/get-quiz-device-fingerprint', () => ({
  getQuizDeviceFingerprint: jest
    .fn<() => Promise<string | null>>()
    .mockResolvedValue(null),
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

describe('useQuizPersistedRecovery terminal envelopes', () => {
  afterEach(() => jest.clearAllMocks());

  it('exposes retained terminal attempts one at a time', async () => {
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
      {
        attemptId: 'attempt-2',
        currentQuestionId: null,
        eventId: 'event-2',
        generation: 2,
        pendingLockedOptionId: null,
        startRequestId: '22222222-2222-4222-8222-222222222222',
        userId: 'user-1',
        version: 1,
      },
    ]);
    const recoverEvent = jest
      .fn<RecoverEvent>()
      .mockResolvedValue('recovered_terminal');

    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useQuizPersistedRecovery({
          enabled,
          recoverEvent,
          userId: 'user-1',
        }),
      { initialProps: { enabled: true } }
    );

    await waitFor(() => expect(recoverEvent).toHaveBeenCalledTimes(1));
    expect(recoverEvent).toHaveBeenNthCalledWith(
      1,
      'user-1',
      'event-1',
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ userId: 'user-1' })
    );
    rerender({ enabled: false });
    rerender({ enabled: true });
    await waitFor(() => expect(recoverEvent).toHaveBeenCalledTimes(2));
    expect(recoverEvent).toHaveBeenNthCalledWith(
      2,
      'user-1',
      'event-2',
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ userId: 'user-1' })
    );
  });

  it('does not recover an envelope after a manual start takes ownership', async () => {
    let resolveLoad!: (value: []) => void;
    let canRecover = true;
    jest
      .mocked(loadQuizRecoveryEnvelopes)
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveLoad = resolve))
      );
    const recoverEvent = jest.fn<RecoverEvent>().mockResolvedValue('recovered');

    renderHook(() =>
      useQuizPersistedRecovery({
        canRecover: () => canRecover,
        enabled: true,
        recoverEvent,
        userId: 'user-1',
      })
    );

    canRecover = false;
    await act(async () => {
      resolveLoad([]);
      await Promise.resolve();
    });

    expect(recoverEvent).not.toHaveBeenCalled();
  });

  it('does not accept a terminal recovery after another event takes ownership', async () => {
    jest.mocked(loadQuizRecoveryEnvelopes).mockResolvedValue([
      {
        attemptId: 'attempt-a',
        currentQuestionId: null,
        eventId: 'event-a',
        generation: 1,
        pendingLockedOptionId: null,
        startRequestId: '11111111-1111-4111-8111-111111111111',
        userId: 'user-1',
        version: 1,
      },
      {
        attemptId: 'attempt-b',
        currentQuestionId: null,
        eventId: 'event-b',
        generation: 2,
        pendingLockedOptionId: null,
        startRequestId: '22222222-2222-4222-8222-222222222222',
        userId: 'user-1',
        version: 1,
      },
    ]);
    let currentEvent = 'event-a';
    const recoverEvent = jest
      .fn<RecoverEvent>()
      .mockImplementation(async (_userId, eventId) => {
        expect(eventId).toBe('event-a');
        currentEvent = 'event-b';
        return 'recovered_terminal';
      });

    const { result } = renderHook(() =>
      useQuizPersistedRecovery({
        canRecover: (eventId) => !eventId || eventId === currentEvent,
        enabled: true,
        recoverEvent,
        userId: 'user-1',
      })
    );

    await waitFor(() => expect(recoverEvent).toHaveBeenCalledTimes(1));
    act(() => result.current.retryRecovery());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(recoverEvent).toHaveBeenCalledTimes(1);
  });
});
