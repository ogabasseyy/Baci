import { jest } from '@jest/globals';
import type { QuizV2Attempt } from '@/services/quiz-types';
import { initialQuizV2State } from './quiz-recovery-envelope';
import {
  activeAttempt,
  activeQuestion,
  createHarness,
  mockLoadRecoveryEnvelope,
  resetQuizV2StoreActionMocks,
  response,
} from './quiz-v2-store-actions.test-support';

describe('createQuizV2StoreActions recovery', () => {
  beforeEach(() => resetQuizV2StoreActionMocks());
  afterEach(() => jest.clearAllMocks());

  it('clears the resume marker when the server confirms no attempt exists', async () => {
    const harness = createHarness();
    harness.set({ startRequestId: 'request' });
    await harness.actions.recoverEvent(
      'user-1',
      'event-1',
      async () => response({ availability: 'none', attempt: undefined }),
      async () => activeAttempt
    );
    expect(harness.getState()).toMatchObject({
      status: 'ready',
      startRequestId: null,
    });
  });

  it('recovers the server attempt even when local storage cannot be read', async () => {
    const harness = createHarness();
    mockLoadRecoveryEnvelope.mockRejectedValueOnce(
      new Error('storage unavailable')
    );
    await harness.actions.recoverEvent(
      'user-1',
      'event-1',
      async () => response({}),
      async () => activeAttempt
    );
    expect(harness.getState()).toMatchObject({
      status: 'question',
      v2Attempt: activeAttempt,
      error: null,
    });
    expect(harness.getState().startRequestId).toBe(
      '11111111-1111-4111-8111-111111111111'
    );
  });

  it.each([
    'user-1',
    'other-user',
  ])('scopes unfinished start protection to the recovering account %s', async (userId) => {
    const harness = createHarness();
    harness.set({ status: 'ready' });
    let finish!: (value: QuizV2Attempt) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = harness.actions.startEventV2(
      {
        userId: 'user-1',
        eventId: 'event-1',
        integrityTier: 'basic',
        startRequestId: 'request',
      },
      () =>
        new Promise<QuizV2Attempt>((resolve) => {
          finish = resolve;
          started();
        })
    );
    await ready;
    harness.setGeneration(1);
    harness.set({ status: 'ready' });
    await harness.actions.recoverEvent(
      userId,
      'event-1',
      async () => response({ availability: 'none', attempt: undefined }),
      async () => activeAttempt
    );
    expect(harness.getState().startRequestId).toBe(
      userId === 'user-1' ? 'request' : null
    );
    finish(activeAttempt);
    await pending;
  });

  it('keeps the terminal attempt id returned after a lost start response', async () => {
    mockLoadRecoveryEnvelope.mockResolvedValueOnce(null);
    const harness = createHarness();

    await harness.actions.recoverEvent(
      'user-1',
      'event-1',
      async () =>
        response({
          attempt: undefined,
          attemptId: 'attempt-recovered',
          availability: 'pending_results',
        }),
      jest.fn<
        (optionId: string, questionId: string) => Promise<QuizV2Attempt>
      >()
    );

    expect(harness.getState()).toMatchObject({
      status: 'result',
      terminalContext: {
        attemptId: 'attempt-recovered',
        eventId: 'event-1',
      },
      v2LifecycleStatus: 'pending_results',
    });
  });

  it('prefers the server attempt id over a stale persisted envelope', async () => {
    const harness = createHarness();
    mockLoadRecoveryEnvelope.mockResolvedValueOnce({
      attemptId: 'stale-attempt',
      currentQuestionId: null,
      eventId: 'event-1',
      generation: 1,
      pendingLockedOptionId: null,
      startRequestId: '11111111-1111-4111-8111-111111111111',
      userId: 'user-1',
      version: 1,
    });

    await harness.actions.recoverEvent(
      'user-1',
      'event-1',
      async () =>
        response({
          attempt: {
            ...activeAttempt,
            attemptId: 'server-attempt',
            status: 'submitted_pending_results',
          },
          availability: 'pending_results',
        }),
      jest.fn<
        (optionId: string, questionId: string) => Promise<QuizV2Attempt>
      >()
    );

    expect(harness.getState()).toMatchObject({
      status: 'result',
      terminalContext: {
        attemptId: 'server-attempt',
        eventId: 'event-1',
      },
    });
  });

  it('does not apply a resend response after the account generation changes', async () => {
    const harness = createHarness();
    mockLoadRecoveryEnvelope.mockResolvedValueOnce({
      attemptId: activeAttempt.attemptId,
      currentQuestionId: activeQuestion.id,
      eventId: activeAttempt.eventId,
      generation: 0,
      pendingLockedOptionId: 'a',
      startRequestId: '11111111-1111-4111-8111-111111111111',
      userId: 'user-1',
      version: 1,
    });
    let resolveResend!: (attempt: QuizV2Attempt) => void;
    const resend = jest.fn(
      () =>
        new Promise<QuizV2Attempt>((resolve) => {
          resolveResend = resolve;
        })
    );
    const recovery = harness.actions.recoverEvent(
      'user-1',
      'event-1',
      async () => response({}),
      resend
    );

    for (let attempts = 0; attempts < 10 && !resolveResend; attempts += 1) {
      await Promise.resolve();
    }
    if (!resolveResend) throw new Error('resender did not start');
    harness.setGeneration(1);
    harness.set({ ...initialQuizV2State, status: 'ready' });
    resolveResend(activeAttempt);

    await expect(recovery).resolves.toBe('retry');
    expect(harness.getState()).toMatchObject({
      error: null,
      status: 'ready',
      v2Attempt: null,
    });
  });

  it('clears a transient recovery error when terminal recovery succeeds', async () => {
    const harness = createHarness();
    await expect(
      harness.actions.recoverEvent(
        'user-1',
        'event-1',
        async () => {
          throw new Error('temporary recovery failure');
        },
        jest.fn<
          (optionId: string, questionId: string) => Promise<QuizV2Attempt>
        >(async () => activeAttempt)
      )
    ).resolves.toBe('retry');
    expect(harness.getState().error).toBe('temporary recovery failure');

    await expect(
      harness.actions.recoverEvent(
        'user-1',
        'event-1',
        async () =>
          response({
            attempt: undefined,
            attemptId: activeAttempt.attemptId,
            availability: 'pending_results',
          }),
        jest.fn<
          (optionId: string, questionId: string) => Promise<QuizV2Attempt>
        >(async () => activeAttempt)
      )
    ).resolves.toBe('recovered_terminal');

    expect(harness.getState()).toMatchObject({
      error: null,
      status: 'result',
      v2LifecycleStatus: 'pending_results',
    });
  });
});
