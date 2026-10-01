import type { QuizActiveAttemptResponse } from '@/services/quiz-types';
import { useQuizStore } from './quiz-store';

afterEach(() => useQuizStore.getState().resetForAccountChange());

it('allows new-generation reconciliation and retains its lock when the old request finishes', async () => {
  useQuizStore.setState({ status: 'question', lockedOptionId: null });
  let finishOld!: (value: QuizActiveAttemptResponse) => void;
  const oldResponse = new Promise<QuizActiveAttemptResponse>((resolve) => {
    finishOld = resolve;
  });
  const oldRequest = useQuizStore
    .getState()
    .reconcileLifecycle(() => oldResponse, 100000);
  useQuizStore.getState().showLobby();
  useQuizStore.setState({ status: 'question' });
  let finishNew!: (value: QuizActiveAttemptResponse) => void;
  const newResponse = new Promise<QuizActiveAttemptResponse>((resolve) => {
    finishNew = resolve;
  });
  const newReconciler = jest.fn(() => newResponse);
  const newRequest = useQuizStore
    .getState()
    .reconcileLifecycle(newReconciler, 100001);
  const emptyResponse: QuizActiveAttemptResponse = {
    availability: 'none',
    serverNow: '2026-09-05T12:00:00Z',
    eventEndsAt: null,
  };
  finishOld(emptyResponse);
  await oldRequest;
  const duplicate = jest.fn(async () => emptyResponse);
  await useQuizStore.getState().reconcileLifecycle(duplicate, 100002);
  finishNew(emptyResponse);
  await newRequest;
  expect(newReconciler).toHaveBeenCalledTimes(1);
  expect(duplicate).not.toHaveBeenCalled();
});
