import { jest } from '@jest/globals';
import {
  activeAttempt,
  activeQuestion,
  createHarness,
  mockLoadRecoveryEnvelope,
  resetQuizV2StoreActionMocks,
  response,
} from './quiz-v2-store-actions.test-support';

beforeEach(resetQuizV2StoreActionMocks);

it('does not resend a retained lock after the server advances the question', async () => {
  const harness = createHarness();
  harness.set({ status: 'ready', lockedOptionId: 'a' });
  mockLoadRecoveryEnvelope.mockRejectedValueOnce(
    new Error('storage unavailable')
  );
  const next = {
    ...activeAttempt,
    question: { ...activeQuestion, id: 'question-2' },
  };
  const resend = jest.fn(async () => next);
  await harness.actions.recoverEvent(
    'user-1',
    'event-1',
    async () => response({ attempt: next }),
    resend
  );
  expect(resend).not.toHaveBeenCalled();
  expect(harness.getState()).toMatchObject({
    status: 'question',
    lockedOptionId: null,
    v2Attempt: next,
  });
});

it('resends the retained answer after Back during submission and a failed storage read', async () => {
  const harness = createHarness();
  let finish!: (value: typeof activeAttempt) => void;
  const submission = harness.actions.lockAndSubmitAnswer(
    'a',
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await Promise.resolve();
  harness.setGeneration(1);
  harness.set({ status: 'ready' });
  mockLoadRecoveryEnvelope.mockRejectedValueOnce(
    new Error('storage unavailable')
  );
  const resend = jest.fn(async () => {
    expect(harness.getState().lockedOptionId).toBe('a');
    expect(harness.getState().status).toBe('submitting');
    return {
      ...activeAttempt,
      status: 'submitted_pending_results' as const,
      question: undefined,
    };
  });
  await harness.actions.recoverEvent(
    'user-1',
    'event-1',
    async () => response({}),
    resend
  );
  expect(resend).toHaveBeenCalledWith('a', activeQuestion.id);
  finish(activeAttempt);
  await submission;
});
