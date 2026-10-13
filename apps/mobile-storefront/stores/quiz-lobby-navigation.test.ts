import type { QuizActiveAttemptResponse } from '@/services/quiz-types';
import {
  createQuizRecoveryEnvelope,
  loadQuizRecoveryEnvelope,
  saveQuizRecoveryEnvelope,
} from './quiz-recovery-envelope';
import { useQuizStore } from './quiz-store';

afterEach(() => useQuizStore.getState().resetForAccountChange());

it.each([
  'starting',
  'submitting',
] as const)('keeps legacy %s requests on their current surface until settled', (status) => {
  useQuizStore.setState({ status });
  useQuizStore.getState().showLobby();
  expect(useQuizStore.getState().status).toBe(status);
});

it('discards reconciliation that arrives after returning to the lobby', async () => {
  useQuizStore.setState({ status: 'question', lockedOptionId: null });
  let resolve!: (response: QuizActiveAttemptResponse) => void;
  const response = new Promise<QuizActiveAttemptResponse>((done) => {
    resolve = done;
  });
  const pending = useQuizStore
    .getState()
    .reconcileLifecycle(() => response, 100000);
  useQuizStore.getState().showLobby();
  resolve({
    availability: 'active',
    eventEndsAt: '2026-09-05T12:05:00Z',
    serverNow: '2026-09-05T12:00:00Z',
    attempt: {
      attemptId: 'a',
      eventId: 'e',
      status: 'in_progress',
      serverNow: '2026-09-05T12:00:00Z',
      eventEndsAt: '2026-09-05T12:05:00Z',
      resultsAvailableAt: null,
      question: {
        id: 'q',
        index: 1,
        total: 1,
        prompt: 'Question',
        options: [{ id: 'a', label: 'Answer' }],
        timeLimitSeconds: 10,
        deadlineAt: '2026-09-05T12:00:10Z',
      },
    },
  });
  await pending;
  expect(useQuizStore.getState()).toMatchObject({
    status: 'ready',
    v2Attempt: null,
  });
});

it('keeps recovery on returning to the lobby and discards an in-flight start response', async () => {
  const envelope = createQuizRecoveryEnvelope({
    attemptId: null,
    currentQuestionId: null,
    eventId: 'event',
    generation: 0,
    pendingLockedOptionId: null,
    startRequestId: '11111111-1111-4111-8111-111111111111',
    userId: 'user',
  });
  await saveQuizRecoveryEnvelope(envelope);
  let rejectStart!: (error: Error) => void;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const starter = jest.fn(
    () =>
      new Promise<never>((_resolve, reject) => {
        rejectStart = reject;
        markStarted();
      })
  );
  const pending = useQuizStore.getState().startEventV2(
    {
      eventId: 'event',
      userId: 'user',
      integrityTier: 'basic',
      startRequestId: envelope.startRequestId,
    },
    starter
  );
  await started;
  expect(starter).toHaveBeenCalledTimes(1);
  useQuizStore.getState().showLobby();
  rejectStart(new Error('old request'));
  await pending;
  expect(useQuizStore.getState()).toMatchObject({
    status: 'ready',
    error: null,
  });
  expect(await loadQuizRecoveryEnvelope('user', 'event')).not.toBeNull();
});
