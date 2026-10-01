import { describe, expect, it, jest } from '@jest/globals';
import type { QuizV2Attempt } from '@/services/quiz-types';
import { createQuizV2RecoveryResponseApplier } from './quiz-v2-recovery-actions';
import { clearRecoveredQuizAttempt } from './quiz-v2-recovery-storage';
import type { QuizV2StoreAccess } from './quiz-v2-store-access';

jest.mock('./quiz-v2-recovery-storage', () => ({
  clearRecoveredQuizAttempt: jest.fn(async () => undefined),
}));

const fallback: QuizV2Attempt = {
  attemptId: 'attempt-1',
  eventEndsAt: '2026-08-04T12:05:00.000Z',
  eventId: 'event-1',
  question: undefined,
  resultsAvailableAt: null,
  serverNow: '2026-08-04T12:00:00.000Z',
  status: 'in_progress',
};

describe('createQuizV2RecoveryResponseApplier', () => {
  it('leaves the question when an active attempt is no longer recoverable', async () => {
    const set = jest.fn();
    const access = {
      get: jest.fn(() => ({ recoveryUserId: 'user-1' })),
      getGeneration: jest.fn(() => 0),
      getMessage: jest.fn(() => ''),
      set,
    } as unknown as QuizV2StoreAccess;
    const apply = jest.fn(async () => undefined);
    const applyRecoveryResponse = createQuizV2RecoveryResponseApplier({
      access,
      apply,
    });

    await applyRecoveryResponse(
      {
        availability: 'unavailable',
        attempt: undefined,
        eventEndsAt: fallback.eventEndsAt,
        serverNow: fallback.serverNow,
      },
      fallback
    );

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        error: null,
        expiryRetryable: false,
        status: 'result',
        v2Attempt: null,
        v2LifecycleStatus: 'final',
        v2Result: {
          attemptId: fallback.attemptId,
          availability: 'unavailable',
          reason: 'not_found',
        },
      })
    );
    expect(apply).not.toHaveBeenCalled();
    expect(clearRecoveredQuizAttempt).toHaveBeenCalledWith(access, 'event-1');
  });

  it('preserves the server submission time from a top-level pending recovery response', async () => {
    const set = jest.fn();
    const access = {
      get: jest.fn(() => ({ recoveryUserId: 'user-1' })),
      getGeneration: jest.fn(() => 0),
      getMessage: jest.fn(() => ''),
      set,
    } as unknown as QuizV2StoreAccess;
    const apply = jest.fn(async () => undefined);
    const applyRecoveryResponse = createQuizV2RecoveryResponseApplier({
      access,
      apply,
    });

    await applyRecoveryResponse(
      {
        attemptId: fallback.attemptId,
        availability: 'pending_results',
        eventEndsAt: fallback.eventEndsAt,
        serverNow: fallback.serverNow,
        submittedAt: '2026-08-04T12:00:04.321Z',
      },
      fallback
    );

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        terminalContext: expect.objectContaining({
          submittedAt: '2026-08-04T12:00:04.321Z',
        }),
      })
    );
  });
});
