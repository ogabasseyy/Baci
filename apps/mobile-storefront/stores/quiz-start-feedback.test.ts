import { asyncStorage } from '@/lib/storage';
import { useQuizStore } from './quiz-store';

afterEach(() => {
  jest.restoreAllMocks();
  useQuizStore.getState().resetForAccountChange();
});

it('shows starting immediately while recovery storage is still loading', async () => {
  let release!: (value: string | null) => void;
  jest.spyOn(asyncStorage, 'getItem').mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  const starter = jest.fn(async () => {
    throw new Error('offline');
  });
  const pending = useQuizStore.getState().startEventV2(
    {
      eventId: 'feedback-event',
      userId: 'feedback-user',
      integrityTier: 'basic',
      startRequestId: '11111111-1111-4111-8111-111111111111',
    },
    starter
  );
  const statusWhileLoading = useQuizStore.getState().status;
  release(null);
  await pending;
  expect(statusWhileLoading).toBe('starting');
  expect(useQuizStore.getState()).toMatchObject({
    status: 'ready',
    error: 'offline',
  });
});
