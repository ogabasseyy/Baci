import { jest } from '@jest/globals';
import type {
  QuizActiveAttemptResponse,
  QuizV2Attempt,
} from '@/services/quiz-types';
import {
  activeAttempt,
  activeQuestion,
  createHarness,
  resetQuizV2StoreActionMocks,
  response,
} from './quiz-v2-store-actions.test-support';

describe('createQuizV2StoreActions expiry and locked answers', () => {
  beforeEach(() => resetQuizV2StoreActionMocks());
  afterEach(() => jest.clearAllMocks());

  it('expiry_applies_active_response', async () => {
    const harness = createHarness();
    const nextAttempt = {
      ...activeAttempt,
      question: { ...activeQuestion, id: 'question-2', index: 2 },
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

  it('expiry_keeps_the_question_retryable when reconciliation returns none', async () => {
    const harness = createHarness();
    await harness.actions.expireActiveEvent(async () =>
      response({ availability: 'none', attempt: undefined })
    );

    expect(harness.getState()).toMatchObject({
      error: null,
      expiryRetryable: true,
      status: 'question',
      v2Attempt: activeAttempt,
    });
  });

  it('expiry_enters an unavailable terminal result when recovery is no longer possible', async () => {
    const harness = createHarness();
    await harness.actions.expireActiveEvent(async () =>
      response({ availability: 'unavailable', attempt: undefined })
    );

    expect(harness.getState()).toMatchObject({
      error: null,
      expiryRetryable: false,
      status: 'result',
      v2Attempt: null,
      v2LifecycleStatus: 'final',
      v2Result: {
        attemptId: activeAttempt.attemptId,
        availability: 'unavailable',
        reason: 'not_found',
      },
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

  it('blocks answer taps while expiry reconciliation is pending', async () => {
    const harness = createHarness();
    let resolveReconciliation!: (value: QuizActiveAttemptResponse) => void;
    const expiry = harness.actions.expireActiveEvent(
      () =>
        new Promise<QuizActiveAttemptResponse>((resolve) => {
          resolveReconciliation = resolve;
        })
    );

    expect(harness.getState().status).toBe('submitting');
    const submitter = jest.fn(async () => activeAttempt);
    await harness.actions.lockAndSubmitAnswer('b', submitter);
    expect(submitter).not.toHaveBeenCalled();

    resolveReconciliation(
      response({ availability: 'pending_results', attempt: undefined })
    );
    await expiry;

    expect(harness.getState()).toMatchObject({
      status: 'result',
      v2LifecycleStatus: 'pending_results',
    });
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

  it('allows a new account generation to retry while the old retry is pending', async () => {
    const harness = createHarness();
    harness.set({ lockedOptionId: 'a' });
    let resolveFirst!: (attempt: QuizV2Attempt) => void;
    const firstSubmitter = jest.fn(
      () =>
        new Promise<QuizV2Attempt>((resolve) => {
          resolveFirst = resolve;
        })
    );
    const first = harness.actions.retryLockedAnswer(firstSubmitter);
    if (!resolveFirst) throw new Error('first retry did not start');

    harness.setGeneration(1);
    harness.set({
      lockedOptionId: 'b',
      status: 'question',
      v2Attempt: { ...activeAttempt, attemptId: 'attempt-2' },
    });
    const secondSubmitter = jest.fn(async () => activeAttempt);

    await harness.actions.retryLockedAnswer(secondSubmitter);

    expect(secondSubmitter).toHaveBeenCalledWith('b');
    resolveFirst(activeAttempt);
    await first;
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
