import type {
  QuizActiveAttemptResponse,
  QuizV2Attempt,
} from '@/services/quiz-types';
import {
  initialQuizV2State,
  type QuizV2StoreState,
} from './quiz-recovery-envelope';
import { createQuizV2StoreActions } from './quiz-v2-store-actions';

const activeAttempt: QuizV2Attempt = {
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
const activeQuestion = activeAttempt.question;
if (!activeQuestion)
  throw new Error('The active-attempt fixture needs a question');

function createHarness() {
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
    getGeneration: () => 0,
    getMessage: (error) =>
      error instanceof Error ? error.message : String(error),
    set,
  });
  return { actions, getState: () => state, set };
}

function response(
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

describe('createQuizV2StoreActions terminal expiry', () => {
  it('expiry_applies_active_response', async () => {
    const harness = createHarness();
    const nextAttempt = {
      ...activeAttempt,
      question: {
        ...activeQuestion,
        id: 'question-2',
        index: 2,
      },
    };

    await harness.actions.expireActiveEvent(async () =>
      response({ attempt: nextAttempt })
    );

    expect(harness.getState()).toMatchObject({
      status: 'question',
      v2Attempt: nextAttempt,
      v2LifecycleStatus: 'in_progress',
      terminalContext: null,
    });
  });

  it('expiry_enters_pending_results', async () => {
    const harness = createHarness();

    await harness.actions.expireActiveEvent(async () =>
      response({ availability: 'pending_results', attempt: undefined })
    );

    expect(harness.getState()).toMatchObject({
      status: 'result',
      v2LifecycleStatus: 'pending_results',
      terminalContext: {
        attemptId: activeAttempt.attemptId,
        eventId: activeAttempt.eventId,
        contractVersion: 2,
      },
    });
  });

  it('expiry_enters_cancelled', async () => {
    const harness = createHarness();

    await harness.actions.expireActiveEvent(async () =>
      response({ availability: 'cancelled', attempt: undefined })
    );

    expect(harness.getState()).toMatchObject({
      status: 'result',
      v2LifecycleStatus: 'event_cancelled',
      terminalContext: {
        attemptId: activeAttempt.attemptId,
        eventId: activeAttempt.eventId,
        contractVersion: 2,
      },
    });
  });

  it('expiry_treats_unavailable_as_terminal', async () => {
    const harness = createHarness();

    await harness.actions.expireActiveEvent(async () =>
      response({ availability: 'unavailable', attempt: undefined })
    );

    expect(harness.getState()).toMatchObject({
      status: 'result',
      v2Attempt: null,
      v2LifecycleStatus: 'pending_results',
      expiryRetryable: false,
      terminalContext: {
        attemptId: activeAttempt.attemptId,
        eventId: activeAttempt.eventId,
        contractVersion: 2,
      },
    });
  });

  it('expiry_rejects_expired_active_response', async () => {
    const harness = createHarness();

    await harness.actions.expireActiveEvent(async () =>
      response({
        serverNow: activeAttempt.eventEndsAt,
        attempt: { ...activeAttempt, question: { ...activeQuestion } },
      })
    );

    expect(harness.getState()).toMatchObject({
      status: 'result',
      v2Attempt: null,
      v2LifecycleStatus: 'pending_results',
    });
  });

  it('expiry_deduplicates_concurrent_calls', async () => {
    const harness = createHarness();
    let resolveReconciliation!: (value: QuizActiveAttemptResponse) => void;
    const reconciler = jest.fn(
      () =>
        new Promise<QuizActiveAttemptResponse>((resolve) => {
          resolveReconciliation = resolve;
        })
    );

    const first = harness.actions.expireActiveEvent(reconciler);
    const second = harness.actions.expireActiveEvent(reconciler);
    resolveReconciliation(response({}));
    await Promise.all([first, second]);

    expect(reconciler).toHaveBeenCalledTimes(1);
  });

  it('expiry_preserves_locked_answer_on_network_error', async () => {
    const harness = createHarness();
    harness.set({ lockedOptionId: 'a', status: 'submitting' });

    await harness.actions.expireActiveEvent(async () => {
      throw new Error('network down');
    });

    expect(harness.getState()).toMatchObject({
      lockedOptionId: 'a',
      status: 'question',
      error: 'network down',
      expiryRetryable: true,
    });
  });

  it('retry_locked_answer_resubmits_once', async () => {
    const harness = createHarness();
    harness.set({ lockedOptionId: 'a' });
    const submitter = jest.fn(async () => activeAttempt);

    await Promise.all([
      harness.actions.retryLockedAnswer(submitter),
      harness.actions.retryLockedAnswer(submitter),
    ]);

    expect(submitter).toHaveBeenCalledTimes(1);
    expect(harness.getState()).toMatchObject({
      status: 'question',
      lockedOptionId: null,
    });
  });

  it('retry_locked_answer_ignores_failure_after_expiry', async () => {
    const harness = createHarness();
    harness.set({ lockedOptionId: 'a', status: 'submitting' });
    let rejectRetry!: (error: Error) => void;
    const retry = harness.actions.retryLockedAnswer(
      () =>
        new Promise<QuizV2Attempt>((_, reject) => {
          rejectRetry = reject;
        })
    );

    await harness.actions.expireActiveEvent(async () =>
      response({ availability: 'pending_results', attempt: undefined })
    );
    rejectRetry(new Error('late network failure'));
    await retry;

    expect(harness.getState()).toMatchObject({
      status: 'result',
      v2LifecycleStatus: 'pending_results',
    });
  });
});
