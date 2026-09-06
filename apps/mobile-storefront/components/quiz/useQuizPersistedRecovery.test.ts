import { jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { getQuizDeviceFingerprint } from '@/lib/get-quiz-device-fingerprint';
import { recoverActiveQuizAttempt } from '@/services/quiz-attempt-recovery';
import { submitQuizAnswerV2 } from '@/services/quiz-attempts';
import {
  loadQuizRecoveryEnvelopes,
  type QuizV2StoreActions,
} from '@/stores/quiz-recovery-envelope';
import { useQuizPersistedRecovery } from './useQuizPersistedRecovery';

type RecoverEvent = QuizV2StoreActions['recoverEvent'];

jest.mock('@/lib/get-quiz-device-fingerprint', () => ({
  getQuizDeviceFingerprint: jest.fn(),
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

describe('useQuizPersistedRecovery', () => {
  afterEach(() => jest.clearAllMocks());

  it('rehydrates a retained terminal attempt after the app restarts', async () => {
    jest.mocked(loadQuizRecoveryEnvelopes).mockResolvedValue([
      {
        attemptId: 'attempt-1',
        currentQuestionId: null,
        eventId: 'event-1',
        generation: 4,
        pendingLockedOptionId: null,
        startRequestId: '11111111-1111-4111-8111-111111111111',
        userId: 'user-1',
        version: 1,
      },
    ]);
    jest.mocked(getQuizDeviceFingerprint).mockResolvedValue('a'.repeat(64));
    jest.mocked(recoverActiveQuizAttempt).mockResolvedValue({
      availability: 'pending_results',
      eventEndsAt: '2026-08-04T12:05:00.000Z',
      serverNow: '2026-08-04T12:05:00.000Z',
    });
    const recoverEvent = jest.fn<RecoverEvent>();
    recoverEvent.mockImplementation(async (_userId, _eventId, recoverer) => {
      await recoverer();
      return 'recovered_terminal';
    });

    renderHook(() =>
      useQuizPersistedRecovery({
        enabled: true,
        recoverEvent,
        userId: 'user-1',
      })
    );

    await waitFor(() => expect(recoverEvent).toHaveBeenCalledTimes(1));
    expect(recoverActiveQuizAttempt).toHaveBeenCalledWith({
      deviceFingerprint: 'a'.repeat(64),
      eventId: 'event-1',
      expectedUserId: 'user-1',
    });
    expect(submitQuizAnswerV2).not.toHaveBeenCalled();
  });

  it('does not re-run the same persisted recovery while the screen stays ready', async () => {
    jest.mocked(loadQuizRecoveryEnvelopes).mockResolvedValue([]);
    const recoverEvent = jest.fn<RecoverEvent>().mockResolvedValue('recovered');
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useQuizPersistedRecovery({
          enabled,
          recoverEvent,
          userId: 'user-1',
        }),
      { initialProps: { enabled: true } }
    );

    await act(async () => {
      await Promise.resolve();
      rerender({ enabled: true });
    });
    expect(loadQuizRecoveryEnvelopes).toHaveBeenCalledTimes(1);
  });

  it('re-arms recovery when a later terminal envelope is created', async () => {
    let envelopes: Awaited<ReturnType<typeof loadQuizRecoveryEnvelopes>> = [];
    jest
      .mocked(loadQuizRecoveryEnvelopes)
      .mockImplementation(async () => envelopes);
    const recoverEvent = jest
      .fn<RecoverEvent>()
      .mockResolvedValue('recovered_terminal');
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useQuizPersistedRecovery({
          enabled,
          recoverEvent,
          userId: 'user-1',
        }),
      { initialProps: { enabled: true } }
    );

    await waitFor(() => expect(loadQuizRecoveryEnvelopes).toHaveBeenCalled());
    envelopes = [
      {
        attemptId: 'attempt-later',
        currentQuestionId: null,
        eventId: 'event-later',
        generation: 1,
        pendingLockedOptionId: null,
        startRequestId: '11111111-1111-4111-8111-111111111111',
        userId: 'user-1',
        version: 1,
      },
    ];
    rerender({ enabled: false });
    act(() => result.current.retryRecovery());
    rerender({ enabled: true });

    await waitFor(() => expect(recoverEvent).toHaveBeenCalledTimes(1));
    expect(recoverEvent).toHaveBeenCalledWith(
      'user-1',
      'event-later',
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ userId: 'user-1' })
    );
  });
});
