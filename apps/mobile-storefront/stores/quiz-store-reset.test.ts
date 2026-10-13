import { act } from '@testing-library/react-native';
import { asyncStorage } from '@/lib/storage';
import { useQuizStore } from './quiz-store';
import { attempt, events, result } from './quiz-store.test-utils';

describe('useQuizStore reset and explicit errors', () => {
  beforeEach(() => {
    useQuizStore.getState().reset();
  });

  it('sets an explicit action error state', () => {
    act(() => {
      useQuizStore.getState().setError('Unexpected quiz failure');
    });

    expect(useQuizStore.getState()).toMatchObject({
      status: 'error',
      error: 'Unexpected quiz failure',
    });
  });

  it('resets all state to initial values', () => {
    act(() => {
      useQuizStore.setState({
        status: 'result',
        events,
        selectedEventId: 'event-1',
        attempt,
        attemptIntegrityTier: 'strong',
        selectedOptionId: 'b',
        result,
        error: 'some error',
      });
    });

    act(() => {
      useQuizStore.getState().reset();
    });

    expect(useQuizStore.getState()).toMatchObject({
      status: 'idle',
      events: [],
      selectedEventId: null,
      attempt: null,
      attemptIntegrityTier: null,
      selectedOptionId: null,
      result: null,
      error: null,
    });
  });

  it('resets every v2 field even if recovery storage rejects cleanup', async () => {
    const removeItem = jest
      .spyOn(asyncStorage, 'removeItem')
      .mockRejectedValueOnce(new Error('disk'));
    useQuizStore.setState({
      lockedOptionId: 'option-1',
      recoveryUserId: 'user-1',
      selectedEventId: 'event-1',
      startRequestId: '11111111-1111-4111-8111-111111111111',
      status: 'submitting',
      v2Attempt: {
        attemptId: 'attempt-v2',
        eventEndsAt: '2026-08-04T12:05:00.000Z',
        eventId: 'event-1',
        resultsAvailableAt: null,
        serverNow: '2026-08-04T12:00:00.000Z',
        status: 'in_progress',
      },
      v2LifecycleStatus: 'in_progress',
      v2Result: {
        attemptId: 'attempt-v2',
        availability: 'pending',
        availableAt: null,
      },
    });

    act(() => useQuizStore.getState().reset());
    await Promise.resolve();

    expect(useQuizStore.getState()).toMatchObject({
      lockedOptionId: null,
      recoveryUserId: null,
      selectedEventId: null,
      startRequestId: null,
      status: 'idle',
      v2Attempt: null,
      v2LifecycleStatus: 'idle',
      v2Result: null,
    });
    removeItem.mockRestore();
  });

  it('retains pending-result recovery through an auth reset', async () => {
    await Promise.resolve();
    const removeItem = jest
      .spyOn(asyncStorage, 'removeItem')
      .mockResolvedValue(undefined);
    useQuizStore.setState({
      recoveryUserId: 'user-1',
      selectedEventId: 'event-1',
      startRequestId: '11111111-1111-4111-8111-111111111111',
      status: 'result',
      terminalContext: {
        attemptId: 'attempt-1',
        contractVersion: 2,
        eventId: 'event-1',
        eventEndsAt: '2026-08-04T12:05:00.000Z',
        serverNow: '2026-08-04T12:05:00.000Z',
      },
      v2LifecycleStatus: 'pending_results',
    });

    act(() => useQuizStore.getState().reset());

    expect(removeItem).not.toHaveBeenCalled();
    removeItem.mockRestore();
  });

  it('retains an unclaimed final prize recovery through an auth reset', async () => {
    await Promise.resolve();
    const removeItem = jest
      .spyOn(asyncStorage, 'removeItem')
      .mockResolvedValue(undefined);
    useQuizStore.setState({
      recoveryUserId: 'user-1',
      selectedEventId: 'event-1',
      status: 'result',
      terminalContext: {
        attemptId: 'attempt-1',
        contractVersion: 2,
        eventId: 'event-1',
        eventEndsAt: '2026-08-04T12:05:00.000Z',
        serverNow: '2026-08-04T12:05:00.000Z',
      },
      v2LifecycleStatus: 'final',
      v2Result: {
        attemptId: 'attempt-1',
        availability: 'final',
        availableAt: '2026-08-04T12:06:00.000Z',
        prizeClaim: {
          awardId: 'award-1',
          cartPath: '/checkout',
          condition: null,
          productId: 'product-1',
          variantId: null,
          voucherToken: 'voucher-token',
        },
        rank: 1,
        score: 2,
        totalQuestions: 2,
      },
    });

    act(() => useQuizStore.getState().reset());

    expect(removeItem).not.toHaveBeenCalled();
    removeItem.mockRestore();
  });

  it('preserves active recovery storage when an account switch resets the store', async () => {
    const removeItem = jest
      .spyOn(asyncStorage, 'removeItem')
      .mockResolvedValue(undefined);
    useQuizStore.setState({
      recoveryUserId: 'user-1',
      selectedEventId: 'event-1',
      startRequestId: '11111111-1111-4111-8111-111111111111',
      status: 'question',
      v2LifecycleStatus: 'in_progress',
    });

    act(() => useQuizStore.getState().resetForAccountChange());
    await Promise.resolve();

    expect(removeItem).not.toHaveBeenCalled();
    expect(useQuizStore.getState()).toMatchObject({
      status: 'idle',
      recoveryUserId: null,
      selectedEventId: null,
      v2LifecycleStatus: 'idle',
    });
    removeItem.mockRestore();
  });
});
