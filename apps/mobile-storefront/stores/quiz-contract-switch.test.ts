import type { QuizV2Attempt } from '@/services/quiz-types';
import { useQuizStore } from './quiz-store';
import { attempt } from './quiz-store.test-utils';

const v2: QuizV2Attempt = {
  attemptId: 'v2',
  eventId: 'v2-event',
  status: 'in_progress',
  serverNow: '2026-09-06T10:00:00Z',
  eventEndsAt: '2026-09-06T10:05:00Z',
  resultsAvailableAt: null,
};
afterEach(() => useQuizStore.getState().resetForAccountChange());
it.each([
  'legacy',
  'v2',
])('clears the other contract when a %s start rejects', async (contract) => {
  useQuizStore.setState({ status: 'ready', attempt, v2Attempt: v2 });
  const starter = async () => {
    throw new Error('start rejected');
  };
  if (contract === 'legacy')
    await useQuizStore.getState().startEvent('legacy', 'basic', starter);
  else
    await useQuizStore.getState().startEventV2(
      {
        eventId: 'v2-event',
        userId: 'user',
        startRequestId: 'request',
        integrityTier: 'basic',
      },
      starter
    );
  expect(useQuizStore.getState()).toMatchObject({
    status: 'ready',
    attempt: null,
    v2Attempt: null,
  });
});
it('clears the retained V2 question when starting a legacy event', async () => {
  useQuizStore.setState({ status: 'ready', v2Attempt: v2 });
  await useQuizStore
    .getState()
    .startEvent('legacy', 'basic', async () => attempt);
  expect(useQuizStore.getState()).toMatchObject({ attempt, v2Attempt: null });
});
it('clears the retained legacy question when starting a V2 event', async () => {
  useQuizStore.setState({ status: 'ready', attempt });
  await useQuizStore.getState().startEventV2(
    {
      eventId: 'v2-event',
      userId: 'user',
      startRequestId: 'request',
      integrityTier: 'basic',
    },
    async () => v2
  );
  expect(useQuizStore.getState()).toMatchObject({
    attempt: null,
    v2Attempt: v2,
  });
});
