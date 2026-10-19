import type {
  QuizActiveAttemptResponse,
  QuizV2Attempt,
} from '@/services/quiz-types';
import type { QuizV2StoreState } from './quiz-recovery-envelope';
import { createQuizV2ExpiryAction } from './quiz-v2-expiry-action';

const attempt: QuizV2Attempt = {
  attemptId: 'attempt-1',
  eventEndsAt: '2026-08-04T12:05:00.000Z',
  eventId: 'event-1',
  question: undefined,
  resultsAvailableAt: null,
  serverNow: '2026-08-04T12:00:00.000Z',
  status: 'in_progress',
};

describe('createQuizV2ExpiryAction', () => {
  it('exposes a retryable state when expiry reconciliation fails', async () => {
    let state = {
      status: 'question',
      v2Attempt: attempt,
    } as unknown as QuizV2StoreState;
    const access = {
      get: () => state,
      getGeneration: () => 0,
      getMessage: (error: unknown) =>
        error instanceof Error ? error.message : String(error),
      set: (patch: Partial<QuizV2StoreState>) => {
        state = { ...state, ...patch };
      },
    };
    const applyRecoveryResponse = async (
      _response: QuizActiveAttemptResponse,
      _fallback: QuizV2Attempt
    ) => undefined;
    let lifecycleEpoch = 0;
    const expire = createQuizV2ExpiryAction({
      access,
      applyRecoveryResponse,
      getLifecycleEpoch: () => lifecycleEpoch,
      nextLifecycleEpoch: () => {
        lifecycleEpoch += 1;
        return lifecycleEpoch;
      },
    });

    await expire(async () => {
      throw new Error('network down');
    });

    expect(state).toMatchObject({
      error: 'network down',
      expiryRetryable: true,
      status: 'question',
    });
  });

  it('allows a new account generation to reconcile while the old one is pending', async () => {
    let generation = 0;
    let state = {
      status: 'question',
      v2Attempt: attempt,
    } as unknown as QuizV2StoreState;
    const access = {
      get: () => state,
      getGeneration: () => generation,
      getMessage: (error: unknown) =>
        error instanceof Error ? error.message : String(error),
      set: (patch: Partial<QuizV2StoreState>) => {
        state = { ...state, ...patch };
      },
    };
    const applyRecoveryResponse = async (
      _response: QuizActiveAttemptResponse,
      _fallback: QuizV2Attempt
    ) => undefined;
    let lifecycleEpoch = 0;
    const expire = createQuizV2ExpiryAction({
      access,
      applyRecoveryResponse,
      getLifecycleEpoch: () => lifecycleEpoch,
      nextLifecycleEpoch: () => {
        lifecycleEpoch += 1;
        return lifecycleEpoch;
      },
    });
    let resolveFirst!: (response: QuizActiveAttemptResponse) => void;
    const first = expire(
      () =>
        new Promise<QuizActiveAttemptResponse>((resolve) => {
          resolveFirst = resolve;
        })
    );
    await Promise.resolve();
    generation = 1;
    state = {
      ...state,
      error: null,
      expiryRetryable: false,
      v2Attempt: { ...attempt, attemptId: 'attempt-2' },
    };

    await expire(async () => {
      throw new Error('account B network down');
    });

    expect(state).toMatchObject({
      error: 'account B network down',
      expiryRetryable: true,
      status: 'question',
    });
    resolveFirst({
      availability: 'none',
      eventEndsAt: attempt.eventEndsAt,
      serverNow: attempt.serverNow,
    });
    await first;
    expect(state.error).toBe('account B network down');
  });
});
