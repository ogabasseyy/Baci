import { describe, expect, it, jest } from '@jest/globals';
import type { QuizV2Attempt } from '@/services/quiz-types';
import {
  clearQuizRecoveryEnvelope,
  createQuizRecoveryEnvelope,
  saveQuizRecoveryEnvelope,
} from './quiz-recovery-envelope';
import {
  clearRecoveredQuizAttempt,
  clearTerminalRecovery,
  createQuizAttemptPersistence,
  resolveQuizStartRequestId,
  saveQuizStartRequest,
} from './quiz-v2-recovery-storage';
import type { QuizV2StoreAccess } from './quiz-v2-store-access';

jest.mock('./quiz-recovery-envelope', () => ({
  clearQuizRecoveryEnvelope: jest.fn(async () => undefined),
  createQuizRecoveryEnvelope: jest.fn((value) => value),
  saveQuizRecoveryEnvelope: jest.fn(async () => undefined),
}));

const attempt: QuizV2Attempt = {
  attemptId: 'attempt-1',
  eventEndsAt: '2026-08-04T12:05:00.000Z',
  eventId: 'event-1',
  question: undefined,
  resultsAvailableAt: null,
  serverNow: '2026-08-04T12:00:00.000Z',
  status: 'in_progress',
};

function access(
  overrides: {
    recoveryUserId?: string | null;
    startRequestId?: string | null;
  } = {}
) {
  const state = {
    recoveryUserId: 'user-1',
    startRequestId: '11111111-1111-4111-8111-111111111111',
    ...overrides,
  };
  return {
    get: () => state,
    getGeneration: () => 3,
    getMessage: () => '',
    set: () => undefined,
  } as unknown as QuizV2StoreAccess;
}

describe('quiz-v2-recovery-storage', () => {
  it('clears recovered attempts only for an identified user', async () => {
    await clearRecoveredQuizAttempt(access(), 'event-1');
    expect(clearQuizRecoveryEnvelope).toHaveBeenCalledWith('user-1', 'event-1');

    (clearQuizRecoveryEnvelope as jest.Mock).mockClear();
    await clearRecoveredQuizAttempt(
      access({ recoveryUserId: null }),
      'event-1'
    );
    expect(clearQuizRecoveryEnvelope).not.toHaveBeenCalled();
  });

  it('honours the terminal clear flag', async () => {
    (clearQuizRecoveryEnvelope as jest.Mock).mockClear();
    await clearTerminalRecovery(access(), 'event-1', false);
    expect(clearQuizRecoveryEnvelope).not.toHaveBeenCalled();
    await clearTerminalRecovery(access(), 'event-1', true);
    expect(clearQuizRecoveryEnvelope).toHaveBeenCalledWith('user-1', 'event-1');
  });

  it('persists an attempt and start request with the recovery context', async () => {
    (saveQuizRecoveryEnvelope as jest.Mock).mockClear();
    const persist = createQuizAttemptPersistence(access());
    await persist(attempt, 'option-1');
    expect(saveQuizRecoveryEnvelope).toHaveBeenCalled();

    (saveQuizRecoveryEnvelope as jest.Mock).mockClear();
    await saveQuizStartRequest(
      {
        eventId: 'event-1',
        integrityTier: 'basic',
        startRequestId: '11111111-1111-4111-8111-111111111111',
        userId: 'user-1',
      },
      3,
      '11111111-1111-4111-8111-111111111111'
    );
    expect(createQuizRecoveryEnvelope).toHaveBeenCalled();
    expect(saveQuizRecoveryEnvelope).toHaveBeenCalled();
  });

  it('uses a fresh request id after a retained terminal attempt', () => {
    const existing = {
      attemptId: 'attempt-1',
      currentQuestionId: null,
      eventId: 'event-1',
      generation: 0,
      pendingLockedOptionId: null,
      startRequestId: '11111111-1111-4111-8111-111111111111',
      userId: 'user-1',
      version: 1 as const,
    };

    expect(
      resolveQuizStartRequestId(
        existing,
        '22222222-2222-4222-8222-222222222222'
      )
    ).toBe('22222222-2222-4222-8222-222222222222');
    expect(
      resolveQuizStartRequestId(
        { ...existing, currentQuestionId: 'question-1' },
        '33333333-3333-4333-8333-333333333333'
      )
    ).toBe(existing.startRequestId);
  });
});
