import { act } from '@testing-library/react-native';
import type { QuizV2Attempt } from '@/services/quiz-types';
import { loadQuizRecoveryEnvelope } from './quiz-recovery-envelope';
import { QUIZ_RECONCILIATION_INTERVAL_MS, useQuizStore } from './quiz-store';

const activeAttempt: QuizV2Attempt = {
  attemptId: 'attempt-1',
  eventEndsAt: '2026-08-04T12:05:00.000Z',
  eventId: 'event-1',
  question: {
    deadlineAt: '2026-08-04T12:00:10.000Z',
    id: 'question-1',
    index: 1,
    issuedAt: '2026-08-04T12:00:00.000Z',
    options: [{ id: 'a', label: 'A' }],
    prompt: 'Pick one',
    timeLimitSeconds: 10,
    total: 2,
  },
  resultsAvailableAt: null,
  serverNow: '2026-08-04T12:00:00.000Z',
  status: 'in_progress',
};

const startContext = {
  eventId: 'event-1',
  integrityTier: 'strong' as const,
  startRequestId: '11111111-1111-4111-8111-111111111111',
  userId: 'user-1',
};

describe('quiz v2 store recovery', () => {
  beforeEach(() => useQuizStore.getState().reset());

  it('keeps one startRequestId through start and retry recovery', async () => {
    const starter = jest.fn(async () => activeAttempt);
    await act(async () =>
      useQuizStore.getState().startEventV2(startContext, starter)
    );
    expect(starter).toHaveBeenCalledWith(startContext.startRequestId);
    await expect(
      loadQuizRecoveryEnvelope('user-1', 'event-1')
    ).resolves.toMatchObject({
      attemptId: 'attempt-1',
      startRequestId: startContext.startRequestId,
    });
  });

  it('locks on one tap, suppresses duplicates, and preserves the lock on transport failure', async () => {
    await act(async () =>
      useQuizStore
        .getState()
        .startEventV2(startContext, async () => activeAttempt)
    );
    const submitter = jest.fn(async () => {
      throw new Error('network down');
    });
    await act(async () =>
      Promise.all([
        useQuizStore.getState().lockAndSubmitAnswer('a', submitter),
        useQuizStore.getState().lockAndSubmitAnswer('a', submitter),
      ])
    );
    expect(submitter).toHaveBeenCalledTimes(1);
    expect(useQuizStore.getState()).toMatchObject({
      status: 'question',
      lockedOptionId: 'a',
    });
    await expect(
      loadQuizRecoveryEnvelope('user-1', 'event-1')
    ).resolves.toMatchObject({ pendingLockedOptionId: 'a' });
  });

  it('reconciles server-first and resends only the still-unanswered locked question', async () => {
    await act(async () =>
      useQuizStore
        .getState()
        .startEventV2(startContext, async () => activeAttempt)
    );
    await act(async () =>
      useQuizStore.getState().lockAndSubmitAnswer('a', async () => {
        throw new Error('lost response');
      })
    );
    useQuizStore.setState({
      status: 'idle',
      v2Attempt: null,
      lockedOptionId: null,
      startRequestId: null,
      recoveryUserId: null,
      selectedEventId: null,
    });
    const terminal: QuizV2Attempt = {
      ...activeAttempt,
      question: undefined,
      resultsAvailableAt: '2026-08-04T12:06:00.000Z',
      status: 'submitted_pending_results',
    };
    const resender = jest.fn(async () => terminal);
    await act(async () =>
      useQuizStore.getState().recoverEvent(
        'user-1',
        'event-1',
        async () => ({
          attempt: activeAttempt,
          availability: 'active',
          eventEndsAt: activeAttempt.eventEndsAt,
          serverNow: activeAttempt.serverNow,
        }),
        resender
      )
    );
    expect(resender).toHaveBeenCalledWith('a', 'question-1');
    expect(useQuizStore.getState().v2LifecycleStatus).toBe('pending_results');
  });

  it('keeps terminal recovery until the final result is available', async () => {
    await act(async () =>
      useQuizStore
        .getState()
        .startEventV2(startContext, async () => activeAttempt)
    );
    await act(async () =>
      useQuizStore.getState().expireActiveEvent(async () => ({
        availability: 'pending_results',
        eventEndsAt: activeAttempt.eventEndsAt,
        serverNow: activeAttempt.serverNow,
      }))
    );

    await expect(
      loadQuizRecoveryEnvelope('user-1', 'event-1')
    ).resolves.toMatchObject({ attemptId: 'attempt-1' });

    await act(async () => {
      useQuizStore.getState().setV2Result({
        attemptId: 'attempt-1',
        availability: 'final',
        availableAt: '2026-08-04T12:06:00.000Z',
        rank: 1,
        score: 2,
        totalQuestions: 2,
      });
      await Promise.resolve();
    });

    await expect(
      loadQuizRecoveryEnvelope('user-1', 'event-1')
    ).resolves.toBeNull();
  });

  it('retains terminal recovery while a final prize is still claimable', async () => {
    await act(async () =>
      useQuizStore
        .getState()
        .startEventV2(startContext, async () => activeAttempt)
    );
    await act(async () =>
      useQuizStore.getState().expireActiveEvent(async () => ({
        availability: 'pending_results',
        eventEndsAt: activeAttempt.eventEndsAt,
        serverNow: activeAttempt.serverNow,
      }))
    );

    await act(async () => {
      useQuizStore.getState().setV2Result({
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
      });
      await Promise.resolve();
    });

    await expect(
      loadQuizRecoveryEnvelope('user-1', 'event-1')
    ).resolves.toMatchObject({ attemptId: 'attempt-1' });
  });

  it('returns to the ready state when persisted recovery cannot reach the server', async () => {
    await act(async () =>
      useQuizStore.getState().recoverEvent(
        'user-1',
        'event-1',
        async () => {
          throw new Error('network down');
        },
        jest.fn()
      )
    );

    expect(useQuizStore.getState()).toMatchObject({
      error: 'network down',
      status: 'ready',
    });
  });

  it('coalesces lifecycle reconciliation to 15 seconds and observes cancellation', async () => {
    await act(async () =>
      useQuizStore
        .getState()
        .startEventV2(startContext, async () => activeAttempt)
    );
    const reconciler = jest.fn(async () => ({
      availability: 'active' as const,
      attempt: activeAttempt,
      eventEndsAt: activeAttempt.eventEndsAt,
      serverNow: activeAttempt.serverNow,
    }));
    await act(async () =>
      useQuizStore.getState().reconcileLifecycle(reconciler, 1_000)
    );
    await act(async () =>
      useQuizStore
        .getState()
        .reconcileLifecycle(
          reconciler,
          1_000 + QUIZ_RECONCILIATION_INTERVAL_MS - 1
        )
    );
    expect(reconciler).toHaveBeenCalledTimes(1);
    await act(async () =>
      useQuizStore.getState().reconcileLifecycle(
        async () => ({
          availability: 'cancelled',
          eventEndsAt: activeAttempt.eventEndsAt,
          serverNow: activeAttempt.serverNow,
        }),
        1_000 + QUIZ_RECONCILIATION_INTERVAL_MS
      )
    );
    expect(useQuizStore.getState().v2LifecycleStatus).toBe('event_cancelled');
  });
  it('expiry_ignores_stale_submit_response', async () => {
    // Arrange
    await act(async () =>
      useQuizStore
        .getState()
        .startEventV2(startContext, async () => activeAttempt)
    );
    let resolveSubmit!: (attempt: QuizV2Attempt) => void;
    const submitPromise = new Promise<QuizV2Attempt>((resolve) => {
      resolveSubmit = resolve;
    });
    const submitOperation = useQuizStore
      .getState()
      .lockAndSubmitAnswer('a', async () => submitPromise);
    await act(async () => Promise.resolve());

    // Act
    await act(async () =>
      useQuizStore.getState().expireActiveEvent(async () => ({
        availability: 'pending_results',
        eventEndsAt: activeAttempt.eventEndsAt,
        serverNow: activeAttempt.serverNow,
      }))
    );
    resolveSubmit({ ...activeAttempt, status: 'in_progress' });
    await act(async () => submitOperation);

    // Assert
    expect(useQuizStore.getState().status).toBe('result');
    expect(useQuizStore.getState().v2LifecycleStatus).toBe('pending_results');
  });
});
