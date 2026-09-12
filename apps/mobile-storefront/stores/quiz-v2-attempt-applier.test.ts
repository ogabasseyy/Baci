import type { QuizV2Attempt } from '@/services/quiz-types';
import {
  initialQuizV2State,
  type QuizV2StoreState,
} from './quiz-recovery-envelope';
import { createQuizV2AttemptApplier } from './quiz-v2-attempt-applier';

const attempt = (status: QuizV2Attempt['status']): QuizV2Attempt => ({
  attemptId: 'attempt-1',
  eventId: 'event-1',
  eventEndsAt: '2026-09-02T12:00:00.000Z',
  question: undefined,
  resultsAvailableAt: null,
  serverNow: '2026-09-02T11:00:00.000Z',
  status,
});

function createAccess(set: jest.Mock) {
  const state: QuizV2StoreState = {
    ...initialQuizV2State,
    attemptIntegrityTier: null,
    error: null,
    selectedEventId: null,
    status: 'ready',
  };
  return {
    get: () => state,
    getGeneration: () => 1,
    getMessage: () => 'error',
    set,
  };
}

describe('createQuizV2AttemptApplier', () => {
  it('moves an in-progress attempt to the question state and persists it', async () => {
    const set = jest.fn();
    const persist = jest.fn().mockResolvedValue(undefined);
    const apply = createQuizV2AttemptApplier({
      access: createAccess(set),
      persist,
    });

    await apply(attempt('in_progress'));

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'question',
        v2LifecycleStatus: 'in_progress',
      })
    );
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'in_progress' }),
      null
    );
  });

  it('creates terminal context for a completed attempt', async () => {
    const set = jest.fn();
    const submittedAt = '2026-09-02T11:00:12.345Z';
    const apply = createQuizV2AttemptApplier({
      access: createAccess(set),
      persist: jest.fn().mockResolvedValue(undefined),
    });

    await apply({ ...attempt('completed'), submittedAt });

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'result',
        terminalContext: expect.objectContaining({
          submittedAt,
        }),
      })
    );
  });

  it('does not use a retry response time as the terminal submission time', async () => {
    const set = jest.fn();
    const apply = createQuizV2AttemptApplier({
      access: createAccess(set),
      persist: jest.fn().mockResolvedValue(undefined),
    });

    await apply({ ...attempt('completed'), submittedAt: null });

    const terminalContext = set.mock.calls[0][0].terminalContext;
    expect(terminalContext).not.toHaveProperty('submittedAt');
  });
});
