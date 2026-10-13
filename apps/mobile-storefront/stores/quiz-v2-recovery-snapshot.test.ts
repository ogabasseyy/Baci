import { initialQuizV2State } from './quiz-recovery-envelope';
import { getQuizRecoverySnapshot } from './quiz-v2-recovery-snapshot';
import { activeAttempt } from './quiz-v2-store-actions.test-support';

const state = {
  ...initialQuizV2State,
  status: 'ready' as const,
  attemptIntegrityTier: null,
  error: null,
  recoveryUserId: 'user-1',
  selectedEventId: 'event-1',
  startRequestId: 'request-1',
  v2Attempt: activeAttempt,
  lockedOptionId: 'a',
};

it('uses the matching persisted snapshot when no in-memory attempt remains', () => {
  const snapshot = {
    version: 1 as const,
    userId: 'user-1',
    eventId: 'event-1',
    generation: 1,
    attemptId: 'attempt-1',
    currentQuestionId: 'question-1',
    pendingLockedOptionId: 'a',
    startRequestId: 'request-1',
  };
  expect(
    getQuizRecoverySnapshot(
      'user-1',
      'event-1',
      snapshot,
      {
        ...state,
        v2Attempt: null,
        lockedOptionId: null,
      },
      2
    )
  ).toBe(snapshot);
});

it('captures the scoped retained answer lock', () => {
  expect(
    getQuizRecoverySnapshot('user-1', 'event-1', undefined, state, 2)
  ).toMatchObject({
    attemptId: activeAttempt.attemptId,
    currentQuestionId: activeAttempt.question?.id,
    pendingLockedOptionId: 'a',
    generation: 2,
  });
});

it.each([
  ['other-user', 'event-1'],
  ['user-1', 'other-event'],
])('does not reuse another identity lock for %s/%s', (userId, eventId) => {
  expect(
    getQuizRecoverySnapshot(userId, eventId, undefined, state, 2)
  ).toBeNull();
});
